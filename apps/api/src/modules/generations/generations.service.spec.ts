import { describe, expect, it } from 'vitest';
import { firstValueFrom, toArray } from 'rxjs';
import type { AppSpec } from '@mad/planner';
import type { GenerationEvent } from '@mad/schema';
import { loadEnv } from '../../config/env';
import { DEMO_WORKSPACE_ID } from '../../db/seed-data';
import { MemoryRepository } from '../../repositories/memory.repository';
import { ProjectsService } from '../projects/projects.service';
import { GenerationsService } from './generations.service';
import { ModelPlanner, PlannerUnavailableError, type PlannerClient } from './model-planner';

const env = loadEnv({ NODE_ENV: 'test', GENERATION_PACE: '0', PLANNER_MODEL: 'claude-opus-5' } as NodeJS.ProcessEnv);
const PROMPT = 'Build an internal CRM dashboard with Stripe billing and a customer support chat';

const SPEC: AppSpec = {
  appName: 'Pipeline Desk',
  summary: 'CRM with billing and support in one place.',
  archetype: 'internal-tool',
  navLinks: ['Search', 'Docs'],
  sidebarItems: ['Overview', 'Deals', 'Billing', 'Support'],
  primaryAction: 'New deal',
  sections: [
    { title: 'Overview', subtitle: '', eyebrow: '', kind: 'kpis', items: ['Open pipeline', 'MRR', 'Win rate'], actions: [] },
    { title: 'Deals', subtitle: '', eyebrow: '', kind: 'kanban', items: ['Lead', 'Qualified', 'Won'], actions: ['New deal'] },
    { title: 'Support inbox', subtitle: '', eyebrow: '', kind: 'chat', items: ['Support bot'], actions: [] },
  ],
  tables: [{ table: 'deals', columns: ['id', 'name', 'stage', 'amount_cents'] }],
  integrations: ['stripe', 'mad-chat', 'postgres'],
  intents: ['crm', 'billing', 'support-chat'],
};

const fakeClient = (behaviour: 'spec' | 'fail' | 'empty'): PlannerClient => ({
  async draft() {
    if (behaviour === 'fail') throw new PlannerUnavailableError('the Anthropic API rate limit was hit', true);
    return { spec: behaviour === 'spec' ? SPEC : null, usage: { input: 900, output: 410 }, stopReason: behaviour === 'empty' ? 'max_tokens' : 'end_turn' };
  },
});

const boot = (planner: ModelPlanner) => {
  const repo = new MemoryRepository();
  const projects = new ProjectsService(repo);
  return { repo, service: new GenerationsService(repo, env, projects, planner) };
};

const collect = async (service: GenerationsService, id: string): Promise<GenerationEvent[]> => firstValueFrom(service.stream(DEMO_WORKSPACE_ID, id, -1).pipe(toArray()));

