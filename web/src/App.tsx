import { useCallback, useEffect, useRef, useState } from 'react';
import { ConversationPanel } from './components/ConversationPanel';
import type { DisplayMessage } from './components/ConversationPanel';
import { HudCanvas, type HudRenderState } from './components/HudCanvas';
import { InputBar } from './components/InputBar';
import { StatusBar } from './components/StatusBar';
import { Gallery } from './Gallery';
import {
  assertValidHudEnvelope,
  assertValidHudJsx,
  createHudFallback,
  extractHudEnvelope,
  HUD_SYSTEM_PROMPT,
  repairHudJsx,
  type HudGenerationResult,
} from './lib/hudGenerator';
import { EnvelopeSayStreamParser } from './lib/hudEnvelopeStream';
import { shouldRotateConversation } from './lib/conversationRotation';
import {
  createConversationName,
  streamResponse,
  streamUsher,
  type HermesToolEvent,
} from './lib/hermes';
import {
  LiveHudClient,
  type LiveHudDataMessage,
  type LiveHudEndMessage,
} from './lib/liveHud';
import {
  extractToolDetail,
  getToolCallId,
  getToolOutcome,
  type ToolActivity,
} from './lib/toolActivity';
import type { JarvisStatus } from './types';
import './styles/app.css';
import './hud/styles.css';

type MobileTab = 'chat' | 'hud';

const CONVERSATION_STORAGE_KEY = 'jarvis.conversation';
const TRANSCRIPT_STORAGE_KEY = 'jarvis.transcript';
const HUD_STORAGE_KEY = 'jarvis.hud';
const ROTATION_BASE_STORAGE_KEY = 'jarvis.rotationBase';
const MAX_CONVERSATION_TURNS = readTurnLimit(
  import.meta.env.VITE_JARVIS_MAX_CONVERSATION_TURNS,
);
const LIVE_PERSIST_INTERVAL_MS = 2_000;

export default function App() {
  if (window.location.pathname === '/gallery') {
    return <Gallery />;
  }

  return <ChatApp />;
}

