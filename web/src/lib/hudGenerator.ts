import type { ChatMessage } from '../types';
import type { HudData } from './hudData';
import { describeHudDataShape } from './hudData';
import { streamChat } from './hermes';

const ALLOWED_COMPONENTS = [
  'Panel',
  'StatusPanel',
  'ProgressBar',
  'Gauge',
  'Stat',
  'Steps',
  'Chart',
  'Waveform',
  'Alert',
  'Badge',
  'KeyValue',
] as const;

const MAX_REPAIR_ATTEMPTS = 2;
const MAX_DATA_BYTES = 50_000;

export interface HudEnvelope {
  say: string;
  data: HudData;
  jsx: string | null;
}

export interface HudGenerationResult extends HudEnvelope {
  repairCount: number;
}

export interface GenerateHudOptions {
  signal?: AbortSignal;
}

export const HUD_SYSTEM_PROMPT = [
  'You run a J.A.R.V.I.S HUD agent turn.',
  'Output JSON only in this exact shape: {"say": string, "data": object, "jsx": string|null}. No markdown.',
  'Use available terminal/code_execution/file tools to collect deterministic data for unfamiliar tasks.',
  'Do not invent or correct numeric values. Put compact tool-derived JSON in data.',
  'When possible, include data._source = { tool, command, exitCode }.',
  'Keep data under 50KB. Summarize large tool output into compact JSON before returning it.',
  `Allowed JSX components: ${ALLOWED_COMPONENTS.join(', ')}. Use only these components.`,
  'Component props: Panel title state; ProgressBar value label state showPct; Steps steps; StatusPanel label value state hint; Gauge value min max unit label state; Stat label value unit delta state; Chart kind data unit label state; Waveform samples label state; Alert severity title message; Badge text state; KeyValue items.',
  'Valid state/severity values are only stable, info, caution, critical.',
  'No imports. No arbitrary HTML elements. No inline style. No className.',
  'Top-level JSX must be exactly one <Panel>...</Panel> when jsx is not null.',
  'Numbers and arrays in JSX props must reference data.*. Do not hardcode generated numbers or array literals.',
  'A HUD is not a label table. Do not return a KeyValue-only HUD.',
  'For quantitative tasks, include at least one visual primitive: Gauge, ProgressBar, Chart, Stat, Steps, or StatusPanel. KeyValue may be supporting detail only.',
  'For KeyValue, create data.summaryItems and use <KeyValue items={data.summaryItems} />.',
  'For Steps, create data.steps and use <Steps steps={data.steps} />.',
  'For Chart, create data.chartData and use <Chart data={data.chartData} />.',
  'For Waveform, create data.samples and use <Waveform samples={data.samples} />.',
  'For known build status seed data, return data with the provided build object and use <ProgressBar value={data.build.progress} ... /> and <Steps steps={data.build.steps} />.',
  'If a HUD is not useful or data collection fails, return jsx:null and explain briefly in say.',
].join('\n');

export function shouldGenerateHud(input: string): boolean {
  const normalized = input.toLocaleLowerCase();
  const keywords = [
    '빌드',
    'build',
    '상태',
    '보여',
    '확인',
    '봐',
    '얼마나',
    '왜',
    'why',
    'hud',
    '화면',
    '프로젝트',
    'project',
    'repo',
    'repository',
    '저장소',
    '의존성',
    '취약점',
    '디스크',
    'disk',
    '?',
  ];
  return keywords.some((keyword) => normalized.includes(keyword));
}

export async function generateHudJsx(
  task: string,
  seedData: HudData = {},
  options: GenerateHudOptions = {},
): Promise<HudGenerationResult> {
  const raw = await completeHud(
    [
      { role: 'system', content: HUD_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          `Task context: ${task}`,
          `Project root for terminal/file tools: ${__JARVIS_PROJECT_ROOT__}`,
          describeHudDataShape(seedData),
          `Seed data JSON: ${stringifyForPrompt(seedData)}`,
          'Return one JSON envelope only.',
        ].join('\n\n'),
      },
    ],
    options,
  );

  try {
    const envelope = extractHudEnvelope(raw);
    assertValidHudEnvelope(envelope);
    return { ...envelope, repairCount: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return repairHudJsx(
      {
        say: '',
        jsx: raw,
        data: seedData,
        repairCount: 0,
      },
      message,
      options,
    );
  }
}

export async function repairHudJsx(
  previous: HudGenerationResult,
  errorMessage: string,
  options: GenerateHudOptions = {},
): Promise<HudGenerationResult> {
  if (previous.repairCount >= MAX_REPAIR_ATTEMPTS) {
    return createHudFallback(previous.data, errorMessage, previous.repairCount);
  }

  const raw = await completeHud(
    [
      { role: 'system', content: HUD_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          'Repair this HUD envelope. It failed validation or rendering.',
          `Error: ${errorMessage}`,
          'Previous envelope/JSX:',
          previous.jsx ?? JSON.stringify(previous),
          describeHudDataShape(previous.data),
          `Available data JSON: ${stringifyForPrompt(previous.data)}`,
          'Return fixed JSON envelope only. Preserve deterministic data values. Use only allowed components/props and data references.',
        ].join('\n\n'),
      },
    ],
    options,
  );

  try {
    const envelope = extractHudEnvelope(raw);
    assertValidHudEnvelope(envelope);
    return {
      ...envelope,
      repairCount: previous.repairCount + 1,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAttempt = {
      ...previous,
      repairCount: previous.repairCount + 1,
    };
    if (failedAttempt.repairCount >= MAX_REPAIR_ATTEMPTS) {
      return createHudFallback(previous.data, message, failedAttempt.repairCount);
    }
    return repairHudJsx(failedAttempt, message, options);
  }
}

