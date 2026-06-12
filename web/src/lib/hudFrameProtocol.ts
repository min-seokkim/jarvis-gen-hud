import type { HudData } from './hudData';

/**
 * postMessage protocol between the app and the sandboxed HUD frame
 * (public/hud-frame.html, opaque origin). Both sides must treat incoming
 * messages as untrusted: the frame executes generated code, which can post
 * arbitrary messages to the parent.
 */

/** App -> frame: render this generated JSX against this data snapshot. */
export interface HudFrameRenderMessage {
  type: 'hud:render';
  jsx: string;
  data: HudData;
}

/** Frame -> app. */
export type HudFrameStatusMessage =
  | { type: 'hud:ready' }
  | { type: 'hud:rendered' }
  | { type: 'hud:error'; message: string }
  | { type: 'hud:size'; height: number };

export function isHudFrameRenderMessage(
  value: unknown,
): value is HudFrameRenderMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<HudFrameRenderMessage>;
  return (
    candidate.type === 'hud:render' &&
    typeof candidate.jsx === 'string' &&
    typeof candidate.data === 'object' &&
    candidate.data !== null &&
    !Array.isArray(candidate.data)
  );
}

export function isHudFrameStatusMessage(
  value: unknown,
): value is HudFrameStatusMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; message?: unknown; height?: unknown };
  switch (candidate.type) {
    case 'hud:ready':
    case 'hud:rendered':
      return true;
    case 'hud:error':
      return typeof candidate.message === 'string';
    case 'hud:size':
      return typeof candidate.height === 'number' && Number.isFinite(candidate.height);
    default:
      return false;
  }
}
