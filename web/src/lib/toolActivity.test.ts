import { describe, expect, it } from 'vitest';
import {
  extractToolDetail,
  getToolCallId,
  getToolOutcome,
} from './toolActivity';

// 아래 모양은 Hermes /v1/responses SSE 실측 캡처에서 가져왔다(스파이크).
const REAL_CALL_ITEM = {
  id: 'fc_4a3b1a87',
  type: 'function_call',
  status: 'completed',
  name: 'execute_code',
  call_id: 'call_xP7TxDdv9eWpLzkVQy0p2fUW',
  arguments:
    '{"code": "import subprocess, json\\ncmds = [\\"df -h /\\"]\\nprint(1)"}',
};

const REAL_OUTPUT_ITEM = {
  id: 'fco_2a7c74fb',
  type: 'function_call_output',
  call_id: 'call_xP7TxDdv9eWpLzkVQy0p2fUW',
  status: 'completed',
  output: [
    {
      type: 'input_text',
      text: '{"status": "success", "output": "Filesystem      Size  Used Avail Use% Mounted on\\n/dev/sdd       1007G  6.1G  950G   1% /\\n", "tool_calls_made": 0}',
    },
  ],
};

describe('extractToolDetail — call', () => {
  it('실측 execute_code arguments에서 code 첫 줄을 뽑는다', () => {
    expect(extractToolDetail(REAL_CALL_ITEM, 'call')).toBe(
      'import subprocess, json',
    );
  });

  it('command 키를 code보다 우선한다', () => {
    const item = { arguments: '{"command":"df -h /","code":"x"}' };
    expect(extractToolDetail(item, 'call')).toBe('df -h /');
  });

  it('arguments가 이미 객체여도 처리한다', () => {
    const item = { arguments: { cmd: 'git status' } };
    expect(extractToolDetail(item, 'call')).toBe('git status');
  });

  it('알려진 키가 없으면 undefined(타임라인만)', () => {
    expect(extractToolDetail({ arguments: '{"foo":"bar"}' }, 'call')).toBeUndefined();
  });

  it('arguments가 JSON이 아니면 undefined', () => {
    expect(extractToolDetail({ arguments: 'not json' }, 'call')).toBeUndefined();
  });

  it('item이 없으면 undefined', () => {
    expect(extractToolDetail(undefined, 'call')).toBeUndefined();
  });
});

describe('extractToolDetail — output', () => {
  it('실측 중첩 output(배열→text→JSON래퍼→.output) 첫 줄을 정리해 뽑는다', () => {
    expect(extractToolDetail(REAL_OUTPUT_ITEM, 'output')).toBe(
      'Filesystem Size Used Avail Use% Mounted on',
    );
  });

  it('output이 평문 문자열이면 첫 줄', () => {
    const item = { output: 'line one\nline two' };
    expect(extractToolDetail(item, 'output')).toBe('line one');
  });

  it('output이 문자열 배열이면 첫 줄', () => {
    const item = { output: ['alpha', 'beta'] };
    expect(extractToolDetail(item, 'output')).toBe('alpha');
  });

  it('JSON 래퍼에 output 키가 없으면 원문 텍스트로 폴백', () => {
    const item = { output: [{ text: '{"status":"ok","value":42}' }] };
    expect(extractToolDetail(item, 'output')).toBe('{"status":"ok","value":42}');
  });

  it('공백/탭을 단일 공백으로 정리한다', () => {
    const item = { output: '  a\t\t b   c  ' };
    expect(extractToolDetail(item, 'output')).toBe('a b c');
  });

  it('80자를 넘으면 …로 트렁케이트(총 길이 80)', () => {
    const long = 'x'.repeat(200);
    const detail = extractToolDetail({ output: long }, 'output');
    expect(detail).toHaveLength(80);
    expect(detail?.endsWith('…')).toBe(true);
  });

  it('빈/누락 출력은 undefined', () => {
    expect(extractToolDetail({ output: '' }, 'output')).toBeUndefined();
    expect(extractToolDetail({ output: '   \n  ' }, 'output')).toBeUndefined();
    expect(extractToolDetail({}, 'output')).toBeUndefined();
  });
});

describe('extractToolDetail — robustness/edge', () => {
  it('이모지 경계에서 잘려도 lone surrogate(깨진 문자)를 만들지 않는다', () => {
    const detail = extractToolDetail({ output: 'a'.repeat(78) + '😀bb' }, 'output');
    // 코드포인트 단위 절단 → 이모지가 통째로 보존된 뒤 ….
    expect(detail).toBe(`${'a'.repeat(78)}😀…`);
    // lone high/low surrogate가 남지 않는다.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(detail ?? '')).toBe(false);
    expect(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(detail ?? '')).toBe(false);
  });

  it('거대한 단일 라인 출력도 첫 줄을 상한 내에서만 처리한다(프리즈 방지)', () => {
    const detail = extractToolDetail({ output: 'BIG' + 'z'.repeat(300_000) }, 'output');
    expect(detail).toHaveLength(80);
    expect(detail?.startsWith('BIG')).toBe(true);
  });

  it('첫 줄만 보고 그 뒤 거대한 내용은 훑지 않는다', () => {
    const detail = extractToolDetail(
      { output: 'first line\n' + 'q'.repeat(300_000) },
      'output',
    );
    expect(detail).toBe('first line');
  });

  it('앞쪽 빈 줄들을 건너뛰고 첫 비어있지 않은 줄을 고른다', () => {
    const detail = extractToolDetail({ output: '\n\n  \n  real content\nmore' }, 'output');
    expect(detail).toBe('real content');
  });

  it('거대한 arguments는 파싱하지 않고 undefined(프리즈 방지)', () => {
    const huge = `{"code":"${'x'.repeat(300_000)}"}`;
    expect(extractToolDetail({ arguments: huge }, 'call')).toBeUndefined();
  });
});

describe('getToolCallId', () => {
  it('call_id를 반환', () => {
    expect(getToolCallId(REAL_OUTPUT_ITEM)).toBe(
      'call_xP7TxDdv9eWpLzkVQy0p2fUW',
    );
  });
  it('call_id가 없으면 undefined(id로 폴백하지 않음 — 매칭 깨짐 방지)', () => {
    expect(getToolCallId({ id: 'fco_x' })).toBeUndefined();
    expect(getToolCallId(undefined)).toBeUndefined();
  });
});

describe('getToolOutcome', () => {
  it('성공 래퍼는 done', () => {
    expect(getToolOutcome(REAL_OUTPUT_ITEM)).toBe('done');
  });
  it('item.status가 실패류면 failed', () => {
    expect(getToolOutcome({ status: 'failed' })).toBe('failed');
    expect(getToolOutcome({ status: 'error' })).toBe('failed');
  });
  it('래퍼 status가 error/failed면 failed', () => {
    const item = { output: [{ text: '{"status":"error","output":"boom"}' }] };
    expect(getToolOutcome(item)).toBe('failed');
  });
  it('정보 없으면 done(기본)', () => {
    expect(getToolOutcome({})).toBe('done');
    expect(getToolOutcome(undefined)).toBe('done');
  });
});
