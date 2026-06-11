import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationPanel } from './components/ConversationPanel';
import type { DisplayMessage } from './components/ConversationPanel';
import { HudCanvas, type HudRenderState } from './components/HudCanvas';
import { InputBar } from './components/InputBar';
import { StatusBar } from './components/StatusBar';
import { Gallery } from './Gallery';
import {
  assertValidHudEnvelope,
  createHudFallback,
  extractHudEnvelope,
  HUD_SYSTEM_PROMPT,
  repairHudJsx,
  type HudGenerationResult,
} from './lib/hudGenerator';
import { EnvelopeSayStreamParser } from './lib/hudEnvelopeStream';
import {
  createConversationName,
  streamResponse,
  type HermesToolEvent,
} from './lib/hermes';
import {
  LiveHudClient,
  type LiveHudDataMessage,
  type LiveHudEndMessage,
} from './lib/liveHud';
import type { JarvisStatus } from './types';
import './styles/app.css';
import './hud/styles.css';

type MobileTab = 'chat' | 'hud';

const CONVERSATION_STORAGE_KEY = 'jarvis.conversation';
const TRANSCRIPT_STORAGE_KEY = 'jarvis.transcript';
const HUD_STORAGE_KEY = 'jarvis.hud';
const MAX_CONVERSATION_TURNS = readTurnLimit(
  import.meta.env.VITE_JARVIS_MAX_CONVERSATION_TURNS,
);

export default function App() {
  if (window.location.pathname === '/gallery') {
    return <Gallery />;
  }

  return <ChatApp />;
}