function ChatApp() {
  const [conversation, setConversation] = useState(loadConversation);
  const [messages, setMessages] = useState<DisplayMessage[]>(loadTranscript);
  const [rotationBase, setRotationBase] = useState(loadRotationBase);
  const [status, setStatus] = useState<JarvisStatus>('idle');
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const [streaming, setStreaming] = useState(false);
  const [tab, setTab] = useState<MobileTab>('chat');
  const [hud, setHud] = useState<HudRenderState>(loadHudState);
  const abortRef = useRef<AbortController | null>(null);
  const hudAbortRef = useRef<AbortController | null>(null);
  const usherAbortRef = useRef<AbortController | null>(null);
  const activityRef = useRef<ToolActivity[]>([]);
  const liveHudRef = useRef<LiveHudClient | null>(null);
  const activeLiveSubRef = useRef<string | null>(null);
  const hudRef = useRef<HudRenderState>(hud);
  const lastRenderErrorRef = useRef<string | null>(null);
  const lastLivePersistRef = useRef(0);

  useEffect(() => {
    hudRef.current = hud;
  }, [hud]);

  useEffect(() => {
    writeStorage(CONVERSATION_STORAGE_KEY, conversation);
  }, [conversation]);

  useEffect(() => {
    writeStorage(TRANSCRIPT_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    writeStorage(ROTATION_BASE_STORAGE_KEY, String(rotationBase));
  }, [rotationBase]);

  async function handleSend(text: string) {
    const userMsg: DisplayMessage = { role: 'user', content: text };
    const rotate = shouldRotateConversation(
      messages,
      rotationBase,
      MAX_CONVERSATION_TURNS,
    );
    const activeConversation = rotate ? createConversationName() : conversation;

    if (rotate) {
      setConversation(activeConversation);
      setRotationBase(messages.length);
    }

    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: 'assistant', content: '' },
    ]);
    setStreaming(true);
    setStatus('thinking');
    setStatusDetail(undefined);
    // 새 턴의 도구 진행 타임라인을 초기화(이전 턴 잔상 방지).
    activityRef.current = [];

    const controller = new AbortController();
    abortRef.current = controller;
    const usherController = new AbortController();
    usherAbortRef.current = usherController;

    // 본 답변(메인)이 자기 텍스트를 내기 시작하면 즉답을 멈추고 교체한다.
    const mainTookOver = { current: false };
    let usherText = '';

    // 즉답(usher): 본 답변과 병렬로, 자비스 한 문장 선응답을 즉시 흘린다.
    // best-effort — 실패하거나 느려도 본 답변엔 영향 없음.
    const usherTask = (async () => {
      try {
        for await (const delta of streamUsher(text, {
          signal: usherController.signal,
        })) {
          if (mainTookOver.current || usherController.signal.aborted || !delta) {
            continue;
          }
          usherText += delta;
          setMessages((prev) => setLastAssistant(prev, usherText, true));
        }
      } catch {
        // 즉답은 임계경로가 아니다. 조용히 무시.
      }
    })();

    const takeOverFromUsher = () => {
      if (mainTookOver.current) {
        return;
      }
      mainTookOver.current = true;
      usherController.abort();
      // 즉답 라인을 비우고 본 say를 처음부터 흘린다.
      setMessages((prev) => setLastAssistant(prev, '', false));
    };

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
          if (!streamedText) {
            takeOverFromUsher();
          }
          streamedText = true;
          setMessages((prev) => appendToLastAssistant(prev, parsed.text));
        }
        if (parsed.mode === 'envelope' && parsed.sayComplete && !sayComplete) {
          sayComplete = true;
          setStatus('rendering');
          setStatusDetail(undefined);
        }
      }

      // 메인 종료. 교체된 경우 즉답을 끊고, 아니면 즉답이 한 문장을 끝내게 둔다.
      if (mainTookOver.current) {
        usherController.abort();
      }
      await usherTask;

      if (!received) {
        // 본 답변이 비었으면 즉답이라도 확정 라인으로 남긴다.
        if (usherText.trim()) {
          setMessages((prev) => setLastAssistant(prev, usherText, false));
        } else {
          setMessages((prev) =>
            appendToLastAssistant(prev, '(empty response)'),
          );
        }
      } else {
        const finished = parser.finish();
        if (finished.isEnvelope) {
          await finishEnvelopeTurn(
            finished.raw,
            finished.say,
            controller,
            usherText,
          );
        } else if (!streamedText) {
          // 비-envelope인데 스트리밍된 본문이 없음(공백뿐 등). 즉답이 있으면
          // 그대로 확정 라인으로 남기고, 없으면 raw나 빈 응답을 표시(pending 해제).
          const fallback = usherText.trim()
            ? usherText
            : finished.raw.trim()
              ? finished.raw
              : '(empty response)';
          setMessages((prev) => setLastAssistant(prev, fallback, false));
        }
      }

      setStatus('idle');
      setStatusDetail(undefined);
    } catch (err) {
      usherController.abort();
      if (controller.signal.aborted) {
        // 중단(stop/새 대화)으로 끊김 — 즉답 잠정 라인이 남아 있으면 확정 처리.
        setMessages((prev) => clearPending(prev));
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
      usherController.abort();
      await usherTask;
      // 본 HUD로 교체되지 않은 도구 진행 표시가 남지 않게 정리(잔상 방지).
      // rendered/error/idle이면 건드리지 않는다.
      clearHudProgress();
      setStreaming(false);
      abortRef.current = null;
      if (usherAbortRef.current === usherController) {
        usherAbortRef.current = null;
      }
    }
  }

  /**
   * 도구 진행(generating) 표시를 idle로 정리한다. 본 HUD 렌더(rendered)·이전
   * 완성 HUD·에러 상태는 보존하기 위해 generating일 때만 동작한다(함수형
   * 업데이트라 항상 최신 phase를 본다).
   */
  function clearHudProgress() {
    setHud((current) =>
      current.phase === 'generating' ? { phase: 'idle' } : current,
    );
  }

  function handleStop() {
    abortRef.current?.abort();
    hudAbortRef.current?.abort();
    usherAbortRef.current?.abort();
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
    usherAbortRef.current?.abort();
    activityRef.current = [];
    // Topic shift only: long-term memory stays scoped by X-Hermes-Session-Key.
    setConversation(createConversationName());
    setMessages([]);
    setRotationBase(0);
    setHud({ phase: 'idle', message: 'New topic started.' });
    clearHudState();
    setStatus('idle');
    setStatusDetail(undefined);
    lastRenderErrorRef.current = null;
    unsubscribeLiveHud();
  }

  const handleToolEvent = useCallback((event: HermesToolEvent) => {
    const list = activityRef.current;
    setStatus('tooling');

    if (event.phase === 'call') {
      // 새 도구 시작 — 직전 active 항목은 done으로 마감(대개 직전 도구 완료).
      for (const item of list) {
        if (item.status === 'active') item.status = 'done';
      }
      const toolName = formatToolName(event.name);
      list.push({
        id: getToolCallId(event.item) ?? `tool-${list.length}`,
        name: toolName,
        status: 'active',
        detail: extractToolDetail(event.item, 'call'),
      });
      setStatusDetail(toolName);
    } else {
      // output — call_id로 매칭(없으면 마지막 active/마지막 항목).
      const callId = getToolCallId(event.item);
      const target =
        (callId ? list.find((item) => item.id === callId) : undefined) ??
        [...list].reverse().find((item) => item.status === 'active') ??
        list[list.length - 1];
      if (target) {
        target.status = getToolOutcome(event.item);
        const detail = extractToolDetail(event.item, 'output');
        if (detail) target.detail = detail;
        setStatusDetail(
          `${target.name} ${target.status === 'failed' ? 'failed' : 'done'}`,
        );
      }
    }

    // 첫 도구 이벤트에서 generating 진입(도구 안 쓰는 턴은 진행 HUD 안 뜸).
    setHud({
      phase: 'generating',
      activity: list.map((item) => ({ ...item })),
      message: '작업 수행 중',
    });
  }, []);

  async function finishEnvelopeTurn(
    raw: string,
    streamedSay: string,
    controller: AbortController,
    ackText: string,
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
      setMessages((prev) => setLastAssistant(prev, result.say, false));
    } else if (streamedSay) {
      // 스트리밍된 say가 이미 버블에 있음 — 잠정 표시만 해제.
      setMessages((prev) => setLastAssistant(prev, streamedSay, false));
    } else if (ackText.trim()) {
      // 본 say가 없음(HUD 전용 등) — 즉답을 확정 라인으로 남긴다.
      setMessages((prev) => setLastAssistant(prev, ackText, false));
    } else {
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
      // Live pushes arrive at >=1Hz; serializing up to 50KB every tick is
      // wasteful, and the source re-pushes on resubscribe anyway.
      const now = Date.now();
      if (now - lastLivePersistRef.current >= LIVE_PERSIST_INTERVAL_MS) {
        lastLivePersistRef.current = now;
        persistHudState(next);
      }
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

/**
 * 마지막 (비-에러) assistant 메시지의 내용을 통째로 교체하고 잠정(pending)
 * 표시를 설정한다. 즉답(usher)을 흘릴 땐 pending=true, 본 답변으로 확정할 땐
 * pending=false. append와 달리 누적이 아니라 치환이라 즉답→본답변 교체에 쓴다.
 */
function setLastAssistant(
  prev: DisplayMessage[],
  content: string,
  pending: boolean,
): DisplayMessage[] {
  const next = prev.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'assistant' && !next[i].isError) {
      next[i] = { ...next[i], content, pending };
      break;
    }
  }
  return next;
}

