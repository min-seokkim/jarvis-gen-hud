import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// HermesToolEvent와 동형(모킹된 모듈에서 타입을 import하지 않기 위해 로컬 정의).
type ToolEvt = {
  phase: 'call' | 'output';
  name: string;
  item?: Record<string, unknown>;
};
type MainOpts = { signal: AbortSignal; onToolEvent?: (event: ToolEvt) => void };

// 즉답(usher)·본 답변(main) 스트림을 테스트마다 갈아끼울 수 있게 hoist된 상태로 둔다.
// 나머지 hermes export(createConversationName 등)는 원본을 유지해 hudGenerator가
// 정상 평가되도록 한다.
const { streams } = vi.hoisted(() => ({
  streams: {
    usher: null as ((input: string, opts: { signal: AbortSignal }) => AsyncGenerator<string>) | null,
    main: null as
      | ((input: string, conv: string | null, opts: MainOpts) => AsyncGenerator<string>)
      | null,
  },
}));

vi.mock('./lib/hermes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/hermes')>();
  return {
    ...actual,
    createConversationName: () => 'jarvis-test',
    streamUsher: (input: string, opts: { signal: AbortSignal }) => streams.usher!(input, opts),
    streamResponse: (input: string, conv: string | null, opts: MainOpts) =>
      streams.main!(input, conv, opts),
  };
});

// LiveHud는 WebSocket을 띄우므로 클라이언트만 무력화한다(LIVE_HUD_SOURCES 등
// 다른 export는 hudGenerator가 쓰므로 원본 유지).
vi.mock('./lib/liveHud', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/liveHud')>();
  return {
    ...actual,
    LiveHudClient: class {
      subscribe() {
        return 'sub';
      }
      unsubscribe() {}
      close() {}
    },
  };
});

import App from './App';

const ENVELOPE = (say: string) =>
  JSON.stringify({ say, design: null, live: null, data: {}, jsx: null });

/** signal이 abort될 때까지 매달려 있다가 AbortError로 거절하는 프라미스. */
function untilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal.aborted) return fail();
    signal.addEventListener('abort', fail, { once: true });
  });
}

function send(text: string) {
  fireEvent.change(screen.getByLabelText('명령 입력'), { target: { value: text } });
  fireEvent.click(screen.getByText('전송'));
}

