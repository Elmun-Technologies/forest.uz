import Anthropic from '@anthropic-ai/sdk';
import { AI_DRAFT_POLICY } from '@forest/contracts';
import type { AiCompletion, AiProvider, HealthResult } from './types';

/**
 * Claude adapter (docs/06 "Automation & AI", CLAUDE.md §6) on the official SDK. Drafts are short
 * single requests: low effort, structured JSON output, and the server-side refusal fallback
 * (`fallbacks: 'default'`) so a classifier decline is retried on the recommended model.
 */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const TIMEOUT_MS = 60_000;

export interface ClaudeOptions {
  apiKey: string;
  model?: string;
  /** Tests: a stub server. */
  baseURL?: string;
  fetch?: typeof fetch;
}

export class ClaudeAiProvider implements AiProvider {
  readonly key = 'claude' as const;
  readonly fake = false;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: ClaudeOptions) {
    this.model = opts.model?.trim() || AI_DRAFT_POLICY.defaultModel;
    // Explicit key only: never pick up ANTHROPIC_* variables of the host (credentials live in
    // the encrypted Integration row, CLAUDE.md §13).
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      authToken: null,
      timeout: TIMEOUT_MS,
      maxRetries: 1,
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async complete(input: {
    system: string;
    prompt: string;
    maxTokens: number;
    schema?: Record<string, unknown>;
  }): Promise<AiCompletion> {
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: input.maxTokens,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      system: input.system,
      messages: [{ role: 'user', content: input.prompt }],
      output_config: {
        effort: 'low',
        ...(input.schema ? { format: { type: 'json_schema', schema: input.schema } } : {}),
      },
    });
    const text = res.content
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('')
      .trim();
    const stopped =
      res.stop_reason === 'refusal'
        ? 'refusal'
        : res.stop_reason === 'max_tokens'
          ? 'max_tokens'
          : null;
    return {
      text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      model: res.model,
      stopped,
    };
  }

  /** Health check: the key can read the configured model (no tokens spent). */
  async test(): Promise<HealthResult> {
    try {
      const m = await this.client.models.retrieve(this.model);
      return { ok: true, message: `model ${m.id} available` };
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError)
        return { ok: false, message: 'invalid API key' };
      if (e instanceof Anthropic.NotFoundError)
        return { ok: false, message: `model ${this.model} not available for this key` };
      if (e instanceof Anthropic.APIError)
        return { ok: false, message: `Anthropic API error ${e.status ?? ''}`.trim() };
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}
