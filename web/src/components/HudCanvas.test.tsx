import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HudCanvas } from './HudCanvas';

const RENDERED_HUD = {
  phase: 'rendered' as const,
  jsx: '<Panel title="x" state="info"><Stat label="n" value={data.n} state="info" /></Panel>',
  data: { n: 1 },
};

describe('HudCanvas', () => {
  it('hosts generated HUDs in an opaque-origin sandboxed iframe', () => {
    render(<HudCanvas hud={RENDERED_HUD} onRenderError={() => {}} />);

    const frame = screen.getByTitle('HUD frame');
    // allow-same-origin must never be added: it would give generated code
    // access to the app document, storage, and authenticated endpoints.
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('src', '/hud-frame.html');
  });

  it('forwards frame render errors into the repair path', () => {
    const onRenderError = vi.fn();
    render(<HudCanvas hud={RENDERED_HUD} onRenderError={onRenderError} />);

    const frame = screen.getByTitle('HUD frame') as HTMLIFrameElement;
    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'hud:error', message: 'bad jsx' },
        source: frame.contentWindow,
      }),
    );

    expect(onRenderError).toHaveBeenCalledWith('bad jsx');
  });

  it('ignores messages that did not come from the frame', () => {
    const onRenderError = vi.fn();
    render(<HudCanvas hud={RENDERED_HUD} onRenderError={onRenderError} />);

    fireEvent(
      window,
      new MessageEvent('message', {
        data: { type: 'hud:error', message: 'spoofed' },
        source: window,
      }),
    );

    expect(onRenderError).not.toHaveBeenCalled();
  });

  it('shows the fallback panel in error phase', () => {
    render(
      <HudCanvas
        hud={{ phase: 'error', message: 'boom' }}
        onRenderError={() => {}}
      />,
    );

    expect(screen.getByText('HUD render failed')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
  });

  it('generating + activity면 도구 진행 타임라인(HudProgress)을 렌더한다', () => {
    render(
      <HudCanvas
        hud={{
          phase: 'generating',
          activity: [
            { id: 'a', name: 'code_execution', status: 'done', detail: 'df -h /' },
            { id: 'b', name: 'file', status: 'active' },
          ],
        }}
        onRenderError={() => {}}
      />,
    );

    expect(screen.getByTestId('hud-progress')).toBeInTheDocument();
    // 정제된 detail이 스텝 이름에 인라인되어 실제로 보인다.
    expect(screen.getByText('code_execution · df -h /')).toBeInTheDocument();
    expect(screen.getByText('file')).toBeInTheDocument();
    // 완료 카운트(active가 아닌 항목 수)/전체.
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.queryByTestId('hud-skeleton')).toBeNull();
  });

  it('generating인데 activity가 없으면 기존 스켈레톤으로 폴백한다', () => {
    render(<HudCanvas hud={{ phase: 'generating' }} onRenderError={() => {}} />);

    expect(screen.getByTestId('hud-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('hud-progress')).toBeNull();
  });
});
