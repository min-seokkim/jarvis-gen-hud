import { describe, expect, it } from 'vitest';
import {
  isHudFrameRenderMessage,
  isHudFrameStatusMessage,
} from './hudFrameProtocol';

describe('hudFrameProtocol guards', () => {
  it('accepts well-formed status messages', () => {
    expect(isHudFrameStatusMessage({ type: 'hud:ready' })).toBe(true);
    expect(isHudFrameStatusMessage({ type: 'hud:rendered' })).toBe(true);
    expect(
      isHudFrameStatusMessage({ type: 'hud:error', message: 'boom' }),
    ).toBe(true);
    expect(isHudFrameStatusMessage({ type: 'hud:size', height: 240 })).toBe(
      true,
    );
  });

  it('rejects malformed or foreign messages', () => {
    expect(isHudFrameStatusMessage(null)).toBe(false);
    expect(isHudFrameStatusMessage('hud:ready')).toBe(false);
    expect(isHudFrameStatusMessage({ type: 'hud:error' })).toBe(false);
    expect(
      isHudFrameStatusMessage({ type: 'hud:size', height: Infinity }),
    ).toBe(false);
    expect(isHudFrameStatusMessage({ type: 'vite:ping' })).toBe(false);
  });

  it('accepts only complete render messages', () => {
    expect(
      isHudFrameRenderMessage({ type: 'hud:render', jsx: '<Panel />', data: {} }),
    ).toBe(true);
    expect(isHudFrameRenderMessage({ type: 'hud:render', jsx: '<Panel />' })).toBe(
      false,
    );
    expect(
      isHudFrameRenderMessage({ type: 'hud:render', jsx: 1, data: {} }),
    ).toBe(false);
    expect(
      isHudFrameRenderMessage({ type: 'hud:render', jsx: 'x', data: [] }),
    ).toBe(false);
  });
});
