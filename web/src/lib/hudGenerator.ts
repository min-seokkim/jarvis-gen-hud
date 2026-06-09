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

export interface HudGenerationResult {
  jsx: string;
  data: HudData;
  repairCount: number;
}

export interface GenerateHudOptions {
  signal?: AbortSignal;
}

export const HUD_SYSTEM_PROMPT = [
  'You generate a J.A.R.V.I.S HUD as constrained JSX.',
  'Output JSON only in this exact shape: {"jsx":"<Panel ...>...</Panel>"}. No markdown.',
  `Allowed components: ${ALLOWED_COMPONENTS.join(', ')}. Use only these components.`,
  'No imports. No arbitrary HTML elements. No inline style. No className.',
  'Top-level JSX must be exactly one <Panel>...</Panel>.',
  'Colors must be expressed only through state props: stable, info, caution, critical.',
  'Numbers and series data must reference the given data object, e.g. data.build.progress and data.build.steps.',
  'Do not hardcode or invent numeric values. Deterministic code supplies data.',
  'If the request cannot be represented, return one Panel containing <Alert severity="info" title="Cannot render" message="..." />.',
].join('\n');

export function shouldGenerateHud(input: string): boolean {
  const normalized = input.toLocaleLowerCase();
  return ['빌드', 'build', '상태', '보여', 'hud', '화면'].some((keyword) =>
    normalized.includes(keyword),
  );
}

export async function generateHudJsx(
  task: string,
  data: HudData,
  options: GenerateHudOptions = {},
): Promise<HudGenerationResult> {
  const raw = await completeHud([
    { role: 'system', content: HUD_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `Task context: ${task}`,
        describeHudDataShape(data),
        'For the build status demo, prefer Steps + ProgressBar. Failed steps must be visible through the Steps status.',
      ].join('\n\n'),
    },
  ], options);

  try {
    const jsx = extractHudJsx(raw);
    assertValidHudJsx(jsx);
    return { jsx, data, repairCount: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return repairHudJsx(
      {
        jsx: raw,
        data,
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

  const raw = await completeHud([
    { role: 'system', content: HUD_SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        'Repair this HUD JSX. It failed validation or rendering.',
        `Error: ${errorMessage}`,
        'Previous JSX:',
        previous.jsx,
        describeHudDataShape(previous.data),
        'Return fixed JSON only. Use only allowed components/props and data references.',
      ].join('\n\n'),
    },
  ], options);

  try {
    const jsx = extractHudJsx(raw);
    assertValidHudJsx(jsx);
    return {
      jsx,
      data: previous.data,
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
    jsx:
      '<Panel title="HUD fallback" state="critical"><Alert severity="critical" title="HUD render failed" message={data.errorMessage} /></Panel>',
    data: { ...data, errorMessage },
    repairCount,
  };
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
  if (/\b(?:value|steps|samples|data)\s*=\s*{\s*\d/.test(trimmed)) {
    throw new Error('HUD JSX must reference deterministic data instead of hardcoded numbers.');
  }

  for (const tag of trimmed.matchAll(/<\/?([A-Z][A-Za-z0-9]*)\b/g)) {
    if (!ALLOWED_COMPONENTS.includes(tag[1] as (typeof ALLOWED_COMPONENTS)[number])) {
      throw new Error(`HUD JSX uses disallowed component: ${tag[1]}.`);
    }
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

function tryParseJson(source: string): { jsx?: unknown } | undefined {
  if (!source) return undefined;
  try {
    const value = JSON.parse(source) as unknown;
    if (value && typeof value === 'object') {
      return value as { jsx?: unknown };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function extractCodeBlock(source: string): string {
  const match = source.match(/```(?:json|jsx|tsx)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim() ?? source;
}
