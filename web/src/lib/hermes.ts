import type { ChatMessage } from '../types';

/**
 * Hermes(OpenAI 호환) /v1/chat/completions SSE 스트리밍 클라이언트.
 *
 * 무의존(fetch + ReadableStream)으로 직접 SSE를 파싱한다.
 * - 같은 출처 `/v1/...` 로 호출한다(dev는 Vite 프록시, 배포는 Caddy가 프록시).
 * - **API 키는 여기에 없다.** Authorization 헤더는 프록시 단(서버측)에서 주입된다.
 */

const HERMES_ENDPOINT = '/v1/chat/completions';

// 모델명은 비밀이 아니므로 프론트 env로 둘 수 있다. 서버 기본값을 쓰려면 비워둔다.
const HERMES_MODEL = import.meta.env.VITE_HERMES_MODEL ?? 'hermes';

/** OpenAI 호환 스트리밍 청크에서 우리가 읽는 최소 형태. */
interface ChatCompletionChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
}

export interface StreamOptions {
  signal?: AbortSignal;
  model?: string;
}

/**
 * 메시지 배열을 보내고 assistant 토큰(델타 문자열)을 도착하는 즉시 yield 한다.
 * 호출부는 `for await (const delta of streamChat(...))` 로 누적 렌더하면 된다.
 *
 * @throws 응답이 ok가 아니거나 본문이 없으면 Error. (호출부에서 잡아 에러 상태로 전환)
 */
export async function* streamChat(
  messages: ChatMessage[],
  options: StreamOptions = {},
): AsyncGenerator<string, void, unknown> {
  const response = await fetch(HERMES_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model ?? HERMES_MODEL,
      messages,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(
      `Hermes 응답 오류 ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`,
    );
  }
  if (!response.body) {
    throw new Error('Hermes 응답에 스트림 본문이 없습니다.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE 이벤트는 줄 단위. 마지막 줄은 잘렸을 수 있으니 버퍼에 남긴다.
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!rawLine || !rawLine.startsWith('data:')) continue;

        const payload = rawLine.slice('data:'.length).trim();
        if (payload === '[DONE]') return;

        const delta = extractDelta(payload);
        if (delta) yield delta;
      }
    }
  } finally {
    // 소비자가 중단(break/abort)해도 네트워크 리소스를 풀어준다.
    reader.releaseLock();
  }
}

/** 한 SSE 데이터 청크(JSON)에서 content 델타를 꺼낸다. 깨진 청크는 조용히 무시. */
function extractDelta(payload: string): string | undefined {
  let chunk: ChatCompletionChunk;
  try {
    chunk = JSON.parse(payload);
  } catch {
    return undefined;
  }
  return chunk.choices?.[0]?.delta?.content ?? undefined;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}
