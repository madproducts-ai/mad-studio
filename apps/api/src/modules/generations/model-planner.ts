import { Inject, Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { AppSpecSchema, INTEGRATION_RULES, SECTION_KINDS, type AppSpec } from '@mad/planner';
import type { DesignSystem } from '@mad/schema';
import { ENV, type Env } from '../../config/env';

export interface PlannerRequest {
  prompt: string;
  designSystem: DesignSystem;
  signal?: AbortSignal;
}

export interface PlannerDraft {
  spec: AppSpec;
  usage: { input: number; output: number };
  model: string;
  elapsedMs: number;
}

/** The narrow slice of the Claude client the planner needs; tests substitute a fake. */
export interface PlannerClient {
  draft(request: { system: string; prompt: string; signal?: AbortSignal }): Promise<{ spec: AppSpec | null; usage: { input: number; output: number }; stopReason: string | null }>;
}

export class PlannerUnavailableError extends Error {
  constructor(
    public readonly reason: string,
    public readonly retryable: boolean,
  ) {
    super(reason);
    this.name = 'PlannerUnavailableError';
  }
}

const CATALOG_LINES = INTEGRATION_RULES.map((r) => `- ${r.slug}: ${r.label}`).join('\n');

export const PLANNER_SYSTEM_PROMPT = `You are the planning engine of MAD Studio, a tool that turns a one-paragraph brief into a working, editable web or mobile application in under a minute.

Read the user's brief and return an application specification. The specification is materialised by a renderer that owns layout, colour, spacing and sample data; your job is the product decisions: what the app is called, what screens and sections it needs, what data it stores, and which third-party services it connects to.

Rules:
- appName: 2 to 4 words, no trailing punctuation, no generic words like "App" unless natural.
- sections: 3 to 6 for an app shell, 4 to 6 for a marketing site (start with a hero, end with pricing or a call-to-action form). Order them by importance; the first section is what the user sees first.
- section.kind must be one of: ${SECTION_KINDS.join(', ')}. Use "kpis" for a metrics row (3 or 4 metric names), "chart" for a trend (2 to 4 series names), "table" for records (4 to 7 column headers), "kanban" for a pipeline or workflow (3 to 6 lane names), "form" for data entry (3 to 8 field labels), "chat" for a conversation panel (one assistant name), "cards" for a small set of entities, "list" for plain items, "timeline" for activity, "pricing" for plan tiers, "settings" for toggles, "tabs" for switching between record sets, "gallery" for images, "hero" for a marketing headline (items: [headline, primary CTA, secondary CTA]).
- items must be concrete and specific to the brief (real metric names, real column headers, real lane names), never placeholders like "Item 1".
- tables: 2 to 8 PostgreSQL tables in snake_case with snake_case columns. Include id, foreign keys ending in _id, and created_at where sensible. Every table should be referenced by at least one section.
- integrations: only slugs from this catalog, and only those the brief needs or strongly implies (payments → stripe unless another vendor is named; chat → mad-chat; auth → supabase-auth unless another vendor is named; always include postgres):
${CATALOG_LINES}
- intents: the feature areas the brief covers, from the allowed list.
- archetype: internal-tool for back-office and admin tools, saas for multi-tenant products, marketplace for two-sided platforms, marketing-site for landing pages and websites, mobile-app for phone-first apps.
- navLinks, sidebarItems and primaryAction should read like a real product, not like the brief.
- Never include prose, explanations or markdown. Return only the specification.`;

/** Anthropic SDK adapter. Structured output via Zod keeps the model inside the AppSpec contract. */
export const createAnthropicPlannerClient = (env: Pick<Env, 'ANTHROPIC_API_KEY' | 'PLANNER_MODEL' | 'PLANNER_EFFORT' | 'PLANNER_TIMEOUT_MS'>): PlannerClient => {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: env.PLANNER_TIMEOUT_MS, maxRetries: 1 });
  return {
    async draft({ system, prompt, signal }) {
      const response = await client.messages.parse(
        {
          model: env.PLANNER_MODEL,
          max_tokens: 8000,
          thinking: { type: 'adaptive' },
          output_config: { effort: env.PLANNER_EFFORT, format: zodOutputFormat(AppSpecSchema) },
          system,
          messages: [{ role: 'user', content: prompt }],
        },
        { timeout: env.PLANNER_TIMEOUT_MS, ...(signal ? { signal } : {}) },
      );
      return {
        spec: response.parsed_output ?? null,
        usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
        stopReason: response.stop_reason,
      };
    },
  };
};

