type StreamMode = 'pending' | 'envelope' | 'text';

export interface EnvelopeSayChunk {
  mode: StreamMode;
  text: string;
  sayComplete: boolean;
}

export interface EnvelopeSayFinish {
  raw: string;
  mode: StreamMode;
  say: string;
  isEnvelope: boolean;
}

type ParserState =
  | 'before-open'
  | 'await-key'
  | 'key'
  | 'key-escape'
  | 'after-key'
  | 'before-value'
  | 'skip-value'
  | 'skip-string'
  | 'skip-string-escape'
  | 'say'
  | 'say-escape'
  | 'say-unicode'
  | 'say-done';

export class EnvelopeSayStreamParser {
  private raw = '';
  private mode: StreamMode = 'pending';
  private state: ParserState = 'before-open';
  private currentKey = '';
  private pendingKey = '';
  private say = '';
  private unicode = '';
  private skipDepth = 0;
  private textOffset = 0;

  push(chunk: string): EnvelopeSayChunk {
    if (!chunk) {
      return {
        mode: this.mode,
        text: '',
        sayComplete: this.state === 'say-done',
      };
    }

    this.raw += chunk;

    if (this.mode === 'text') {
      const text = this.raw.slice(this.textOffset);
      this.textOffset = this.raw.length;
      return { mode: 'text', text, sayComplete: false };
    }

    let emitted = '';
    for (const char of chunk) {
      if (this.mode === 'pending' && this.state === 'before-open') {
        if (/\s/.test(char)) continue;
        if (char !== '{') {
          this.mode = 'text';
          this.textOffset = this.raw.length;
          return { mode: 'text', text: this.raw, sayComplete: false };
        }
        this.mode = 'envelope';
      }

      if (this.mode === 'envelope') {
        emitted += this.consumeEnvelopeChar(char);
      }
    }

    return {
      mode: this.mode,
      text: emitted,
      sayComplete: this.state === 'say-done',
    };
  }

  finish(): EnvelopeSayFinish {
    return {
      raw: this.raw,
      mode: this.mode,
      say: this.say,
      isEnvelope: this.mode === 'envelope',
    };
  }

  private consumeEnvelopeChar(char: string): string {
    switch (this.state) {
      case 'before-open':
        this.state = 'await-key';
        return '';
      case 'await-key':
        if (char === '"') {
          this.pendingKey = '';
          this.state = 'key';
        }
        return '';
      case 'key':
        if (char === '\\') {
          this.state = 'key-escape';
        } else if (char === '"') {
          this.currentKey = this.pendingKey;
          this.state = 'after-key';
        } else {
          this.pendingKey += char;
        }
        return '';
      case 'key-escape':
        this.pendingKey += char;
        this.state = 'key';
        return '';
      case 'after-key':
        if (char === ':') this.state = 'before-value';
        return '';
      case 'before-value':
        if (/\s/.test(char)) return '';
        if (this.currentKey === 'say') {
          if (char === '"') this.state = 'say';
          return '';
        }
        return this.startSkippingValue(char);
      case 'say':
        if (char === '\\') {
          this.state = 'say-escape';
          return '';
        }
        if (char === '"') {
          this.state = 'say-done';
          return '';
        }
        this.say += char;
        return char;
      case 'say-escape':
        return this.consumeSayEscape(char);
      case 'say-unicode':
        return this.consumeSayUnicode(char);
      case 'say-done':
        return '';
      case 'skip-value':
        this.consumeSkippedValue(char);
        return '';
      case 'skip-string':
        if (char === '\\') this.state = 'skip-string-escape';
        else if (char === '"') this.state = 'skip-value';
        return '';
      case 'skip-string-escape':
        this.state = 'skip-string';
        return '';
      default:
        return '';
    }
  }

  private consumeSayEscape(char: string): string {
    if (char === 'u') {
      this.unicode = '';
      this.state = 'say-unicode';
      return '';
    }

    const decoded =
      char === 'n'
        ? '\n'
        : char === 'r'
          ? '\r'
          : char === 't'
            ? '\t'
            : char === 'b'
              ? '\b'
              : char === 'f'
                ? '\f'
                : char;
    this.say += decoded;
    this.state = 'say';
    return decoded;
  }

  private consumeSayUnicode(char: string): string {
    this.unicode += char;
    if (this.unicode.length < 4) return '';

    const decoded = String.fromCharCode(Number.parseInt(this.unicode, 16));
    this.say += decoded;
    this.unicode = '';
    this.state = 'say';
    return decoded;
  }

  private startSkippingValue(char: string): string {
    if (char === '"') {
      this.state = 'skip-string';
      return '';
    }
    if (char === '{' || char === '[') {
      this.skipDepth = 1;
      this.state = 'skip-value';
      return '';
    }
    this.skipDepth = 0;
    this.state = 'skip-value';
    this.consumeSkippedValue(char);
    return '';
  }

  private consumeSkippedValue(char: string): void {
    if (char === '"') {
      this.state = 'skip-string';
      return;
    }
    if (char === '{' || char === '[') {
      this.skipDepth += 1;
      return;
    }
    if (char === '}' || char === ']') {
      this.skipDepth -= 1;
      return;
    }
    if (this.skipDepth <= 0 && char === ',') {
      this.state = 'await-key';
    }
  }
}
