export type HudData = Record<string, unknown>;

export function describeHudDataShape(data: HudData): string {
  const lines = ['provided deterministic seed data shape:'];
  const shape = describeValue(data, 0);
  lines.push(shape.length > 0 ? shape : '- {}');
  lines.push(
    'Seed data is optional. For new tasks, use Hermes tools and return collected results in the envelope data object.',
  );
  return lines.join('\n');
}

function describeValue(value: unknown, depth: number, key = 'data'): string {
  if (depth >= 3) return `- ${key}: ${typeOf(value)}`;

  if (Array.isArray(value)) {
    if (value.length === 0) return `- ${key}: []`;
    return [`- ${key}: Array<${typeOf(value[0])}>`, describeValue(value[0], depth + 1, `${key}[0]`)]
      .filter(Boolean)
      .join('\n');
  }

  if (isRecord(value)) {
    const entries = Object.entries(value).slice(0, 12);
    if (entries.length === 0) return `- ${key}: {}`;
    return entries
      .map(([childKey, childValue]) => describeValue(childValue, depth + 1, `${key}.${childKey}`))
      .join('\n');
  }

  return `- ${key}: ${typeOf(value)}`;
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
