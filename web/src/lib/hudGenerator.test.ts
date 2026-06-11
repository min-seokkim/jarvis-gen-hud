import { describe, expect, it } from 'vitest';
import {
  assertValidHudEnvelope,
  assertValidHudJsx,
  extractHudEnvelope,
  shouldGenerateHud,
} from './hudGenerator';

describe('shouldGenerateHud', () => {
  it('detects Korean build-status HUD requests', () => {
    expect(shouldGenerateHud('빌드 상태 보여줘')).toBe(true);
  });

  it('detects English HUD requests', () => {
    expect(shouldGenerateHud('show build status')).toBe(true);
  });

  it('detects project-status HUD requests', () => {
    expect(shouldGenerateHud('이 프로젝트 상태 보여줘')).toBe(true);
    expect(shouldGenerateHud('show project status')).toBe(true);
  });

  it('detects unfamiliar action-style requests', () => {
    expect(shouldGenerateHud('디스크 사용량 확인해줘')).toBe(true);
    expect(shouldGenerateHud('why is the repo dirty?')).toBe(true);
  });

  it('ignores regular chat', () => {
    expect(shouldGenerateHud('오늘 일정 정리해줘')).toBe(false);
  });
});

describe('extractHudEnvelope', () => {
  it('parses JSON envelopes with generated data and JSX', () => {
    const envelope = extractHudEnvelope(
      JSON.stringify({
        say: 'done',
        data: { count: 2, summaryItems: [{ k: 'count', v: '2' }] },
        jsx: '<Panel title="X" state="info"><KeyValue items={data.summaryItems} /></Panel>',
      }),
    );

    expect(envelope.say).toBe('done');
    expect(envelope.data.count).toBe(2);
    expect(envelope.jsx).toContain('KeyValue');
    expect(() => assertValidHudEnvelope(envelope)).not.toThrow();
  });

  it('allows jsx:null for false-positive triggers', () => {
    const envelope = extractHudEnvelope(
      '{"say":"No HUD needed.","data":{"reason":"chat"},"jsx":null}',
    );

    expect(envelope.jsx).toBeNull();
    expect(() => assertValidHudEnvelope(envelope)).not.toThrow();
  });

  it('extracts JSON from surrounding text', () => {
    const envelope = extractHudEnvelope(
      'Here you go:\n```json\n{"say":"ok","data":{},"jsx":null}\n```',
    );

    expect(envelope.say).toBe('ok');
  });
});

describe('assertValidHudJsx', () => {
  it('rejects hardcoded array props', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="Bad" state="info"><Steps steps={[{ name: "x", status: "done" }]} /></Panel>',
      ),
    ).toThrow(/array props/);
  });

  it('rejects invalid state tokens', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="Bad" state="ok"><Alert severity="info" title="x" /></Panel>',
      ),
    ).toThrow(/state props/);
  });
});