describe('App usher/main 오케스트레이션', () => {
  beforeEach(() => {
    // jsdom엔 scrollIntoView가 없다 — ConversationPanel이 매 메시지마다 호출한다.
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.localStorage.clear();
    streams.usher = null;
    streams.main = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('본 답변의 say가 오면 즉답을 교체하고 잠정 표시를 해제한다', async () => {
    streams.usher = async function* () {
      yield '확인하겠습니다';
    };
    streams.main = async function* () {
      yield ENVELOPE('메인 응답입니다');
    };

    render(<App />);
    send('디스크 상태 보여줘');

    const bubble = await screen.findByText('메인 응답입니다');
    expect(bubble).toHaveClass('assistant');
    expect(bubble).not.toHaveClass('pending');
    // 즉답 문장은 본 답변으로 교체돼 화면에서 사라진다.
    expect(screen.queryByText('확인하겠습니다')).toBeNull();
  });

  it('본 say가 비면(HUD 전용 등) 즉답을 확정 라인으로 남긴다', async () => {
    streams.usher = async function* () {
      yield '바로 살펴보겠습니다';
    };
    streams.main = async function* () {
      yield ENVELOPE(''); // say 없음
    };

    render(<App />);
    send('프로젝트 상태');

    // 스트리밍이 끝나(전송 버튼 복귀) 잠정 표시가 풀린 뒤 확인.
    await waitFor(() => expect(screen.getByText('전송')).toBeInTheDocument());
    const bubble = screen.getByText('바로 살펴보겠습니다');
    expect(bubble).toHaveClass('assistant');
    expect(bubble).not.toHaveClass('pending');
  });

  it('스트리밍 중 중단하면 즉답 잠정 라인의 pending이 풀린다', async () => {
    streams.usher = async function* (_input, { signal }) {
      yield '확인하겠습니다';
      await untilAbort(signal); // 본 답변이 끝날 때까지 매달려 있게 둔다.
    };
    streams.main = async function* (_input, _conv, { signal }) {
      await untilAbort(signal); // 본 답변은 아무 델타도 내지 않고 매달린다.
      yield ''; // 도달 불가(위 await가 reject) — require-yield 충족용.
    };

    render(<App />);
    send('오래 걸리는 작업');

    // 즉답이 잠정(pending)으로 떠야 한다.
    await waitFor(() => {
      const el = screen.getByText('확인하겠습니다');
      expect(el).toHaveClass('pending');
    });

    fireEvent.click(screen.getByText('중단'));

    // 중단 후 pending이 풀리고(이탤릭 dim 고착 방지) 입력이 다시 가능해진다.
    await waitFor(() => expect(screen.getByText('전송')).toBeInTheDocument());
    expect(screen.getByText('확인하겠습니다')).not.toHaveClass('pending');
  });

  it('localStorage에서 복원한 메시지는 pending을 강제로 해제한다', () => {
    window.localStorage.setItem(
      'jarvis.transcript',
      JSON.stringify([
        { role: 'user', content: '질문' },
        { role: 'assistant', content: '복원된 잠정 라인', pending: true },
      ]),
    );

    render(<App />);

    const restored = screen.getByText('복원된 잠정 라인');
    expect(restored).toHaveClass('assistant');
    expect(restored).not.toHaveClass('pending');
  });

  it('도구 이벤트가 오면 진행 타임라인을 띄우고, 본 HUD 완성 시 교체한다', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    streams.usher = async function* () {
      yield '확인하겠습니다';
    };
    streams.main = async function* (_input, _conv, opts) {
      opts.onToolEvent?.({
        phase: 'call',
        name: 'execute_code',
        item: {
          call_id: 'c1',
          name: 'execute_code',
          arguments: '{"code":"df -h /\\nprint(1)"}',
        },
      });
      opts.onToolEvent?.({
        phase: 'output',
        name: 'c1',
        item: {
          call_id: 'c1',
          output: [
            { text: '{"status":"success","output":"Filesystem Size Used\\n/dev/sdd 1% /"}' },
          ],
        },
      });
      await gate; // 본 HUD를 내기 전 진행 타임라인을 관찰할 수 있게 멈춘다.
      yield JSON.stringify({
        say: '디스크는 여유롭습니다',
        design: {
          data_kind: 'capacity',
          primitives: ['Stat'],
          layout: 'single stat',
          why: 'show free space',
        },
        live: null,
        data: { n: 1 },
        jsx: '<Panel title="디스크" state="info"><Stat label="free" value={data.n} state="info" /></Panel>',
      });
    };

    render(<App />);
    send('디스크 사용량');

    // 진행 타임라인: 도구 이름(정제 detail 포함) + 완료 카운트.
    await waitFor(() =>
      expect(screen.getByTestId('hud-progress')).toBeInTheDocument(),
    );
    const progress = screen.getByTestId('hud-progress');
    expect(progress.textContent).toContain('code_execution');
    expect(progress.textContent).toContain('1/1');

    // 본 HUD 완성 → 진행 표시가 렌더된 HUD(iframe)로 교체.
    release();
    await waitFor(() =>
      expect(screen.getByTitle('HUD frame')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('hud-progress')).toBeNull();
  });

  it('도구를 돌았지만 본 HUD가 없으면(jsx:null) 진행 잔상 없이 idle로 정리한다', async () => {
    streams.usher = async function* () {
      yield '확인하겠습니다';
    };
    streams.main = async function* (_input, _conv, opts) {
      opts.onToolEvent?.({
        phase: 'call',
        name: 'execute_code',
        item: { call_id: 'c1', name: 'execute_code', arguments: '{"code":"echo hi"}' },
      });
      opts.onToolEvent?.({
        phase: 'output',
        name: 'c1',
        item: { call_id: 'c1', output: [{ text: '{"status":"success","output":"hi"}' }] },
      });
      yield JSON.stringify({
        say: '확인했습니다',
        design: null,
        live: null,
        data: {},
        jsx: null,
      });
    };

    render(<App />);
    send('간단한 작업');

    await waitFor(() => expect(screen.getByText('전송')).toBeInTheDocument());
    // 진행(generating) 표시가 남지 않고 빈 캔버스(idle)로 정리된다.
    expect(screen.queryByTestId('hud-progress')).toBeNull();
    expect(screen.getByTestId('hud-empty')).toBeInTheDocument();
  });
});
