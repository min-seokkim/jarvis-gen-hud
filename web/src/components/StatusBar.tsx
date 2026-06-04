import type { JarvisStatus } from '../types';

const LABELS: Record<JarvisStatus, string> = {
  idle: '대기',
  listening: '청취',
  thinking: '사고',
  rendering: '렌더',
  warning: '경고',
};

interface Props {
  status: JarvisStatus;
}

/** 상단 상태바 — 자비스 상태 표시 (M1은 idle/thinking/warning만 실제 사용). */
export function StatusBar({ status }: Props) {
  const dotClass =
    status === 'thinking'
      ? 'status-dot is-thinking'
      : status === 'warning'
        ? 'status-dot is-warning'
        : 'status-dot';

  return (
    <header className="status-bar">
      <span className="brand">J.A.R.V.I.S</span>
      <span className="spacer" />
      <span className={dotClass} aria-hidden="true" />
      <span className="status-label" role="status">
        {LABELS[status]}
      </span>
    </header>
  );
}
