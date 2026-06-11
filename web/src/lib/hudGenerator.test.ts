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
        design: {
          data_kind: 'status/overview',
          primitives: ['StatusPanel', 'KeyValue'],
          layout: 'status summary with supporting facts',
          why: 'A count is best shown as a status readout with detail.',
        },
        live: { source: 'project', params: { root: '.' }, intervalMs: 500 },
        data: { count: 2, summaryItems: [{ k: 'count', v: '2' }] },
        jsx: '<Panel title="X" state="info"><StatusPanel label="Count" value={data.count} state="info" /><KeyValue items={data.summaryItems} /></Panel>',
      }),
    );

    expect(envelope.say).toBe('done');
    expect(envelope.design?.data_kind).toBe('status/overview');
    expect(envelope.live).toEqual({
      source: 'project',
      params: { root: '.' },
      intervalMs: 1000,
    });
    expect(envelope.data.count).toBe(2);
    expect(envelope.jsx).toContain('KeyValue');
    expect(() => assertValidHudEnvelope(envelope)).not.toThrow();
  });

  it('allows jsx:null for false-positive triggers', () => {
    const envelope = extractHudEnvelope(
      '{"say":"No HUD needed.","design":null,"data":{"reason":"chat"},"jsx":null}',
    );

    expect(envelope.jsx).toBeNull();
    expect(() => assertValidHudEnvelope(envelope)).not.toThrow();
  });

  it('extracts JSON from surrounding text', () => {
    const envelope = extractHudEnvelope(
      'Here you go:\n```json\n{"say":"ok","design":null,"data":{},"jsx":null}\n```',
    );

    expect(envelope.say).toBe('ok');
  });

  it('requires design when JSX is present', () => {
    const envelope = extractHudEnvelope(
      JSON.stringify({
        say: 'missing design',
        data: { progress: 50 },
        jsx: '<Panel title="Progress" state="info"><ProgressBar value={data.progress} label="Progress" state="info" showPct /></Panel>',
      }),
    );

    expect(() => assertValidHudEnvelope(envelope)).toThrow(/design/);
  });

  it('rejects design primitives that are absent from JSX', () => {
    const envelope = extractHudEnvelope(
      JSON.stringify({
        say: 'mismatch',
        design: {
          data_kind: 'breakdown/composition',
          primitives: ['PieChart', 'Stat'],
          layout: 'composition plus metric',
          why: 'Composition data should be visual.',
        },
        data: { value: 42 },
        jsx: '<Panel title="Mismatch" state="info"><Stat label="Value" value={data.value} state="info" /></Panel>',
      }),
    );

    expect(() => assertValidHudEnvelope(envelope)).toThrow(/PieChart/);
  });

  it('drops unknown live sources without rejecting the HUD', () => {
    const envelope = extractHudEnvelope(
      JSON.stringify({
        say: 'done',
        design: {
          data_kind: 'status/overview',
          primitives: ['StatusPanel'],
          layout: 'status',
          why: 'summary',
        },
        live: { source: 'unknown_source' },
        data: { count: 2 },
        jsx: '<Panel title="X" state="info"><StatusPanel label="Count" value={data.count} state="info" /></Panel>',
      }),
    );

    expect(envelope.live).toBeNull();
    expect(() => assertValidHudEnvelope(envelope)).not.toThrow();
  });
});

describe('assertValidHudJsx', () => {
  it('rejects hardcoded array props', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="Bad" state="info"><Steps steps={[{ name: "x", status: "done" }]} /></Panel>',
      ),
    ).toThrow(/array props/);

    expect(() =>
      assertValidHudJsx(
        '<Panel title="Bad" state="info"><PieChart slices={[{ label: "Used", value: 14 }]} /></Panel>',
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

  it('rejects KeyValue-only label tables', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="Flat" state="info"><KeyValue items={data.summaryItems} /></Panel>',
      ),
    ).toThrow(/KeyValue-only/);
  });

  it('allows graphic primitives beyond label tables', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="Disk" state="stable"><PieChart slices={data.slices} label="Drive usage" state="stable" /><KeyValue items={data.summaryItems} /></Panel>',
      ),
    ).not.toThrow();

    expect(() =>
      assertValidHudJsx(
        '<Panel title="Capacity" state="stable"><Gauge value={data.usePct} min={data.min} max={data.max} label="Used" state="stable" /><Stat label="Free" value={data.freePct} unit="%" state="stable" /></Panel>',
      ),
    ).not.toThrow();
  });

  it('rejects HUDs with no visual primitive', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="Narrative" state="info"><Badge text="Ready" state="stable" /></Panel>',
      ),
    ).toThrow(/visual primitive/);
  });
});
