import { useRef, useState } from 'react';
import { StatusBar } from './components/StatusBar';
import { ConversationPanel } from './components/ConversationPanel';
import type { DisplayMessage } from './components/ConversationPanel';
import { HudCanvas } from './components/HudCanvas';
import { InputBar } from './components/InputBar';
import { streamChat } from './lib/hermes';
import type { ChatMessage, JarvisStatus } from './types';
import './styles/app.css';

const SYSTEM_PROMPT: ChatMessage = {
  role: 'system',
  content:
    '당신은 엔지니어를 돕는 자비스(J.A.R.V.I.S)입니다. 간결하고 정확하게 한국어로 답하세요.',
};

type MobileTab = 'chat' | 'hud';

export default function App() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [status, setStatus] = useState<JarvisStatus>('idle');
  const [streaming, setStreaming] = useState(false);
  const [tab, setTab] = useState<MobileTab>('chat');
  const abortRef = useRef<AbortController | null>(null);

  async function handleSend(text: string) {
    const userMsg: DisplayMessage = { role: 'user', content: text };

    // 요청에 보낼 히스토리: 에러 의사 메시지는 제외하고 순수 대화만.
    const history: ChatMessage[] = [
      SYSTEM_PROMPT,
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
  }

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
          <HudCanvas />
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

/** 마지막 assistant 메시지에 델타를 이어붙인 새 배열을 반환. */
function appendToLastAssistant(
  prev: DisplayMessage[],
  delta: string,
): DisplayMessage[] {
  const next = prev.slice();
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'assistant' && !next[i].isError) {
      next[i] = { ...next[i], content: next[i].content + delta };
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
