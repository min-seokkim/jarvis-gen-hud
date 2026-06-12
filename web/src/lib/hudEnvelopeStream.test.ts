import { describe, expect, it } from 'vitest';
import { EnvelopeSayStreamParser } from './hudEnvelopeStream';

describe('EnvelopeSayStreamParser', () => {
  it('streams only the say string from an envelope', () => {
    const parser = new EnvelopeSayStreamParser();
    const chunks = [
      '{"sa',
      'y":"Hello',
      ' world","design":null,"live":null,"data":{},"jsx":null}',
    ];

    const output = chunks.map((chunk) => parser.push(chunk).text).join('');

    expect(output).toBe('Hello world');
    expect(parser.finish()).toMatchObject({
      isEnvelope: true,
      say: 'Hello world',
    });
  });

  it('decodes escaped say characters across chunks', () => {
    const parser = new EnvelopeSayStreamParser();

    const output = [
      '{"say":"Quote: \\',
      '" and line\\',
      'n\\u0041","design":null}',
    ]
      .map((chunk) => parser.push(chunk).text)
      .join('');

    expect(output).toBe('Quote: " and line\nA');
    expect(parser.finish().say).toBe(output);
  });

  it('falls back to ordinary text when the stream is not JSON', () => {
    const parser = new EnvelopeSayStreamParser();

    expect(parser.push('hello').text).toBe('hello');
    expect(parser.push(' world').text).toBe(' world');
    expect(parser.finish()).toMatchObject({
      isEnvelope: false,
      raw: 'hello world',
    });
  });

  it('parses envelopes wrapped in a ```json fence', () => {
    const parser = new EnvelopeSayStreamParser();
    const chunks = [
      '```json\n{"say":"Fen',
      'ced","design":null,"live":null,"data":{},"jsx":null}\n```',
    ];

    const output = chunks.map((chunk) => parser.push(chunk).text).join('');

    expect(output).toBe('Fenced');
    expect(parser.finish()).toMatchObject({
      isEnvelope: true,
      say: 'Fenced',
    });
  });

  it('parses envelopes wrapped in a bare fence', () => {
    const parser = new EnvelopeSayStreamParser();

    const output = parser.push(
      '```\n{"say":"Bare","design":null,"live":null,"data":{},"jsx":null}\n```',
    ).text;

    expect(output).toBe('Bare');
    expect(parser.finish()).toMatchObject({ isEnvelope: true, say: 'Bare' });
  });

  it('handles a fence split across chunks with CRLF', () => {
    const parser = new EnvelopeSayStreamParser();
    const chunks = ['``', '`js', 'on\r\n', '{"say":"Split"', ',"jsx":null}'];

    const output = chunks.map((chunk) => parser.push(chunk).text).join('');

    expect(output).toBe('Split');
    expect(parser.finish().isEnvelope).toBe(true);
  });

  it('treats inline code spans as ordinary text', () => {
    const parser = new EnvelopeSayStreamParser();

    expect(parser.push('`hello` there').text).toBe('`hello` there');
    expect(parser.finish().isEnvelope).toBe(false);
  });
});
