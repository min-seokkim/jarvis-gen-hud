import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';

export interface DisplayMessage extends ChatMessage {
  /** 에러 알림용 의사 메시지(앱을 죽이지 않고 대화 흐름에 표시). */
  isError?: boolean;
}

interface Props {
  messages: DisplayMessage[];
  /** 스트리밍 중인 assistant 메시지에 타이핑 캐럿을 보여줄지. */
  streaming: boolean;
}

/** 좌측 대화 패널 — 토큰이 누적 렌더되는 스트림. */
export function ConversationPanel({ messages, streaming }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  // 새 토큰/메시지가 올 때마다 맨 아래로 따라간다.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  return (
    <section className="panel" aria-label="대화">
      <div className="panel-title">대화</div>
      <div className="messages">
        {messages.length === 0 && (
          <p className="empty-hint">
            명령을 입력하면 자비스가 실시간으로 응답합니다.
          </p>
        )}
        {messages.map((m, i) => {
          const isLastAssistant =
            m.role === 'assistant' && i === messages.length - 1;
          const cls = m.isError ? 'msg error' : `msg ${m.role}`;
          return (
            <div key={i} className={cls}>
              {m.content}
              {streaming && isLastAssistant && !m.isError && (
                <span className="caret" aria-hidden="true" />
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </section>
  );
}