function ChatApp() {
  const [conversation, setConversation] = useState(loadConversation);
  const [messages, setMessages] = useState<DisplayMessage[]>(loadTranscript);
  const [status, setStatus] = useState<JarvisStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const [streaming, setStreaming] = useState(false);
  const [tab, setTab] = useState<MobileTab>('chat');
  const [hud, setHud] = useState<HudRenderState>(loadHudState);
  const abortRef = useRef<AbortController | null>(null);
  const hudAbortRef = useRef<AbortController | null>(null);
  const liveHudRef = useRef<LiveHudClient | null>(null);
  const activeLiveSubRef = useRef<string | null>(null);
  const hudRef = useRef<HudRenderState>(hud);
  const lastRenderErrorRef = useRef<string | null>(null);

  useEffect(() => {
    hudRef.current = hud;
  }, [hud]);

  useEffect(() => {
    writeStorage(CONVERSATION_STORAGE_KEY, conversation);
  }, [conversation]);

  useEffect(() => {
    writeStorage(TRANSCRIPT_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  async function handleSend(text: string) {
    const userMsg: DisplayMessage = { role: 'user', content: text };
    const activeConversation = shouldRotateConversation(messages)
      ? createConversationName()
      : conversation;

    if (activeConversation !== conversation) {
      setConversation(activeConversation);
    }

    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: 'assistant', content: '' },
    ]);
    setStreaming(true);
    setStatus('thinking');
    setStatusDetail(undefined);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let received = false;
      let streamedText = false;
      let sayComplete = false;
      const parser = new EnvelopeSayStreamParser();

      for await (const delta of streamResponse(text, activeConversation, {
        signal: controller.signal,
        instructions: HUD_SYSTEM_PROMPT,
        onToolEvent: handleToolEvent,
      })) {
        received = true;
        const parsed = parser.push(delta);

        if (parsed.text) {
          streamedText = true;
          setMessages((prev) => appendToLastAssistant(prev, parsed.text));
        }
        if (parsed.mode === 'envelope' && parsed.sayComplete && !sayComplete) {
          sayComplete = true;
          setStatus('rendering');
          setStatusDetail(undefined);
        }
      }

      if (!received) {
        setMessages((prev) => appendToLastAssistant(prev, '(empty response)'));
      } else {
        const finished = parser.finish();
        if (finished.isEnvelope) {
          await finishEnvelopeTurn(finished.raw, finished.say, controller);
        } else if (!streamedText && finished.raw) {
          setMessages((prev) => appendToLastAssistant(prev, finished.raw));
        }
      }

      setStatus('idle');
      setStatusDetail(undefined);
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus('idle');
        setStatusDetail(undefined);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...dropEmptyTrailingAssistant(prev),
          { role: 'assistant', content: `Error: ${message}`, isError: true },
        ]);
        setStatus('warning');
        setStatusDetail(undefined);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    hudAbortRef.current?.abort();
    setStatusDetail(undefined);
    setHud((current) =>
      current.phase === 'generating'
        ? { phase: 'idle', message: 'HUD generation stopped.' }
        : current,
    );
  }

  function handleNewConversation() {
    abortRef.current?.abort();
    hudAbortRef.current?.abort();
    // Topic shift only: long-term memory stays scoped by X-Hermes-Session-Key.
    setConversation(createConversationName());
    setMessages([]);
    setHud({ phase: 'idle', message: 'New topic started.' });
    clearHudState();
    setStatus('idle');
    setStatusDetail(undefined);
    lastRenderErrorRef.current = null;
    unsubscribeLiveHud();
  }

  const handleToolEvent = useCallback((event: HermesToolEvent) => {
    const toolName = formatToolName(event.name);
    setStatus('tooling');
    setStatusDetail(event.phase === 'call' ? toolName : `${toolName} done`);
  }, []);

  async function finishEnvelopeTurn(
    raw: string,
    streamedSay: string,
    controller: AbortController,
  ) {
    let result: HudGenerationResult;

    try {
      const envelope = extractHudEnvelope(raw);
      assertValidHudEnvelope(envelope);
      result = { ...envelope, repairCount: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = await repairHudJsx(
        {
          say: streamedSay,
          design: null,
          live: null,
          jsx: raw,
          data: {},
          repairCount: 0,
        },
        message,
        {
          signal: controller.signal,
          conversation: null,
          store: false,
          onToolEvent: handleToolEvent,
        },
      );
    }

    if (controller.signal.aborted) return;

    if (result.say) {
      setMessages((prev) => replaceLastAssistant(prev, result.say));
    } else if (!streamedSay) {
      setMessages((prev) => appendToLastAssistant(prev, '(empty response)'));
    }

    if (result.jsx === null) return;

    setTab('hud');
    lastRenderErrorRef.current = null;
    setRenderedHud(result);
  }

  function setRenderedHud(result: HudGenerationResult) {
    if (import.meta.env.DEV && result.design) {
      console.debug('[HUD design]', result.design);
    }
    const next = setRenderedHudState(result);
    setHud(next);
    persistHudState(next);
    syncLiveHudSubscription(result);
  }

  async function repairRenderedHud(
    current: HudGenerationResult,
    errorMessage: string,
  ) {
    const controller = new AbortController();
    hudAbortRef.current?.abort();
    hudAbortRef.current = controller;
    setHud({
      phase: 'generating',
      data: current.data,
      design: current.design,
      message: `Repairing HUD (${current.repairCount + 1}/2)`,
      repairCount: current.repairCount,
    });
    setStatus('rendering');

    try {
      const repaired = await repairHudJsx(current, errorMessage, {
        signal: controller.signal,
        conversation: null,
        store: false,
        onToolEvent: handleToolEvent,
      });
      if (controller.signal.aborted) return;
      lastRenderErrorRef.current = null;
      setRenderedHud(repaired);
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      setRenderedHud(createHudFallback(current.data, message));
      setStatus('warning');
    } finally {
      if (hudAbortRef.current === controller) hudAbortRef.current = null;
    }
  }

  function handleHudRenderError(message: string) {
    const current = hudRef.current;
    if (
      current.phase !== 'rendered' ||
      !current.jsx ||
      !current.data ||
      lastRenderErrorRef.current === message
    ) {
      return;
    }

    lastRenderErrorRef.current = message;
    void repairRenderedHud(
      {
        say: '',
        design: current.design ?? null,
        live: current.live ?? null,
        jsx: current.jsx,
        data: current.data,
        repairCount: current.repairCount ?? 0,
      },
      message,
    );
  }

  function syncLiveHudSubscription(result: HudGenerationResult) {
    unsubscribeLiveHud();
    if (result.jsx === null || !result.live) return;
    activeLiveSubRef.current =
      liveHudRef.current?.subscribe(result.live) ?? null;
  }

  function unsubscribeLiveHud() {
    const subId = activeLiveSubRef.current;
    if (subId) {
      liveHudRef.current?.unsubscribe(subId);
      activeLiveSubRef.current = null;
    }
  }

  const handleLiveHudData = useCallback((message: LiveHudDataMessage) => {
    if (message.subId !== activeLiveSubRef.current) return;
    setHud((current) => {
      if (current.phase !== 'rendered' || !current.jsx) return current;
      const next = {
        ...current,
        data: message.data,
        liveStatus: 'connected' as const,
      };
      persistHudState(next);
      return next;
    });
  }, []);

  const markLiveHudCaution = useCallback((reason: string) => {
    setStatus('caution');
    setStatusDetail(reason);
    setHud((current) => {
      if (current.phase !== 'rendered' || !current.data) return current;
      const next = {
        ...current,
        liveStatus: 'ended' as const,
        data: markDataCaution(current.data, reason),
      };
      persistHudState(next);
      return next;
    });
  }, []);

  const handleLiveHudEnd = useCallback(
    (message: LiveHudEndMessage) => {
      if (message.subId !== activeLiveSubRef.current) return;
      activeLiveSubRef.current = null;
      markLiveHudCaution(message.reason ?? 'live_hud_ended');
    },
    [markLiveHudCaution],
  );

  useEffect(() => {
    const client = new LiveHudClient({
      onData: handleLiveHudData,
      onEnd: handleLiveHudEnd,
      onError: (message) => markLiveHudCaution(message),
      onConnectionChange: (connected) => {
        if (connected) {
          setStatus('idle');
          setStatusDetail(undefined);
        } else if (activeLiveSubRef.current) {
          markLiveHudCaution('orchestrator_disconnected');
        }
      },
    });
    liveHudRef.current = client;

    const restoredHud = hudRef.current;
    if (
      restoredHud.phase === 'rendered' &&
      restoredHud.jsx &&
      restoredHud.live
    ) {
      activeLiveSubRef.current = client.subscribe(restoredHud.live);
    }

    return () => {
      client.close();
      liveHudRef.current = null;
      activeLiveSubRef.current = null;
    };
  }, [handleLiveHudData, handleLiveHudEnd, markLiveHudCaution]);

  return (
    <div className="app-shell">
      <StatusBar status={status} detail={statusDetail} />

      <div className="mobile-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'chat' ? 'true' : 'false'}
          onClick={() => setTab('chat')}
        >
          Chat
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'hud' ? 'true' : 'false'}
          onClick={() => setTab('hud')}
        >
          HUD
        </button>
      </div>

      <main className="app-main">
        <div
          className={`panel-slot ${tab === 'chat' ? '' : 'is-hidden-mobile'}`}
        >
          <ConversationPanel messages={messages} streaming={streaming} />
        </div>
        <div
          className={`panel-slot ${tab === 'hud' ? '' : 'is-hidden-mobile'}`}
        >
          <HudCanvas hud={hud} onRenderError={handleHudRenderError} />
        </div>
      </main>

      <InputBar
        canSend={!streaming}
        streaming={streaming}
        onSend={handleSend}
        onStop={handleStop}
        onNewConversation={handleNewConversation}
      />
    </div>
  );
}

