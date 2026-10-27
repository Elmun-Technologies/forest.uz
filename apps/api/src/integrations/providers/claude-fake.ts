import type { AiCompletion, AiProvider } from './types';

/**
 * PROVIDERS_MODE=fake stand-in for Claude: deterministic, schema-shaped JSON whose strings say they
 * are fake (never shown as real copy), so the admin flow and tests run without the API.
 */
export class FakeAiProvider implements AiProvider {
  readonly key = 'claude' as const;
  readonly fake = true;

  async complete(input: {
    prompt: string;
    schema?: Record<string, unknown>;
  }): Promise<AiCompletion> {
    const text = input.schema
      ? JSON.stringify(fakeValue(input.schema, 'draft'))
      : `[AI fake] ${input.prompt.slice(0, 80)}`;
    return { text, inputTokens: 0, outputTokens: 0, model: 'fake', stopped: null };
  }
}

function fakeValue(schema: Record<string, unknown>, path: string): unknown {
  if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
    return Object.fromEntries(
      Object.entries(schema.properties as Record<string, Record<string, unknown>>).map(([k, s]) => [
        k,
        fakeValue(s, `${path}.${k}`),
      ]),
    );
  }
  if (schema.type === 'array') return [];
  const max = typeof schema.maxLength === 'number' ? schema.maxLength : 200;
  return `[AI fake] ${path}`.slice(0, max);
}
