import { randomUUID } from 'node:crypto';
import type { Deployment, GenerationEvent, GenerationStatus, GenerationSummary, Integration, MadDocument, Project, ProjectDocument, ProjectIntegration, Session, User, Workspace } from '@mad/schema';
import { ConflictError, NotFoundError } from '../common/errors';
import { DEMO_USER, DEMO_WORKSPACE, INTEGRATION_CATALOG } from '../db/seed-data';
import type { GenerationCompletion, ListOptions, NewGeneration, NewProject, NewSession, NewUser, Page, Repository } from './repository';

const nowIso = () => new Date().toISOString();

export interface MemoryRepositoryOptions {
  /** Password hash for the seeded demo user; without it the demo user cannot sign in. */
  demoPasswordHash?: string;
  demoEmail?: string;
}

/**
 * In-memory repository. Enforces the same invariants as the SQL schema:
 * unique (workspace, slug), unique lower(email), composite (project, version)
 * documents, append-only events keyed by seq, and cascading deletes from
 * users → workspaces → projects. Activated automatically when DATABASE_URL is
 * absent.
 */
export class MemoryRepository implements Repository {
  readonly kind = 'memory' as const;

  private readonly usersById = new Map<string, User>();
  private readonly passwordHashes = new Map<string, string>();
  private readonly sessionsById = new Map<string, Session & { tokenHash: string }>();
  private readonly workspacesById = new Map<string, Workspace>();
  private readonly projectsById = new Map<string, Project>();
  private readonly documentsByProject = new Map<string, ProjectDocument[]>();
  private readonly generationsById = new Map<string, GenerationSummary & { designSystem: string; seed: number | null }>();
  private readonly eventsByGeneration = new Map<string, GenerationEvent[]>();
  private readonly integrationCatalog = new Map<string, Integration>(INTEGRATION_CATALOG.map((i) => [i.slug, i]));
  private readonly projectIntegrationsById = new Map<string, ProjectIntegration>();
  private readonly deploymentsById = new Map<string, Deployment>();

