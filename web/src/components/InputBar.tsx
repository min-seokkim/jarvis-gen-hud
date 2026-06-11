import { useState, type FormEvent } from 'react';

interface Props {
  /** 전송 가능 여부 (스트리밍 중에는 false). */
  canSend: boolean;
  /** 스트리밍 중이면 중단 버튼을 노출. */
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewConversation: () => void;
}

/** 하단 입력 바 — 텍스트(우선) + 마이크 버튼(M5까지 자리만, 비활성). */
export function InputBar({
  canSend,
  streaming,
  onSend,
  onStop,
  onNewConversation,
}: Props) {
  const [text, setText] = useState('');

  function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || !canSend) return;
    onSend(trimmed);
    setText('');
  }

  return (
    <form className="input-bar" onSubmit={submit}>
      <button
        type="button"
        className="new-conversation"
        onClick={onNewConversation}
        disabled={streaming}
      >
        새 대화
      </button>
      <button
        type="button"
        className="mic"
        disabled
        title="음성 입력 (M5)"
        aria-label="음성 입력 (준비 중)"
      >
        🎤
      </button>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="자비스에게 명령…"
        aria-label="명령 입력"
        autoFocus
      />
      {streaming ? (
        <button type="button" className="stop" onClick={onStop}>
          중단
        </button>
      ) : (
        <button type="submit" disabled={!canSend || text.trim().length === 0}>
          전송
        </button>
      )}
    </form>
  );
}