describe('GenerationsService', () => {
  it('uses the model plan when the planner answers, renames the project and reports real usage', async () => {
    const { repo, service } = boot(new ModelPlanner(env, fakeClient('spec')));
    const created = await service.create(DEMO_WORKSPACE_ID, { prompt: PROMPT, designSystem: 'tailwind' });
    const events = await collect(service, created.id);

    expect(events[0]).toMatchObject({ type: 'status', status: 'planning', seq: 0 });
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    expect(events.some((e) => e.type === 'log' && e.message.includes('claude-opus-5 planned Pipeline Desk'))).toBe(true);
    expect(events.find((e) => e.type === 'tokens')).toMatchObject({ input: 900, output: 410 });
    expect(events[events.length - 1]?.type).toBe('done');

    const project = await repo.projects.findById(created.projectId);
    expect(project?.name).toBe('Pipeline Desk');
    expect(project?.description).toBe(SPEC.summary);
    expect(project?.status).toBe('ready');
    // The deployment URL is built from the slug, so it has to follow the name the model chose.
    expect(project?.slug).toBe('pipeline-desk');
    const doc = await repo.documents.latest(created.projectId);
    expect(doc?.document.root.name).toBe('Pipeline Desk');
    expect(doc?.document.integrations).toEqual(['stripe', 'mad-chat', 'postgres']);
    expect((await service.get(DEMO_WORKSPACE_ID, created.id)).status).toBe('complete');
  });

  it('does not announce completion before the document is durable', async () => {
    const repo = new MemoryRepository();
    // Record document writes and status writes in the same order the service performs them.
    const order: string[] = [];
    const append = repo.documents.append.bind(repo.documents);
    repo.documents.append = async (...args: Parameters<typeof append>) => {
      const record = await append(...args);
      order.push(`document:v${record.version}`);
      return record;
    };
    const setStatus = repo.generations.setStatus.bind(repo.generations);
    repo.generations.setStatus = async (id: string, status: Parameters<typeof setStatus>[1]) => {
      order.push(`status:${status}`);
      return setStatus(id, status);
    };
    const service = new GenerationsService(repo, env, new ProjectsService(repo), new ModelPlanner(env, fakeClient('spec')));
    const created = await service.create(DEMO_WORKSPACE_ID, { prompt: PROMPT, designSystem: 'tailwind' });
    await new Promise<void>((resolve, reject) => {
      // The subscriber runs synchronously on emit, so this interleaving is exact.
      service.stream(DEMO_WORKSPACE_ID, created.id, -1).subscribe({ next: (event) => order.push(`event:${event.type}`), error: reject, complete: () => resolve() });
    });

    const document = order.indexOf('document:v1');
    expect(document).toBeGreaterThan(0);
    expect(order.indexOf('event:done')).toBeGreaterThan(document);
    expect(order.indexOf('status:complete')).toBeGreaterThan(document);
    expect(order.indexOf('event:node.add')).toBeLessThan(document);
    // The closing events are the last thing that happens, after the write.
    expect(order.slice(document + 1)).toEqual(['status:complete', 'event:status', 'event:done']);
  });

  it('falls back to the deterministic planner when the model fails, and says so', async () => {
    const { repo, service } = boot(new ModelPlanner(env, fakeClient('fail')));
    const created = await service.create(DEMO_WORKSPACE_ID, { prompt: PROMPT, designSystem: 'material' });
    const events = await collect(service, created.id);
    const warning = events.find((e) => e.type === 'log' && e.level === 'warn');
    expect(warning).toMatchObject({ message: expect.stringContaining('rate limit') });
    expect(events[events.length - 1]?.type).toBe('done');
    const project = await repo.projects.findById(created.projectId);
    expect(project?.name).toBe('CRM Dashboard');
    expect((await repo.documents.latest(created.projectId))?.document.designSystem).toBe('material');
  });

  it('treats an empty model answer as a fallback, not a failure', async () => {
    const { service } = boot(new ModelPlanner(env, fakeClient('empty')));
    const created = await service.create(DEMO_WORKSPACE_ID, { prompt: PROMPT, designSystem: 'tailwind' });
    const events = await collect(service, created.id);
    expect(events.some((e) => e.type === 'log' && e.level === 'warn' && e.message.includes('output tokens'))).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect((await service.get(DEMO_WORKSPACE_ID, created.id)).status).toBe('complete');
  });

  it('runs the heuristic planner directly when no key is configured', async () => {
    const planner = new ModelPlanner(env);
    expect(planner.enabled).toBe(false);
    const { service } = boot(planner);
    const created = await service.create(DEMO_WORKSPACE_ID, { prompt: PROMPT, designSystem: 'tailwind' });
    const events = await collect(service, created.id);
    expect(events.filter((e) => e.type === 'status' && e.status === 'planning')).toHaveLength(1);
    expect(events.some((e) => e.type === 'log' && e.level === 'warn')).toBe(false);
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('hides generations that belong to another workspace', async () => {
    const { service } = boot(new ModelPlanner(env));
    const created = await service.create(DEMO_WORKSPACE_ID, { prompt: PROMPT, designSystem: 'tailwind' });
    await collect(service, created.id);
    await expect(service.get('00000000-0000-4000-8000-0000000000ff', created.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(firstValueFrom(service.stream('00000000-0000-4000-8000-0000000000ff', created.id, -1))).rejects.toMatchObject({ code: 'not_found' });
  });
});