  constructor(options: MemoryRepositoryOptions = {}) {
    const demo: User = { ...DEMO_USER, email: options.demoEmail ?? DEMO_USER.email };
    this.usersById.set(demo.id, demo);
    if (options.demoPasswordHash) this.passwordHashes.set(demo.id, options.demoPasswordHash);
    this.workspacesById.set(DEMO_WORKSPACE.id, DEMO_WORKSPACE);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  readonly users: Repository['users'] = {
    findById: async (id) => this.usersById.get(id) ?? null,
    findByEmail: async (email) => {
      const needle = email.trim().toLowerCase();
      return [...this.usersById.values()].find((u) => u.email.toLowerCase() === needle) ?? null;
    },
    create: async (input: NewUser) => {
      if (await this.users.findByEmail(input.email)) throw new ConflictError('An account with this email already exists.', { email: input.email });
      const user: User = {
        id: randomUUID(),
        email: input.email.trim().toLowerCase(),
        displayName: input.displayName,
        avatarUrl: null,
        plan: 'free',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.usersById.set(user.id, user);
      if (input.passwordHash) this.passwordHashes.set(user.id, input.passwordHash);
      return user;
    },
    getPasswordHash: async (id) => this.passwordHashes.get(id) ?? null,
    setPassword: async (id, hash) => {
      if (!this.usersById.has(id)) throw new NotFoundError('User', id);
      this.passwordHashes.set(id, hash);
    },
    touchLogin: async (id) => {
      const u = this.usersById.get(id);
      if (u) this.usersById.set(id, { ...u, updatedAt: nowIso() });
    },
  };

  readonly sessions: Repository['sessions'] = {
    create: async (input: NewSession) => {
      if (!this.usersById.has(input.userId)) throw new NotFoundError('User', input.userId);
      const session: Session & { tokenHash: string } = {
        id: randomUUID(),
        userId: input.userId,
        tokenHash: input.tokenHash,
        createdAt: nowIso(),
        expiresAt: input.expiresAt,
        lastSeenAt: nowIso(),
        ip: input.ip,
        userAgent: input.userAgent,
        revokedAt: null,
      };
      this.sessionsById.set(session.id, session);
      return this.strip(session);
    },
    findActiveByTokenHash: async (tokenHash) => {
      const now = Date.now();
      const s = [...this.sessionsById.values()].find((x) => x.tokenHash === tokenHash);
      if (!s || s.revokedAt || Date.parse(s.expiresAt) <= now) return null;
      return this.strip(s);
    },
    touch: async (id, lastSeenAt, expiresAt) => {
      const s = this.sessionsById.get(id);
      if (s) this.sessionsById.set(id, { ...s, lastSeenAt, expiresAt });
    },
    revoke: async (id) => {
      const s = this.sessionsById.get(id);
      if (s && !s.revokedAt) this.sessionsById.set(id, { ...s, revokedAt: nowIso() });
    },
    revokeAllForUser: async (userId, exceptId) => {
      let n = 0;
      for (const [id, s] of this.sessionsById) {
        if (s.userId === userId && id !== exceptId && !s.revokedAt) {
          this.sessionsById.set(id, { ...s, revokedAt: nowIso() });
          n += 1;
        }
      }
      return n;
    },
  };

  readonly workspaces: Repository['workspaces'] = {
    findById: async (id) => this.workspacesById.get(id) ?? null,
    findDefaultForUser: async (userId) =>
      [...this.workspacesById.values()].filter((w) => w.ownerId === userId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0] ?? null,
    create: async (ownerId, name, slug) => {
      if (!this.usersById.has(ownerId)) throw new NotFoundError('User', ownerId);
      if (await this.workspaces.slugExists(slug)) throw new ConflictError(`Workspace slug "${slug}" is taken.`, { slug });
      const ws: Workspace = { id: randomUUID(), ownerId, name, slug, createdAt: nowIso(), updatedAt: nowIso() };
      this.workspacesById.set(ws.id, ws);
      return ws;
    },
    slugExists: async (slug) => [...this.workspacesById.values()].some((w) => w.slug === slug),
  };

  readonly projects: Repository['projects'] = {
    list: async (workspaceId, options: ListOptions): Promise<Page<Project>> => {
      const all = [...this.projectsById.values()]
        .filter((p) => p.workspaceId === workspaceId && p.status !== 'archived')
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      const start = options.cursor ? Math.max(0, all.findIndex((p) => p.id === options.cursor) + 1) : 0;
      const items = all.slice(start, start + options.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: start + options.limit < all.length && last ? last.id : null, total: all.length };
    },
    findById: async (id) => this.projectsById.get(id) ?? null,
    create: async (input: NewProject) => {
      if (!this.workspacesById.has(input.workspaceId)) throw new NotFoundError('Workspace', input.workspaceId);
      if (await this.projects.slugExists(input.workspaceId, input.slug)) {
        throw new ConflictError(`A project with slug "${input.slug}" already exists in this workspace.`, { slug: input.slug });
      }
      const project: Project = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        name: input.name,
        slug: input.slug,
        description: input.description,
        designSystem: input.designSystem,
        status: 'draft',
        lastPrompt: null,
        documentVersion: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      this.projectsById.set(project.id, project);
      this.documentsByProject.set(project.id, []);
      return project;
    },
    update: async (id, patch) => {
      const current = this.projectsById.get(id);
      if (!current) throw new NotFoundError('Project', id);
      const next: Project = { ...current, ...patch, updatedAt: nowIso() };
      this.projectsById.set(id, next);
      return next;
    },
    delete: async (id) => {
      if (!this.projectsById.delete(id)) throw new NotFoundError('Project', id);
      this.documentsByProject.delete(id);
      for (const [gid, g] of this.generationsById) {
        if (g.projectId === id) {
          this.generationsById.delete(gid);
          this.eventsByGeneration.delete(gid);
        }
      }
      for (const [pid, pi] of this.projectIntegrationsById) if (pi.projectId === id) this.projectIntegrationsById.delete(pid);
      for (const [did, d] of this.deploymentsById) if (d.projectId === id) this.deploymentsById.delete(did);
    },
    slugExists: async (workspaceId, slug) => [...this.projectsById.values()].some((p) => p.workspaceId === workspaceId && p.slug === slug),
  };

  readonly documents: Repository['documents'] = {
    latest: async (projectId) => {
      const versions = this.documentsByProject.get(projectId);
      return versions && versions.length ? (versions[versions.length - 1] ?? null) : null;
    },
    get: async (projectId, version) => this.documentsByProject.get(projectId)?.find((d) => d.version === version) ?? null,
    append: async (projectId, expectedVersion, document: MadDocument, authoredBy, generationId) => {
      const project = this.projectsById.get(projectId);
      if (!project) throw new NotFoundError('Project', projectId);
      if (project.documentVersion !== expectedVersion) {
        throw new ConflictError('The document was modified by someone else. Reload and try again.', {
          expectedVersion,
          currentVersion: project.documentVersion,
        });
      }
      const version = project.documentVersion + 1;
      const record: ProjectDocument = { projectId, version, document, authoredBy, generationId, createdAt: nowIso() };
      const list = this.documentsByProject.get(projectId) ?? [];
      list.push(record);
      this.documentsByProject.set(projectId, list);
      this.projectsById.set(projectId, { ...project, documentVersion: version, status: project.status === 'draft' || project.status === 'building' ? 'ready' : project.status, updatedAt: nowIso() });
      return record;
    },
    history: async (projectId, limit) => [...(this.documentsByProject.get(projectId) ?? [])].reverse().slice(0, limit),
  };

  readonly generations: Repository['generations'] = {
    create: async (input: NewGeneration) => {
      if (!this.projectsById.has(input.projectId)) throw new NotFoundError('Project', input.projectId);
      const summary: GenerationSummary & { designSystem: string; seed: number | null } = {
        id: input.id,
        projectId: input.projectId,
        prompt: input.prompt,
        status: 'queued',
        streamUrl: `/v1/generations/${input.id}/events`,
        createdAt: nowIso(),
        durationMs: null,
        nodeCount: null,
        completedAt: null,
        error: null,
        designSystem: input.designSystem,
        seed: input.seed,
      };
      this.generationsById.set(summary.id, summary);
      this.eventsByGeneration.set(summary.id, []);
      return this.stripGeneration(summary);
    },
    findById: async (id) => {
      const g = this.generationsById.get(id);
      return g ? this.stripGeneration(g) : null;
    },
    listForProject: async (projectId, limit) =>
      [...this.generationsById.values()]
        .filter((g) => g.projectId === projectId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit)
        .map((g) => this.stripGeneration(g)),
    setStatus: async (id, status: GenerationStatus) => {
      const g = this.generationsById.get(id);
      if (!g) throw new NotFoundError('Generation', id);
      this.generationsById.set(id, { ...g, status });
    },
    complete: async (id, completion: GenerationCompletion) => {
      const g = this.generationsById.get(id);
      if (!g) throw new NotFoundError('Generation', id);
      this.generationsById.set(id, { ...g, ...completion, completedAt: nowIso() });
    },
    appendEvents: async (id, events) => {
      const list = this.eventsByGeneration.get(id);
      if (!list) throw new NotFoundError('Generation', id);
      for (const e of events) {
        if (list.some((x) => x.seq === e.seq)) throw new ConflictError(`Duplicate event seq ${e.seq} for generation ${id}.`);
        list.push(e);
      }
    },
    eventsSince: async (id, afterSeq) => (this.eventsByGeneration.get(id) ?? []).filter((e) => e.seq > afterSeq),
  };

  readonly integrations: Repository['integrations'] = {
    catalog: async () => [...this.integrationCatalog.values()],
    findBySlug: async (slug) => this.integrationCatalog.get(slug) ?? null,
    listForProject: async (projectId) => [...this.projectIntegrationsById.values()].filter((pi) => pi.projectId === projectId),
    attach: async (projectId, slug) => {
      if (!this.projectsById.has(projectId)) throw new NotFoundError('Project', projectId);
      if (!this.integrationCatalog.has(slug)) throw new NotFoundError('Integration', slug);
      const existing = [...this.projectIntegrationsById.values()].find((pi) => pi.projectId === projectId && pi.integrationSlug === slug);
      if (existing) return existing;
      const record: ProjectIntegration = { id: randomUUID(), projectId, integrationSlug: slug, status: 'pending', config: {}, createdAt: nowIso(), updatedAt: nowIso() };
      this.projectIntegrationsById.set(record.id, record);
      return record;
    },
    setStatus: async (id, status, config) => {
      const current = this.projectIntegrationsById.get(id);
      if (!current) throw new NotFoundError('ProjectIntegration', id);
      const next: ProjectIntegration = { ...current, status, config, updatedAt: nowIso() };
      this.projectIntegrationsById.set(id, next);
      return next;
    },
    detach: async (id) => {
      if (!this.projectIntegrationsById.delete(id)) throw new NotFoundError('ProjectIntegration', id);
    },
  };

  readonly deployments: Repository['deployments'] = {
    create: async (projectId, documentVersion, target) => {
      if (!this.projectsById.has(projectId)) throw new NotFoundError('Project', projectId);
      const record: Deployment = { id: randomUUID(), projectId, documentVersion, target, status: 'queued', url: null, createdAt: nowIso(), updatedAt: nowIso() };
      this.deploymentsById.set(record.id, record);
      return record;
    },
    update: async (id, patch) => {
      const current = this.deploymentsById.get(id);
      if (!current) throw new NotFoundError('Deployment', id);
      const next: Deployment = { ...current, ...patch, updatedAt: nowIso() };
      this.deploymentsById.set(id, next);
      return next;
    },
    findById: async (id) => this.deploymentsById.get(id) ?? null,
    listForProject: async (projectId, limit) =>
      [...this.deploymentsById.values()]
        .filter((d) => d.projectId === projectId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit),
  };

  private strip(s: Session & { tokenHash: string }): Session {
    const { tokenHash: _hash, ...session } = s;
    return session;
  }

  private stripGeneration(g: GenerationSummary & { designSystem: string; seed: number | null }): GenerationSummary {
    const { designSystem: _ds, seed: _seed, ...summary } = g;
    return summary;
  }
}
