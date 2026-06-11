import type { HudData } from './hudData';
import { describeHudDataShape } from './hudData';
import { streamResponse, type HermesToolEvent } from './hermes';
import {
  LIVE_HUD_SOURCES,
  normalizeLiveHudSpec,
  type LiveHudSpec,
} from './liveHud';

const ALLOWED_COMPONENTS = [
  'Panel',
  'StatusPanel',
  'ProgressBar',
  'Gauge',
  'PieChart',
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

export interface HudDesign {
  data_kind: string;
  primitives: string[];
  layout: string;
  why: string;
}

export interface HudEnvelope {
  say: string;
  design: HudDesign | null;
  live: LiveHudSpec | null;
  data: HudData;
  jsx: string | null;
}

export interface HudGenerationResult extends HudEnvelope {
  repairCount: number;
}

export interface GenerateHudOptions {
  signal?: AbortSignal;
  conversation?: string | null;
  store?: boolean;
  onToolEvent?: (event: HermesToolEvent) => void;
}

export const HUD_SYSTEM_PROMPT = [
  'You run one unified J.A.R.V.I.S response turn for this local frontend workspace.',
  `When the user refers to this project, repo, app, or workspace, use this project root: ${__JARVIS_PROJECT_ROOT__}.`,
  'Do not silently switch to the Hermes server working directory for project-local questions.',
  'Keep say short and conversational. Put structured detail in the HUD when a HUD is useful.',
  'Output JSON only in this exact key order: {"say": string, "design": object|null, "live": object|null, "data": object, "jsx": string|null}. No markdown.',
  'Use available terminal/code_execution/file tools to collect deterministic data for unfamiliar tasks.',
  'Do not invent or correct numeric values. Put compact tool-derived JSON in data.',
  'When possible, include data._source = { tool, command, exitCode }.',
  'Keep data under 50KB. Summarize large tool output into compact JSON before returning it.',
  'Before jsx, fill design = { data_kind, primitives, layout, why }. This is your visible design decision record.',
  `If the HUD should keep updating without another LLM call, set live = { source, params, intervalMs }. Allowed live sources: ${LIVE_HUD_SOURCES.join(', ')}. Otherwise set live:null.`,
  'Live source guide: disk -> path capacity data for Gauge/PieChart; project -> git status; build_sim -> simulated build Steps/ProgressBar; proc_watch -> manual PID polling.',
  'design.primitives must contain component names only, such as "Chart" or "ProgressBar"; never include props like "Chart kind=bar" in primitives.',
  'Archetype map: progress/pipeline -> Steps + ProgressBar; utilization/capacity -> Gauge + Stat; breakdown/composition -> PieChart + Stat; timeseries/trend -> Chart kind="line" or kind="area"; comparison/ranking -> Chart kind="bar"; signal/waveform -> Waveform; status/overview -> StatusPanel + Badge + KeyValue.',
  'Graphic density: choose 2-3 complementary primitives, lead with a graphic primitive, and use KeyValue only as supporting detail. Avoid repeating the same label-table layout for different tasks.',
  `Allowed JSX components: ${ALLOWED_COMPONENTS.join(', ')}. Use only these components.`,
  'Component props: Panel title state; ProgressBar value label state showPct; Steps steps; StatusPanel label value state hint; Gauge value min max unit label state; PieChart slices label state; Stat label value unit delta state; Chart kind data unit label state; Waveform samples label state; Alert severity title message; Badge text state; KeyValue items.',
  'Valid state/severity values are only stable, info, caution, critical.',
  'No imports. No arbitrary HTML elements. No inline style. No className.',
  'Top-level JSX must be exactly one <Panel>...</Panel> when jsx is not null.',
  'Numbers and arrays in JSX props must reference data.*. Do not hardcode generated numbers or array literals.',
  'A HUD is not a label table. Do not return a KeyValue-only HUD.',
  'For quantitative tasks, include at least one visual primitive: PieChart, Gauge, ProgressBar, Chart, Stat, Steps, or StatusPanel. KeyValue may be supporting detail only.',
  'For KeyValue, create data.summaryItems and use <KeyValue items={data.summaryItems} />.',
  'For Steps, create data.steps and use <Steps steps={data.steps} />.',
  'For Chart, create data.chartData and use <Chart data={data.chartData} />.',
  'For PieChart, create data.slices and use <PieChart slices={data.slices} />.',
  'For Waveform, create data.samples and use <Waveform samples={data.samples} />.',
  'When seed data is already sufficient, pass it through unchanged and choose primitives from the archetype map.',
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
      `Task context: ${task}`,
      `Project root for terminal/file tools: ${__JARVIS_PROJECT_ROOT__}`,
      describeHudDataShape(seedData),
      `Seed data JSON: ${stringifyForPrompt(seedData)}`,
      'Return one JSON envelope only.',
    ].join('\n\n'),
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
        design: null,
        live: null,
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
      'Repair this HUD envelope. It failed validation or rendering.',
      `Error: ${errorMessage}`,
      'Previous envelope/JSX:',
      previous.jsx ?? JSON.stringify(previous),
      `Previous design JSON: ${JSON.stringify(previous.design ?? {})}`,
      describeHudDataShape(previous.data),
      `Available data JSON: ${stringifyForPrompt(previous.data)}`,
      'Return fixed JSON envelope only. Preserve deterministic data values. Reuse or update design before jsx. Use only allowed components/props and data references.',
    ].join('\n\n'),
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
      return createHudFallback(
        previous.data,
        message,
        failedAttempt.repairCount,
      );
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
    design: {
      data_kind: 'render_error',
      primitives: ['Alert'],
      layout: 'single critical fallback panel',
      why: 'Generated HUD failed validation or runtime rendering.',
    },
    live: null,
    jsx: '<Panel title="HUD fallback" state="critical"><Alert severity="critical" title="HUD render failed" message={data.errorMessage} /></Panel>',
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
        design: normalizeDesign(parsed.design),
        live: normalizeLiveHudSpec(parsed.live),
        data: capData(parsed.data),
        jsx: typeof parsed.jsx === 'string' ? parsed.jsx.trim() : null,
      };
    }
  }

  const jsx = extractHudJsx(trimmed);
  return {
    say: '',
    design: {
      data_kind: 'legacy_jsx',
      primitives: inferComponents(jsx).filter(
        (component) => component !== 'Panel',
      ),
      layout: 'legacy JSX extraction',
      why: 'Recovered JSX from a non-envelope response.',
    },
    live: null,
    data: {},
    jsx,
  };
}