export function createHudFallback(
  data: HudData,
  errorMessage: string,
  repairCount = MAX_REPAIR_ATTEMPTS,
): HudGenerationResult {
  return {
    say: 'HUD render failed.',
    jsx:
      '<Panel title="HUD fallback" state="critical"><Alert severity="critical" title="HUD render failed" message={data.errorMessage} /></Panel>',
    data: { ...data, errorMessage },
    repairCount,
  };
}

export function extractHudEnvelope(raw: string): HudEnvelope {
  const trimmed = raw.trim();
  const candidates = [
    trimmed,
    extractCodeBlock(trimmed),
    extractJsonObject(trimmed),
  ];

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (!parsed) continue;

    if (
      typeof parsed.say === 'string' &&
      isRecord(parsed.data) &&
      (typeof parsed.jsx === 'string' || parsed.jsx === null)
    ) {
      return {
        say: parsed.say,
        data: capData(parsed.data),
        jsx: typeof parsed.jsx === 'string' ? parsed.jsx.trim() : null,
      };
    }
  }

  const jsx = extractHudJsx(trimmed);
  return { say: '', data: {}, jsx };
}

export function extractHudJsx(raw: string): string {
  const trimmed = raw.trim();
  const parsed = tryParseJson(trimmed) ?? tryParseJson(extractCodeBlock(trimmed));
  if (parsed && typeof parsed.jsx === 'string') {
    return parsed.jsx.trim();
  }

  const codeBlock = extractCodeBlock(trimmed);
  if (codeBlock.trim().startsWith('<')) {
    return codeBlock.trim();
  }
  if (trimmed.startsWith('<')) {
    return trimmed;
  }
  throw new Error('HUD response did not contain JSX.');
}

export function assertValidHudEnvelope(envelope: HudEnvelope): void {
  capData(envelope.data);
  if (envelope.jsx !== null) {
    assertValidHudJsx(envelope.jsx);
  }
}

export function assertValidHudJsx(jsx: string): void {
  const trimmed = jsx.trim();
  if (!trimmed.startsWith('<Panel')) {
    throw new Error('Top-level HUD JSX must start with <Panel>.');
  }
  if (!trimmed.endsWith('</Panel>')) {
    throw new Error('Top-level HUD JSX must end with </Panel>.');
  }

  const forbiddenPattern =
    /\b(import|export|window|document|fetch|localStorage|sessionStorage|globalThis|eval|Function)\b/;
  if (forbiddenPattern.test(trimmed)) {
    throw new Error('HUD JSX contains a forbidden global or statement.');
  }
  if (/\b(style|className|dangerouslySetInnerHTML)\s*=/.test(trimmed)) {
    throw new Error('HUD JSX cannot use style, className, or raw HTML injection props.');
  }
  if (/#|rgb\(|rgba\(|hsl\(|hsla\(/i.test(trimmed)) {
    throw new Error('HUD JSX cannot contain raw color values.');
  }
  if (/<\/?[a-z][\w-]*\b/.test(trimmed)) {
    throw new Error('HUD JSX cannot use arbitrary HTML elements.');
  }
  if (/\b(?:value|steps|samples|data|items)\s*=\s*{\s*\d/.test(trimmed)) {
    throw new Error('HUD JSX must reference deterministic data instead of hardcoded numbers.');
  }
  if (/\b(?:items|steps|samples|data)\s*=\s*{\s*(?!data\.)/.test(trimmed)) {
    throw new Error('HUD array props must reference data.* directly.');
  }
  if (/\b(?:state|severity)\s*=\s*"(?!stable"|info"|caution"|critical")/.test(trimmed)) {
    throw new Error('HUD state props must be stable, info, caution, or critical.');
  }

  const components = new Set<string>();
  for (const tag of trimmed.matchAll(/<\/?([A-Z][A-Za-z0-9]*)\b/g)) {
    components.add(tag[1]);
    if (!ALLOWED_COMPONENTS.includes(tag[1] as (typeof ALLOWED_COMPONENTS)[number])) {
      throw new Error(`HUD JSX uses disallowed component: ${tag[1]}.`);
    }
  }

  if (
    components.has('KeyValue') &&
    [...components].every((component) => component === 'Panel' || component === 'KeyValue')
  ) {
    throw new Error(
      'HUD cannot be KeyValue-only. Add a visual primitive such as Gauge, ProgressBar, Chart, Stat, Steps, StatusPanel, or Alert.',
    );
  }
}

async function completeHud(
  messages: ChatMessage[],
  options: GenerateHudOptions,
): Promise<string> {
  let output = '';
  for await (const delta of streamChat(messages, { signal: options.signal })) {
    output += delta;
  }
  return output;
}

function tryParseJson(source: string): Record<string, unknown> | undefined {
  if (!source) return undefined;
  try {
    const value = JSON.parse(source) as unknown;
    if (isRecord(value)) return value;
  } catch {
    return undefined;
  }
  return undefined;
}

function extractCodeBlock(source: string): string {
  const match = source.match(/```(?:json|jsx|tsx)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? source;
}

function extractJsonObject(source: string): string {
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return source;
  return source.slice(start, end + 1);
}

function stringifyForPrompt(data: HudData): string {
  return JSON.stringify(capData(data));
}

function capData(data: HudData): HudData {
  const encoded = JSON.stringify(data);
  if (encoded.length <= MAX_DATA_BYTES) return data;

  return {
    _truncated: true,
    _originalBytes: encoded.length,
    preview: encoded.slice(0, MAX_DATA_BYTES),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
