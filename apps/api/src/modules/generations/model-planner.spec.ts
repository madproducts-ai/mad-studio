import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppSpec } from '@mad/planner';
import { loadEnv, type Env } from '../../config/env';
import { ModelPlanner, PLANNER_SYSTEM_PROMPT, PlannerUnavailableError } from './model-planner';

/**
 * Exercises the real Anthropic SDK path against a local stand-in for the API.
 * The unit tests elsewhere substitute a fake PlannerClient, which would keep
 * passing even if the request shape were wrong; this pins the wire contract:
 * model, adaptive thinking, effort, the generated JSON schema, and the mapping
 * of HTTP failures onto PlannerUnavailableError.
 */

const SPEC: AppSpec = {
  appName: 'Depot Control',
  summary: 'Warehouse operations: stock, pickups and supplier invoices.',
  archetype: 'internal-tool',
  navLinks: ['Search', 'Docs'],
  sidebarItems: ['Overview', 'Stock', 'Pickups'],
  primaryAction: 'New pickup',
  sections: [
    { title: 'Overview', subtitle: 'Today', eyebrow: 'ops', kind: 'kpis', items: ['Items on hand', 'Pickups due', 'Fill rate'], actions: [] },
    { title: 'Stock', subtitle: '', eyebrow: '', kind: 'table', items: ['SKU', 'Location', 'On hand', 'Reorder at'], actions: ['Export'] },
  ],
  tables: [{ table: 'stock_items', columns: ['id', 'sku', 'location', 'on_hand', 'created_at'] }],
  integrations: ['postgres'],
  intents: ['dashboard', 'inventory'],
  sampleTerms: ['Pallet 22 short-shipped', 'Cycle count due in aisle 4'],
};

interface Recorded {
  method: string;
  url: string;
  headers: NodeJS.Dict<string | string[]>;
  body: Record<string, unknown>;
}

let server: Server;
let baseUrl: string;
let previousBaseUrl: string | undefined;
const requests: Recorded[] = [];
/** Each test sets how the next response(s) should be produced. */
let respond: (req: Recorded, res: ServerResponse) => void;

const message = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1234, output_tokens: 567 },
    ...extra,
  });

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const raw = await readBody(req);
      const recorded: Recorded = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} };
      requests.push(recorded);
      respond(recorded, res);
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  previousBaseUrl = process.env['ANTHROPIC_BASE_URL'];
  process.env['ANTHROPIC_BASE_URL'] = baseUrl;
});

afterAll(async () => {
  if (previousBaseUrl === undefined) delete process.env['ANTHROPIC_BASE_URL'];
  else process.env['ANTHROPIC_BASE_URL'] = previousBaseUrl;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const envWith = (overrides: Record<string, string> = {}): Env =>
  loadEnv({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'test-key', PLANNER_MODEL: 'claude-opus-5', PLANNER_EFFORT: 'high', PLANNER_TIMEOUT_MS: '5000', ...overrides } as NodeJS.ProcessEnv);

const ok = (_req: Recorded, res: ServerResponse) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(message(JSON.stringify(SPEC)));
};

const failWith = (status: number, type: string) => (_req: Recorded, res: ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message: 'nope' } }));
};

