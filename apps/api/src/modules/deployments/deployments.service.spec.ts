import { existsSync, rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plan } from '@mad/planner';
import type { Deployment, Project } from '@mad/schema';
import { loadEnv, type Env } from '../../config/env';
import { DEMO_WORKSPACE_ID } from '../../db/seed-data';
import { MemoryRepository } from '../../repositories/memory.repository';
import { ProjectsService } from '../projects/projects.service';
import { DeploymentsService } from './deployments.service';
import { SitePublisher } from './publisher';

/**
 * Deployment publishing against a real (temporary) export root: the pages are
 * written, production keeps one stable folder, and preview snapshots are bounded
 * so the fleet's disk cannot grow forever.
 */

let root: string;
let env: Env;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mad-deploy-'));
  env = loadEnv({ NODE_ENV: 'test', DEPLOY_EXPORT_ROOT: root, CORS_ORIGINS: 'https://studio.example.com' } as NodeJS.ProcessEnv);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const boot = async () => {
  const repo = new MemoryRepository();
  const projects = new ProjectsService(repo);
  const publisher = new SitePublisher(env);
  const service = new DeploymentsService(repo, env, projects, publisher);
  const project = await projects.create(DEMO_WORKSPACE_ID, { name: 'Ops Console', description: 'Test project', designSystem: 'tailwind' });
  await repo.documents.append(project.id, 0, plan('Build an internal CRM dashboard with billing', { pace: 0 }).document, 'ai', null);
  return { repo, service, publisher, project: (await projects.get(DEMO_WORKSPACE_ID, project.id)) as Project };
};

/** Deployments run in the background; wait for the terminal state. */
const settle = async (service: DeploymentsService, project: Project, id: string): Promise<Deployment> => {
  for (let i = 0; i < 200; i += 1) {
    const d = await service.get(DEMO_WORKSPACE_ID, project.id, id);
    if (d.status === 'live' || d.status === 'failed') return d;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('deployment never settled');
};

const deploy = async (service: DeploymentsService, project: Project, target: Deployment['target']): Promise<Deployment> =>
  settle(service, project, (await service.create(DEMO_WORKSPACE_ID, project.id, target)).id);

const pageOf = (publisher: SitePublisher, project: Project, deployment: Deployment): string => join(root, publisher.relativePath(project, deployment), 'index.html');

/** Retention is applied after the new snapshot is already live; wait for it to settle. */
const settleRetention = async (repo: MemoryRepository, projectId: string, expectedLivePreviews: number): Promise<void> => {
  for (let i = 0; i < 200; i += 1) {
    const live = (await repo.deployments.listForProject(projectId, 100)).filter((d) => d.target === 'preview' && d.status === 'live');
    if (live.length === expectedLivePreviews) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('preview retention never settled');
};

describe('DeploymentsService', () => {
  it('publishes a page, a manifest and the document, and refuses an empty project', async () => {
    const { repo, service, publisher, project } = await boot();
    const deployment = await deploy(service, project, 'production');

    expect(deployment.status).toBe('live');
    expect(deployment.url).toBe(`${publisher.publicBase}/ops-console-${project.id.slice(0, 6)}/`);
    expect(existsSync(pageOf(publisher, project, deployment))).toBe(true);
    expect(existsSync(join(root, publisher.relativePath(project, deployment), 'manifest.json'))).toBe(true);
    expect(existsSync(join(root, publisher.relativePath(project, deployment), 'document.json'))).toBe(true);
    expect((await repo.projects.findById(project.id))?.status).toBe('deployed');

    const empty = await new ProjectsService(repo).create(DEMO_WORKSPACE_ID, { name: 'Nothing Yet', designSystem: 'tailwind' });
    await expect(service.create(DEMO_WORKSPACE_ID, empty.id, 'preview')).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('keeps production on one stable path and previews on their own', async () => {
    const { service, publisher, project } = await boot();
    const first = await deploy(service, project, 'production');
    const second = await deploy(service, project, 'production');
    expect(publisher.relativePath(project, second)).toBe(publisher.relativePath(project, first));
    expect(second.url).toBe(first.url);

    const preview = await deploy(service, project, 'preview');
    expect(publisher.relativePath(project, preview)).toMatch(/\/p\/[0-9a-f]{8}$/);
    expect(preview.url).not.toBe(first.url);
    // A preview never disturbs what production is serving.
    expect(existsSync(pageOf(publisher, project, first))).toBe(true);
  });

  it('bounds preview snapshots: the newest stay reachable, older ones are withdrawn', async () => {
    const { repo, service, publisher, project } = await boot();
    const previews: Deployment[] = [];
    for (let i = 0; i < 7; i += 1) previews.push(await deploy(service, project, 'preview'));
    await settleRetention(repo, project.id, 5);

    const kept = previews.slice(-5);
    const retired = previews.slice(0, -5);
    expect(retired).toHaveLength(2);

    for (const d of kept) {
      const current = await service.get(DEMO_WORKSPACE_ID, project.id, d.id);
      expect(current.status, d.id).toBe('live');
      expect(current.url, d.id).toBeTruthy();
      expect(existsSync(pageOf(publisher, project, d)), d.id).toBe(true);
    }
    for (const d of retired) {
      const current = await service.get(DEMO_WORKSPACE_ID, project.id, d.id);
      expect(current.status, d.id).toBe('rolled-back');
      expect(current.url, d.id).toBeNull();
      expect(existsSync(pageOf(publisher, project, d)), d.id).toBe(false);
    }

    // Pruning is scoped to previews of this project and leaves production alone.
    const production = await deploy(service, project, 'production');
    expect(existsSync(pageOf(publisher, project, production))).toBe(true);
    const live = (await repo.deployments.listForProject(project.id, 100)).filter((d) => d.status === 'live');
    expect(live.filter((d) => d.target === 'preview')).toHaveLength(5);
    expect(live.filter((d) => d.target === 'production')).toHaveLength(1);
  });

  it('refuses to write outside the export root', async () => {
    const { publisher, project } = await boot();
    const escaped: Project = { ...project, slug: '../../escape', id: project.id };
    const deployment: Deployment = { id: '00000000-0000-4000-8000-0000000000aa', projectId: project.id, documentVersion: 1, target: 'production', status: 'queued', url: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    // The slug is sanitised, so a traversal attempt lands inside the root as a plain folder name.
    expect(publisher.relativePath(escaped, deployment)).not.toContain('..');
    expect(join(root, publisher.relativePath(escaped, deployment)).startsWith(root)).toBe(true);
  });
});