/**
 * Asks Claude for an AppSpec. Disabled (and `enabled === false`) when no
 * ANTHROPIC_API_KEY is configured; the generation service then uses the
 * deterministic planner. Every failure surfaces as PlannerUnavailableError with
 * a human-readable reason so the studio's console can say what happened.
 */
@Injectable()
export class ModelPlanner {
  private readonly logger = new Logger('ModelPlanner');
  readonly enabled: boolean;
  readonly model: string;
  private readonly client: PlannerClient | null;

  constructor(@Inject(ENV) env: Env, client?: PlannerClient) {
    this.model = env.PLANNER_MODEL;
    this.client = client ?? (env.ANTHROPIC_API_KEY ? createAnthropicPlannerClient(env) : null);
    this.enabled = this.client !== null;
  }

  async draft(request: PlannerRequest): Promise<PlannerDraft> {
    if (!this.client) throw new PlannerUnavailableError('no ANTHROPIC_API_KEY configured', false);
    const startedAt = Date.now();
    const prompt = `Brief:\n${request.prompt.trim()}\n\nDesign system the renderer will use: ${request.designSystem}.`;
    try {
      const result = await this.client.draft({ system: PLANNER_SYSTEM_PROMPT, prompt, ...(request.signal ? { signal: request.signal } : {}) });
      if (!result.spec) {
        throw new PlannerUnavailableError(result.stopReason === 'max_tokens' ? 'the model ran out of output tokens' : result.stopReason === 'refusal' ? 'the model declined the brief' : 'the model returned no specification', result.stopReason !== 'refusal');
      }
      const parsed = AppSpecSchema.safeParse(result.spec);
      if (!parsed.success) throw new PlannerUnavailableError(`specification failed validation: ${parsed.error.issues[0]?.path.join('.') ?? 'unknown field'}`, true);
      return { spec: parsed.data, usage: result.usage, model: this.model, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      if (error instanceof PlannerUnavailableError) throw error;
      throw new PlannerUnavailableError(this.describe(error), this.isRetryable(error));
    }
  }

  private describe(error: unknown): string {
    if (error instanceof Anthropic.AuthenticationError) return 'the Anthropic API key was rejected';
    if (error instanceof Anthropic.PermissionDeniedError) return 'the Anthropic API key lacks access to this model';
    if (error instanceof Anthropic.RateLimitError) return 'the Anthropic API rate limit was hit';
    if (error instanceof Anthropic.APIConnectionTimeoutError) return 'the model did not answer in time';
    if (error instanceof Anthropic.APIConnectionError) return 'could not reach the Anthropic API';
    if (error instanceof Anthropic.APIUserAbortError) return 'the request was cancelled';
    if (error instanceof Anthropic.BadRequestError) return `the Anthropic API rejected the request (${error.message.slice(0, 120)})`;
    if (error instanceof Anthropic.APIError) return `Anthropic API error ${error.status ?? ''}`.trim();
    if (error instanceof Error && error.name === 'AbortError') return 'the request was cancelled';
    this.logger.warn(`Unexpected planner failure: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    return error instanceof Error ? error.message.slice(0, 160) : 'unknown error';
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError || error instanceof Anthropic.BadRequestError) return false;
    return true;
  }
}