describe('ModelPlanner over the Anthropic SDK', () => {
  it('sends the documented request shape and returns the parsed specification', async () => {
    requests.length = 0;
    respond = ok;
    const planner = new ModelPlanner(envWith());
    expect(planner.enabled).toBe(true);

    const draft = await planner.draft({ prompt: 'Warehouse ops tool for a distributor', designSystem: 'material' });

    expect(draft.spec).toEqual(SPEC);
    expect(draft.usage).toEqual({ input: 1234, output: 567 });
    expect(draft.model).toBe('claude-opus-5');
    expect(draft.elapsedMs).toBeGreaterThanOrEqual(0);

    expect(requests).toHaveLength(1);
    const [request] = requests as [Recorded];
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/v1/messages');
    expect(request.headers['x-api-key']).toBe('test-key');
    expect(request.headers['anthropic-version']).toBeTruthy();

    const body = request.body as {
      model: string;
      max_tokens: number;
      system: string;
      thinking: { type: string };
      output_config: { effort: string; format: { type: string; schema: { properties: Record<string, unknown>; required?: string[] } } };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('claude-opus-5');
    expect(body.max_tokens).toBeGreaterThan(0);
    // Adaptive thinking, never the removed budget_tokens form.
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body).not.toHaveProperty('thinking.budget_tokens');
    expect(body.output_config.effort).toBe('high');
    expect(body.output_config.format.type).toBe('json_schema');
    // The schema really is generated from AppSpecSchema, so the model is constrained to what the renderer can build.
    expect(Object.keys(body.output_config.format.schema.properties)).toEqual(expect.arrayContaining(['appName', 'archetype', 'sections', 'tables', 'integrations']));
    expect(body.system).toBe(PLANNER_SYSTEM_PROMPT);
    expect(body.system).toContain('stripe: Stripe');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.role).toBe('user');
    expect(body.messages[0]?.content).toContain('Warehouse ops tool for a distributor');
    expect(body.messages[0]?.content).toContain('material');
  });

  it('honours the configured model and effort', async () => {
    requests.length = 0;
    respond = ok;
    await new ModelPlanner(envWith({ PLANNER_MODEL: 'claude-sonnet-5', PLANNER_EFFORT: 'low' })).draft({ prompt: 'Simple booking page', designSystem: 'tailwind' });
    const body = (requests[0] as Recorded).body as { model: string; output_config: { effort: string } };
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.output_config.effort).toBe('low');
  });

  it('maps API failures onto readable, correctly-retryable errors', async () => {
    const cases: Array<{ status: number; type: string; reason: RegExp; retryable: boolean }> = [
      { status: 401, type: 'authentication_error', reason: /key was rejected/, retryable: false },
      { status: 403, type: 'permission_error', reason: /lacks access/, retryable: false },
      { status: 400, type: 'invalid_request_error', reason: /rejected the request/, retryable: false },
      { status: 429, type: 'rate_limit_error', reason: /rate limit/, retryable: true },
      { status: 500, type: 'api_error', reason: /Anthropic API error/, retryable: true },
    ];
    for (const c of cases) {
      requests.length = 0;
      respond = failWith(c.status, c.type);
      const planner = new ModelPlanner(envWith());
      const error = await planner.draft({ prompt: 'Anything at all', designSystem: 'tailwind' }).catch((e: unknown) => e);
      expect(error, `${c.status}`).toBeInstanceOf(PlannerUnavailableError);
      expect((error as PlannerUnavailableError).reason, `${c.status}`).toMatch(c.reason);
      expect((error as PlannerUnavailableError).retryable, `${c.status}`).toBe(c.retryable);
    }
  });

  it('rejects a specification the renderer could not build', async () => {
    requests.length = 0;
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      // A well-formed message whose payload violates AppSpecSchema (unknown section kind).
      res.end(message(JSON.stringify({ ...SPEC, sections: [{ ...SPEC.sections[0], kind: 'carousel' }] })));
    };
    const error = await new ModelPlanner(envWith()).draft({ prompt: 'Anything at all', designSystem: 'tailwind' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlannerUnavailableError);
    expect((error as PlannerUnavailableError).reason).toMatch(/unusable specification/);
    expect((error as PlannerUnavailableError).retryable).toBe(true);
  });

  it('treats a truncated answer as retryable rather than a crash', async () => {
    requests.length = 0;
    respond = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(message('{"appName":"Half a spec"', { stop_reason: 'max_tokens' }));
    };
    const error = await new ModelPlanner(envWith()).draft({ prompt: 'Anything at all', designSystem: 'tailwind' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlannerUnavailableError);
    expect((error as PlannerUnavailableError).reason).toMatch(/unusable specification/);
    expect((error as PlannerUnavailableError).retryable).toBe(true);
  });

  it('is disabled, and never calls out, without an API key', async () => {
    requests.length = 0;
    respond = ok;
    const planner = new ModelPlanner(loadEnv({ NODE_ENV: 'test' } as NodeJS.ProcessEnv));
    expect(planner.enabled).toBe(false);
    await expect(planner.draft({ prompt: 'Anything at all', designSystem: 'tailwind' })).rejects.toMatchObject({ reason: 'no ANTHROPIC_API_KEY configured', retryable: false });
    expect(requests).toHaveLength(0);
  });
});
