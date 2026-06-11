import { describe, expect, it } from 'vitest';
import { isLiveHudSource, normalizeLiveHudSpec } from './liveHud';

describe('live HUD spec helpers', () => {
  it('accepts known live sources', () => {
    expect(
      normalizeLiveHudSpec({
        source: 'build_sim',
        params: { stepSeconds: 1 },
        intervalMs: 250,
      }),
    ).toEqual({
      source: 'build_sim',
      params: { stepSeconds: 1 },
      intervalMs: 1000,
    });
  });

  it('drops unknown live sources', () => {
    expect(normalizeLiveHudSpec({ source: 'mystery' })).toBeNull();
    expect(isLiveHudSource('disk')).toBe(true);
    expect(isLiveHudSource('mystery')).toBe(false);
  });
});
