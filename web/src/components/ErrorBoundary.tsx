import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * 최상위 에러 경계 — 렌더 중 예외가 나도 흰 화면 대신 폴백을 보여준다.
 * (스트리밍/네트워크 에러는 App에서 에러 상태로 처리하고, 여기선 렌더 예외만 잡는다.)
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI 렌더 오류:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <strong>화면 렌더 중 문제가 발생했습니다.</strong>
          <code>{this.state.error.message}</code>
          <button type="button" onClick={() => this.setState({ error: null })}>
            다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
