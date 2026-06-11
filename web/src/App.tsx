import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { ConversationPanel } from './components/ConversationPanel';
import type { DisplayMessage } from './components/ConversationPanel';
import { Gallery } from './Gallery';
import { HudCanvas, type HudRenderState } from './components/HudCanvas';
import { InputBar } from './components/InputBar';
import { getHudData } from './lib/hudData';
import {
  createHudFallback,
  generateHudJsx,
  repairHudJsx,
  shouldGenerateHud,
  type HudGenerationResult,
} from './lib/hudGenerator';
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
  const [hud, setHud] = useState<HudRenderState>({ phase: 'idle' });
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
    const activeConversation = conversation;

    // 사용자 메시지 + 비어있는 assistant 메시지(여기에 토큰을 누적)를 먼저 그린다.
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

    if (shouldGenerateHud(text)) {
      setTab('hud');
      void startHudGeneration(text, activeConversation);
    }

    try {
      let received = false;
      let assistantBuffer = '';
      let bufferingEnvelope = false;
      for await (const delta of streamResponse(text, activeConversation, {
        signal: controller.signal,
        onToolEvent: handleToolEvent,
      })) {
        received = true;
        assistantBuffer += delta;
        if (shouldBufferPotentialEnvelope(assistantBuffer, bufferingEnvelope)) {
          bufferingEnvelope = true;
        } else {
          setMessages((prev) => appendToLastAssistant(prev, delta));
        }
      }
      // 토큰이 하나도 안 오면 빈 말풍선이 남으므로 안내로 채운다.
      if (!received) {
        setMessages((prev) =>
          appendToLastAssistant(prev, '(응답이 비어 있습니다.)'),
        );
      } else if (bufferingEnvelope) {
        setMessages((prev) =>
          replaceLastAssistant(prev, extractEnvelopeSay(assistantBuffer)),
        );
      }
      setStatus('idle');
      setStatusDetail(undefined);
    } catch (err) {
      if (controller.signal.aborted) {
        // 사용자가 중단함 — 에러 아님.
        setStatus('idle');
        setStatusDetail(undefined);
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...dropEmptyTrailingAssistant(prev),
          { role: 'assistant', content: `⚠ 오류: ${message}`, isError: true },
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
    setConversation(createConversationName());
    setMessages([]);
    setHud({ phase: 'idle', message: '새 대화가 시작되었습니다.' });
    setStatus('idle');
    setStatusDetail(undefined);
    lastRenderErrorRef.current = null;
    unsubscribeLiveHud();
  }

  const handleToolEvent = useCallback((event: HermesToolEvent) => {
    const toolName = formatToolName(event.name);
    setStatus('tooling');
    setStatusDetail(event.phase === 'call' ? toolName : `${toolName} 완료`);
  }, []);

  function setRenderedHud(result: HudGenerationResult) {
    if (import.meta.env.DEV && result.design) {
      console.debug('[HUD design]', result.design);
    }
    setHud(setRenderedHudState(result));
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
      message: `HUD 자기치유 중 (${current.repairCount + 1}/2)`,
      repairCount: current.repairCount,
    });
    setStatus('rendering');

    try {
      const repaired = await repairHudJsx(current, errorMessage, {
        signal: controller.signal,
        conversation: hudConversationName(conversation),
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

  async function startHudGeneration(task: string, activeConversation: string) {
    const controller = new AbortController();
    hudAbortRef.current?.abort();
    hudAbortRef.current = controller;
    lastRenderErrorRef.current = null;

    setHud({ phase: 'generating', message: 'HUD 데이터 준비 중' });
    setStatus('rendering');

    try {
      const data = await getHudData(task);
      setHud({ phase: 'generating', data, message: 'HUD 생성 중' });
      const result = await generateHudJsx(task, data, {
        signal: controller.signal,
        conversation: hudConversationName(activeConversation),
        onToolEvent: handleToolEvent,
      });
      if (controller.signal.aborted) return;
      setRenderedHud(result);
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      const data = await getHudData();
      setRenderedHud(createHudFallback(data, message));
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
    activeLiveSubRef.current = liveHudRef.current?.subscribe(result.live) ?? null;
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
      return {
        ...current,
        data: message.data,
        liveStatus: 'connected',
      };
    });
  }, []);

  const markLiveHudCaution = useCallback((reason: string) => {
    setStatus('caution');
    setStatusDetail(reason);
    setHud((current) => {
      if (current.phase !== 'rendered' || !current.data) return current;
      return {
        ...current,
        liveStatus: 'ended',
        data: markDataCaution(current.data, reason),
      };
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
    liveHudRef.current = new LiveHudClient({
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
    return () => {
      liveHudRef.current?.close();
      liveHudRef.current = null;
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
          대화
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

/**
 * 마지막 assistant 메시지에 델타를 이어붙인 새 배열을 반환.
 * 메시지 맨 앞의 공백·줄바꿈은 버린다(아직 실내용이 없을 때 들어온 델타는 left-trim).
 * 내부 줄바꿈은 보존한다.
 */
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

/** 에러 시, 토큰을 못 받아 비어 있는 마지막 assistant 말풍선을 제거. */
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

function shouldBufferPotentialEnvelope(
  content: string,
  alreadyBuffering: boolean,
): boolean {
  return alreadyBuffering || content.trimStart().startsWith('{');
}

function extractEnvelopeSay(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'say' in parsed &&
      typeof parsed.say === 'string'
    ) {
      return parsed.say;
    }
  } catch {
    return content;
  }
  return content;
}

function hudConversationName(conversation: string): string {
  return `${conversation}-hud`;
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

function formatToolName(name: string): string {
  const normalized = name.trim();
  if (!normalized) return 'tool';
  if (/terminal|shell|cmd|powershell/i.test(normalized)) return 'terminal';
  if (/code/i.test(normalized)) return 'code_execution';
  if (/file|read|write/i.test(normalized)) return 'file';
  return normalized;
}
