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
import { streamChat } from './lib/hermes';
import type { ChatMessage, JarvisStatus } from './types';
import './styles/app.css';
import './hud/styles.css';

type MobileTab = 'chat' | 'hud';

export default function App() {
  if (window.location.pathname === '/gallery') {
    return <Gallery />;
  }

  return <ChatApp />;
}

function ChatApp() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [status, setStatus] = useState<JarvisStatus>('idle');
  const [streaming, setStreaming] = useState(false);
  const [tab, setTab] = useState<MobileTab>('chat');
  const [hud, setHud] = useState<HudRenderState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const hudAbortRef = useRef<AbortController | null>(null);
  const hudRef = useRef<HudRenderState>(hud);
  const lastRenderErrorRef = useRef<string | null>(null);

  useEffect(() => {
    hudRef.current = hud;
  }, [hud]);

  async function handleSend(text: string) {
    const userMsg: DisplayMessage = { role: 'user', content: text };

    // 프론트는 페르소나/베이스 프롬프트를 붙이지 않는다 — 그건 Hermes 튜닝의 몫.
    // 여기선 대화 내용만 그대로 전달한다(에러 의사 메시지는 제외).
    const history: ChatMessage[] = [
      ...messages
        .filter((m) => !m.isError)
        .map(({ role, content }) => ({ role, content })),
      { role: 'user', content: text },
    ];

    // 사용자 메시지 + 비어있는 assistant 메시지(여기에 토큰을 누적)를 먼저 그린다.
    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: 'assistant', content: '' },
    ]);
    setStreaming(true);
    setStatus('thinking');

    const controller = new AbortController();
    abortRef.current = controller;

    if (shouldGenerateHud(text)) {
      void startHudGeneration(text);
    }

    try {
      let received = false;
      for await (const delta of streamChat(history, {
        signal: controller.signal,
      })) {
        received = true;
        setMessages((prev) => appendToLastAssistant(prev, delta));
      }
      // 토큰이 하나도 안 오면 빈 말풍선이 남으므로 안내로 채운다.
      if (!received) {
        setMessages((prev) =>
          appendToLastAssistant(prev, '(응답이 비어 있습니다.)'),
        );
      }
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) {
        // 사용자가 중단함 — 에러 아님.
        setStatus('idle');
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setMessages((prev) => [
          ...dropEmptyTrailingAssistant(prev),
          { role: 'assistant', content: `⚠ 오류: ${message}`, isError: true },
        ]);
        setStatus('warning');
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    hudAbortRef.current?.abort();
    setHud((current) =>
      current.phase === 'generating'
        ? { phase: 'idle', message: 'HUD generation stopped.' }
        : current,
    );
  }

  const setRenderedHud = useCallback((result: HudGenerationResult) => {
    setHud(setRenderedHudState(result));
  }, []);

  const repairRenderedHud = useCallback(
    async (current: HudGenerationResult, errorMessage: string) => {
      const controller = new AbortController();
      hudAbortRef.current?.abort();
      hudAbortRef.current = controller;
      setHud({
        phase: 'generating',
        data: current.data,
        message: `HUD 자기치유 중 (${current.repairCount + 1}/2)`,
        repairCount: current.repairCount,
      });
      setStatus('rendering');

      try {
        const repaired = await repairHudJsx(current, errorMessage, {
          signal: controller.signal,
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
    },
    [setRenderedHud],
  );

  async function startHudGeneration(task: string) {
    const controller = new AbortController();
    hudAbortRef.current?.abort();
    hudAbortRef.current = controller;
    lastRenderErrorRef.current = null;

    const data = getHudData();
    setHud({ phase: 'generating', data, message: 'HUD 생성 중' });
    setStatus('rendering');

    try {
      const result = await generateHudJsx(task, data, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRenderedHud(result);
      setStatus('idle');
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      setRenderedHud(createHudFallback(data, message));
      setStatus('warning');
    } finally {
      if (hudAbortRef.current === controller) hudAbortRef.current = null;
    }
  }

  const handleHudRenderError = useCallback(
    (message: string) => {
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
          jsx: current.jsx,
          data: current.data,
          repairCount: current.repairCount ?? 0,
        },
        message,
      );
    },
    [repairRenderedHud],
  );

  return (
    <div className="app-shell">
      <StatusBar status={status} />

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
      />
    </div>
  );
}

function setRenderedHudState(result: HudGenerationResult): HudRenderState {
  return {
    phase: 'rendered',
    jsx: result.jsx,
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