export function extractHudJsx(raw: string): string {
  const trimmed = raw.trim();
  const parsed =
    tryParseJson(trimmed) ?? tryParseJson(extractCodeBlock(trimmed));
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
    assertValidHudDesign(envelope.design, envelope.jsx);
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
    throw new Error(
      'HUD JSX cannot use style, className, or raw HTML injection props.',
    );
  }
  if (/#|rgb\(|rgba\(|hsl\(|hsla\(/i.test(trimmed)) {
    throw new Error('HUD JSX cannot contain raw color values.');
  }
  if (/<\/?[a-z][\w-]*\b/.test(trimmed)) {
    throw new Error('HUD JSX cannot use arbitrary HTML elements.');
  }
  if (
    /\b(?:value|steps|samples|data|items|slices)\s*=\s*{\s*\d/.test(trimmed)
  ) {
    throw new Error(
      'HUD JSX must reference deterministic data instead of hardcoded numbers.',
    );
  }
  if (
    /\b(?:items|steps|samples|data|slices)\s*=\s*{\s*(?!data\.)/.test(trimmed)
  ) {
    throw new Error('HUD array props must reference data.* directly.');
  }
  if (
    /\b(?:state|severity)\s*=\s*"(?!stable"|info"|caution"|critical")/.test(
      trimmed,
    )
  ) {
    throw new Error(
      'HUD state props must be stable, info, caution, or critical.',
    );
  }

  const components = new Set(inferComponents(trimmed));

  if (
    components.has('KeyValue') &&
    [...components].every(
      (component) => component === 'Panel' || component === 'KeyValue',
    )
  ) {
    throw new Error(
      'HUD cannot be KeyValue-only. Add a visual primitive such as PieChart, Gauge, ProgressBar, Chart, Stat, Steps, StatusPanel, or Alert.',
    );
  }
  if (!hasVisualPrimitive(components)) {
    throw new Error(
      'HUD must include a visual primitive such as PieChart, Gauge, ProgressBar, Chart, Stat, Steps, StatusPanel, Waveform, or Alert.',
    );
  }
}

function assertValidHudDesign(design: HudDesign | null, jsx: string): void {
  if (!design) {
    throw new Error('HUD envelope must include design when jsx is not null.');
  }
  if (
    typeof design.data_kind !== 'string' ||
    typeof design.layout !== 'string' ||
    typeof design.why !== 'string' ||
    !Array.isArray(design.primitives)
  ) {
    throw new Error(
      'HUD design must include data_kind, primitives, layout, and why.',
    );
  }

  const jsxComponents = new Set(inferComponents(jsx));
  const listed = design.primitives.filter((primitive): primitive is string => {
    return typeof primitive === 'string' && primitive.length > 0;
  });
  if (listed.length === 0) {
    throw new Error('HUD design must list at least one primitive.');
  }
  for (const primitive of listed) {
    if (
      !ALLOWED_COMPONENTS.includes(
        primitive as (typeof ALLOWED_COMPONENTS)[number],
      )
    ) {
      throw new Error(`HUD design lists disallowed primitive: ${primitive}.`);
    }
    if (primitive !== 'Panel' && !jsxComponents.has(primitive)) {
      throw new Error(
        `HUD design primitive is missing from JSX: ${primitive}.`,
      );
    }
  }
}

async function completeHud(
  input: string,
  options: GenerateHudOptions,
): Promise<string> {
  let output = '';
  for await (const delta of streamResponse(
    input,
    options.conversation ?? null,
    {
      signal: options.signal,
      store: options.store,
      instructions: HUD_SYSTEM_PROMPT,
      onToolEvent: options.onToolEvent,
    },
  )) {
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

function normalizeDesign(value: unknown): HudDesign | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return null;
  return {
    data_kind: typeof value.data_kind === 'string' ? value.data_kind : '',
    primitives: Array.isArray(value.primitives)
      ? value.primitives.filter(isString)
      : [],
    layout: typeof value.layout === 'string' ? value.layout : '',
    why: typeof value.why === 'string' ? value.why : '',
  };
}

function inferComponents(jsx: string): string[] {
  const components: string[] = [];
  for (const tag of jsx.matchAll(/<\/?([A-Z][A-Za-z0-9]*)\b/g)) {
    const component = tag[1];
    if (
      !ALLOWED_COMPONENTS.includes(
        component as (typeof ALLOWED_COMPONENTS)[number],
      )
    ) {
      throw new Error(`HUD JSX uses disallowed component: ${component}.`);
    }
    if (!components.includes(component)) components.push(component);
  }
  return components;
}

function hasVisualPrimitive(components: Set<string>): boolean {
  return [
    'StatusPanel',
    'ProgressBar',
    'Gauge',
    'PieChart',
    'Stat',
    'Steps',
    'Chart',
    'Waveform',
    'Alert',
  ].some((component) => components.has(component));
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
