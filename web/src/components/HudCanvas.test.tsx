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
});
