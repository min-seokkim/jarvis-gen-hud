/**
 * 도구 실행 활동 모델 + best-effort 정제기.
 *
 * envelope 턴이 도구를 도는 동안 HUD에 "도구 실행 타임라인 + 정제 로그"를
 * 라이브로 보여주기 위한 순수 함수들. 정제는 **도구 출력 원문만** 쓰며(첫 줄·
 * 트렁케이트), 추출 실패 시 undefined를 반환해 타임라인만 남긴다. LLM/임의
 * 텍스트로 채우지 않는다(AGENTS: 숫자·로그를 지어내지 않는다).
 *
 * 필드 모양은 Hermes /v1/responses SSE를 실제 캡처해 확인했다(추측 금지):
 * - call  item(function_call): { name, call_id, arguments(JSON 문자열) }
 *     예: arguments = '{"code": "import ...\\n..."}'
 * - output item(function_call_output): { call_id, output, status }
 *     예: output = [{ type:'input_text', text:'{"status":"success","output":"<stdout>",...}' }]
 *   → output 은 배열, 각 원소 text 는 다시 JSON 래퍼이고 실제 stdout 은 .output.
 */
import type { StepStatus } from '../hud/types';

export interface ToolActivity {
  /** call_id(없으면 순번 기반). output 을 call 에 매칭하는 키. */
  id: string;
  /** formatToolName 결과: terminal / code_execution / file / … */
  name: string;
  /** 'active' | 'done' | 'failed' 만 사용. */
  status: StepStatus;
  /** 정제된 명령/출력 한 줄(추출 실패 시 생략). */
  detail?: string;
}

const DETAIL_MAX = 80;
// 정제는 한 줄 detail용이라 거대한 JSON을 파싱할 이유가 없다. 비정상적으로 큰
// 입력은 파싱하지 않고(메인 스레드 블로킹 방지) 건너뛴다 — 호출부가 원문 첫
// 줄로 graceful하게 폴백한다.
const MAX_PARSE_LEN = 200_000;
// 첫 줄 후보를 훑을 상한(거대한 단일 라인도 80자 detail엔 차고 넘친다).
const FIRST_LINE_SCAN = 8_192;

// call arguments 에서 우선순위로 살펴볼 키. 'code'는 execute_code에서 실제 관측됨.
const CALL_ARG_KEYS = [
  'command',
  'cmd',
  'code',
  'query',
  'path',
  'file',
  'input',
  'pattern',
  'url',
] as const;

// output 래퍼/원소에서 실제 텍스트를 담는 키.
const TEXT_KEYS = ['output', 'stdout', 'result', 'text', 'content'] as const;

/**
 * 도구 이벤트 item에서 한 줄 detail을 best-effort로 뽑는다. 실패 시 undefined.
 */
export function extractToolDetail(
  item: Record<string, unknown> | undefined,
  phase: 'call' | 'output',
): string | undefined {
  if (!item) return undefined;
  const raw = phase === 'call' ? readCallArg(item) : readOutputText(item);
  return raw ? firstLineClamp(raw, DETAIL_MAX) : undefined;
}

/** output 을 call 에 매칭하기 위한 call_id(없으면 undefined). */
export function getToolCallId(
  item: Record<string, unknown> | undefined,
): string | undefined {
  if (!item) return undefined;
  return typeof item.call_id === 'string' ? item.call_id : undefined;
}

/**
 * output item이 실패를 나타내면 'failed', 아니면 'done'. 도구/래퍼가 스스로
 * 보고한 status 만 본다(지어내지 않는다).
 */
export function getToolOutcome(
  item: Record<string, unknown> | undefined,
): Extract<StepStatus, 'done' | 'failed'> {
  if (!item) return 'done';
  if (isFailureStatus(item.status)) return 'failed';
  const wrapper = parseJsonObject(flattenText(item.output ?? item.content ?? item.text));
  if (wrapper && isFailureStatus(wrapper.status)) return 'failed';
  return 'done';
}

function isFailureStatus(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.toLowerCase();
  return v === 'failed' || v === 'error' || v === 'incomplete' || v === 'cancelled';
}

function readCallArg(item: Record<string, unknown>): string | undefined {
  const args = parseJsonObject(item.arguments) ?? asObject(item.arguments);
  if (!args) return undefined;
  for (const key of CALL_ARG_KEYS) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function readOutputText(item: Record<string, unknown>): string | undefined {
  const text = flattenText(item.output ?? item.content ?? item.text);
  if (!text) return undefined;
  // 관측된 모양: 실제 stdout 은 JSON 래퍼의 .output(또는 유사 키)에 들어있다.
  const wrapper = parseJsonObject(text);
  if (wrapper) {
    for (const key of TEXT_KEYS) {
      const value = wrapper[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return text;
}

/**
 * 문자열/배열/객체로 올 수 있는 출력 페이로드를 텍스트로 평탄화한다.
 * 배열이면 각 원소의 text/output/content/문자열을 모아 합친다.
 */
function flattenText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (Array.isArray(value)) {
    const parts = value
      .map((element) => textFromElement(element))
      .filter((part): part is string => Boolean(part && part.trim()));
    return parts.length ? parts.join('\n') : undefined;
  }
  if (value && typeof value === 'object') {
    return textFromElement(value);
  }
  return undefined;
}

function textFromElement(element: unknown): string | undefined {
  if (typeof element === 'string') return element;
  if (element && typeof element === 'object') {
    const record = element as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      const value = record[key];
      if (typeof value === 'string') return value;
    }
  }
  return undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  // 너무 큰 입력은 파싱하지 않는다(메인 스레드 freeze 방지) — 원문 폴백.
  if (!trimmed.startsWith('{') || trimmed.length > MAX_PARSE_LEN) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * 첫 비어있지 않은 줄을 골라 공백을 정리하고 max(코드포인트)로 트렁케이트.
 * - 전체를 split하지 않고 \n 단위로만 훑어, 거대한 출력에서도 전체 줄 배열을
 *   만들지 않는다(메인 스레드 보호). 단일 거대 라인도 FIRST_LINE_SCAN까지만 본다.
 * - 절단은 코드포인트 단위(Array.from)라 서로게이트 쌍/이모지가 깨져 lone
 *   surrogate(원문에 없던 깨진 문자)가 되지 않는다.
 */
function firstLineClamp(value: string, max: number): string | undefined {
  let start = 0;
  while (start < value.length) {
    let end = value.indexOf('\n', start);
    if (end === -1) end = value.length;
    const segment = value.slice(start, Math.min(end, start + FIRST_LINE_SCAN));
    const collapsed = segment.replace(/\s+/g, ' ').trim();
    if (collapsed) {
      const chars = Array.from(collapsed);
      return chars.length > max
        ? `${chars.slice(0, max - 1).join('')}…`
        : collapsed;
    }
    start = end + 1;
  }
  return undefined;
}
