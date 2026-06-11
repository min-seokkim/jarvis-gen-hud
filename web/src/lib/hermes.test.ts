import { describe, expect, it } from 'vitest';
import {
  createConversationName,
  extractResponseTextDeltaForTest,
  extractToolEventForTest,
  getHermesSessionKeyForTest,
} from './hermes';

describe('Responses SSE helpers', () => {
  it('extracts output text deltas', () => {
    expect(
      extractResponseTextDeltaForTest({
        event: 'response.output_text.delta',
        data: JSON.stringify({
          type: 'response.output_text.delta',
          delta: 'hello',
        }),
      }),
    ).toBe('hello');
  });

  it('extracts function call tool events', () => {
    const event = extractToolEventForTest({
      event: 'response.output_item.added',
      data: JSON.stringify({
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          name: 'terminal',
        },
      }),
    });

    expect(event).toMatchObject({ phase: 'call', name: 'terminal' });
  });

  it('extracts function output tool events', () => {
    const event = extractToolEventForTest({
      event: 'response.output_item.done',
      data: JSON.stringify({
        type: 'response.output_item.done',
        item: {
          type: 'function_call_output',
          name: 'terminal',
        },
      }),
    });

    expect(event).toMatchObject({ phase: 'output', name: 'terminal' });
  });

  it('creates stable named conversation prefixes', () => {
    const name = createConversationName(new Date('2026-06-11T05:00:00.000Z'));

    expect(name).toBe('jarvis-2026-06-11T05-00-00-000Z');
  });

  it('uses the stable Jarvis memory scope by default', () => {
    expect(getHermesSessionKeyForTest()).toBe('jarvis:main');
  });
});