function setRenderedHudState(result: HudGenerationResult): HudRenderState {
  if (result.jsx === null) {
    return {
      phase: 'idle',
      data: result.data,
      design: result.design,
      live: result.live,
      message: result.say || 'HUD not needed for this request.',
      repairCount: result.repairCount,
    };
  }

  return {
    phase: 'rendered',
    jsx: result.jsx,
    design: result.design,
    live: result.live,
    data: result.data,
    repairCount: result.repairCount,
  };
}

function appendToLastAssistant(
  prev: DisplayMessage[],
  delta: string,
): DisplayMessage[] {
  const next = prev.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'assistant' && !next[i].isError) {
      const current = next[i].content;
      const piece = current === '' ? delta.replace(/^\s+/, '') : delta;
      next[i] = { ...next[i], content: current + piece };
      break;
    }
  }
  return next;
}

function dropEmptyTrailingAssistant(prev: DisplayMessage[]): DisplayMessage[] {
  const last = prev[prev.length - 1];
  if (
    last &&
    last.role === 'assistant' &&
    last.content === '' &&
    !last.isError
  ) {
    return prev.slice(0, -1);
  }
  return prev;
}

function replaceLastAssistant(
  prev: DisplayMessage[],
  content: string,
): DisplayMessage[] {
  const next = prev.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'assistant' && !next[i].isError) {
      next[i] = { ...next[i], content };
      break;
    }
  }
  return next;
}