/**
 * 마지막 (비-에러) assistant 메시지의 잠정(pending) 표시만 해제한다(내용 보존).
 * 이미 스트리밍된 본문은 그대로 두고 즉답 스타일(이탤릭·dim)만 확정으로 바꾼다.
 * 이미 확정 상태면 같은 배열 참조를 돌려줘 불필요한 리렌더를 피한다.
 */
function clearPending(prev: DisplayMessage[]): DisplayMessage[] {
  const next = prev.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'assistant' && !next[i].isError) {
      if (!next[i].pending) return prev;
      next[i] = { ...next[i], pending: false };
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

function loadConversation(): string {
  return readStorage(CONVERSATION_STORAGE_KEY) ?? createConversationName();
}

function loadRotationBase(): number {
  const parsed = Number(readStorage(ROTATION_BASE_STORAGE_KEY));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function loadTranscript(): DisplayMessage[] {
  const raw = readStorage(TRANSCRIPT_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // 잠정(pending) 표시는 스트리밍 중 한정 상태 — 복원 시 항상 확정으로 둔다.
    return parsed
      .filter(isDisplayMessage)
      .map((message) => ({ ...message, pending: false }));
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
    // Stored JSX may predate current validator rules or be corrupted.
    assertValidHudJsx(parsed.jsx);
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
  if (/(?:^|[^a-z])code/i.test(normalized)) return 'code_execution';
  if (/file|read|write/i.test(normalized)) return 'file';
  return normalized;
}
