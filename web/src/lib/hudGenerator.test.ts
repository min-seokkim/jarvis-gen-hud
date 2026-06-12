import { describe, expect, it } from 'vitest';
import {
  assertValidHudEnvelope,
  assertValidHudJsx,
  extractHudEnvelope,
  HUD_SYSTEM_PROMPT,
} from './hudGenerator';

describe('HUD_SYSTEM_PROMPT', () => {
  it('pins the exact push schema of every live source', () => {
    // Live pushes replace data wholesale; if the JSX references keys the
    // source never pushes, the HUD silently blanks on the first tick.
    expect(HUD_SYSTEM_PROMPT).toContain(
      'disk -> {path,totalBytes,usedBytes,freeBytes,usedPct,min,max,state,summaryItems,slices,_source}',
    );
    expect(HUD_SYSTEM_PROMPT).toContain(
      'project -> {root,branch,changedFiles,stagedFiles,unstagedFiles,untrackedFiles,files,summaryItems,_source}',
    );
    expect(HUD_SYSTEM_PROMPT).toContain(
      'build_sim -> {startedAt,elapsedSec,progress,state,steps,summaryItems,_source}',
    );
    expect(HUD_SYSTEM_PROMPT).toContain(
      'proc_watch -> {pid,running,state,summaryItems,_source}',
    );
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

  it('allows forbidden keywords inside attribute strings', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="git fetch 결과" state="info"><Stat label="export bundle" value={data.count} state="info" /></Panel>',
      ),
    ).not.toThrow();
  });

  it('rejects constructor escapes hidden in expression strings', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="x" state="info"><Stat label="y" value={\'\'["constructor"]["constructor"]("window.alert(1)")()} state="info" /></Panel>',
      ),
    ).toThrow(/forbidden/);
  });

  it('rejects computed member access built from string concatenation', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="x" state="info"><Stat label="y" value={\'\'["constr" + "uctor"]} state="info" /></Panel>',
      ),
    ).toThrow(/numeric indexing/);
  });

  it('rejects unicode-escaped identifiers', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="x" state="info"><Stat label="y" value={\\u0064ata.count} state="info" /></Panel>',
      ),
    ).toThrow(/escape sequences/);
  });

  it('rejects arrow functions and template literals', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="x" state="info"><Stat label="y" value={(() => 1)()} state="info" /></Panel>',
      ),
    ).toThrow(/forbidden/);

    expect(() =>
      assertValidHudJsx(
        '<Panel title="x" state="info"><Stat label="y" value={`1`} state="info" /></Panel>',
      ),
    ).toThrow(/template literals/);
  });

  it('rejects function bodies created via method shorthand', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="x" state="info"><Stat label="y" value={({ a() { return 1 } }).a()} state="info" /></Panel>',
      ),
    ).toThrow(/function bodies/);
  });

  it('allows numeric indexing into data arrays', () => {
    expect(() =>
      assertValidHudJsx(
        '<Panel title="Top slice" state="info"><Stat label="Largest" value={data.slices[0].value} state="info" /></Panel>',
      ),
    ).not.toThrow();
  });
});