function markDataCaution(
  data: Record<string, unknown>,
  reason: string,
): Record<string, unknown> {
  return {
    ...data,
    state: data.state ?? 'caution',
    live: {
      status: 'caution',
      reason,
    },
  };
}

function shouldRotateConversation(messages: DisplayMessage[]): boolean {
  if (MAX_CONVERSATION_TURNS <= 0) return false;
  return (
    messages.filter((message) => message.role === 'user').length >=
    MAX_CONVERSATION_TURNS
  );
}

function loadConversation(): string {
  return readStorage(CONVERSATION_STORAGE_KEY) ?? createConversationName();
}

function loadTranscript(): DisplayMessage[] {
  const raw = readStorage(TRANSCRIPT_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDisplayMessage);
  } catch {
    return [];
  }
}

function loadHudState(): HudRenderState {
  const raw = readStorage(HUD_STORAGE_KEY);
  if (!raw) return { phase: 'idle' };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedHudState(parsed)) return { phase: 'idle' };
    return {
      phase: 'rendered',
      jsx: parsed.jsx,
      design: parsed.design,
      live: parsed.live,
      data: parsed.data,
      repairCount: parsed.repairCount,
      liveStatus: parsed.live ? 'disconnected' : undefined,
    };
  } catch {
    return { phase: 'idle' };
  }
}

function persistHudState(hud: HudRenderState): void {
  if (hud.phase !== 'rendered' || !hud.jsx || !hud.data) return;
  writeStorage(
    HUD_STORAGE_KEY,
    JSON.stringify({
      jsx: hud.jsx,
      design: hud.design ?? null,
      live: hud.live ?? null,
      data: hud.data,
      repairCount: hud.repairCount ?? 0,
    }),
  );
}

function clearHudState(): void {
  try {
    window.localStorage.removeItem(HUD_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in private contexts.
  }
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private contexts; server conversation still works.
  }
}

function isDisplayMessage(value: unknown): value is DisplayMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DisplayMessage>;
  return (
    (candidate.role === 'user' || candidate.role === 'assistant') &&
    typeof candidate.content === 'string'
  );
}

function isPersistedHudState(value: unknown): value is {
  jsx: string;
  design: HudRenderState['design'];
  live: HudRenderState['live'];
  data: Record<string, unknown>;
  repairCount?: number;
} {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<HudRenderState>;
  return (
    typeof candidate.jsx === 'string' &&
    typeof candidate.data === 'object' &&
    candidate.data !== null &&
    !Array.isArray(candidate.data)
  );
}

function readTurnLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 40;
  return Math.floor(parsed);
}

function formatToolName(name: string): string {
  const normalized = name.trim();
  if (!normalized) return 'tool';
  if (/terminal|shell|cmd|powershell/i.test(normalized)) return 'terminal';
  if (/code/i.test(normalized)) return 'code_execution';
  if (/file|read|write/i.test(normalized)) return 'file';
  return normalized;
}
