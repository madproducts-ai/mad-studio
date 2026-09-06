import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Deployment, GenerationEvent, GenerationSummary, Integration, IntegrationCategory, MadDocument, Project, ProjectDocument, ProjectIntegration, Session, User, Workspace } from '@mad/schema';
import { ConflictError, NotFoundError } from '../common/errors';
import { withRetry } from '../common/retry';
import type { Database } from '../db/client';
import { deployments, generationEvents, generations, integrations, projectDocuments, projectIntegrations, projects, sessions, users, workspaces } from '../db/schema';
import type { GenerationCompletion, Repository } from './repository';

const iso = (d: Date) => d.toISOString();

const mapUser = (r: typeof users.$inferSelect): User => ({ id: r.id, email: r.email, displayName: r.displayName, avatarUrl: r.avatarUrl, plan: r.plan, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) });
const mapSession = (r: typeof sessions.$inferSelect): Session => ({
  id: r.id,
  userId: r.userId,
  createdAt: iso(r.createdAt),
  expiresAt: iso(r.expiresAt),
  lastSeenAt: iso(r.lastSeenAt),
  ip: r.ip,
  userAgent: r.userAgent,
  revokedAt: r.revokedAt ? iso(r.revokedAt) : null,
});
const mapWorkspace = (r: typeof workspaces.$inferSelect): Workspace => ({ id: r.id, ownerId: r.ownerId, name: r.name, slug: r.slug, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) });
const mapProject = (r: typeof projects.$inferSelect): Project => ({
  id: r.id,
  workspaceId: r.workspaceId,
  name: r.name,
  slug: r.slug,
  description: r.description,
  designSystem: r.designSystem,
  status: r.status,
  lastPrompt: r.lastPrompt,
  documentVersion: r.documentVersion,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});
const mapDocument = (r: typeof projectDocuments.$inferSelect): ProjectDocument => ({ projectId: r.projectId, version: r.version, document: r.document, authoredBy: r.authoredBy, generationId: r.generationId, createdAt: iso(r.createdAt) });
const mapGeneration = (r: typeof generations.$inferSelect): GenerationSummary => ({
  id: r.id,
  projectId: r.projectId,
  prompt: r.prompt,
  status: r.status,
  streamUrl: `/v1/generations/${r.id}/events`,
  createdAt: iso(r.createdAt),
  durationMs: r.durationMs,
  nodeCount: r.nodeCount,
  completedAt: r.completedAt ? iso(r.completedAt) : null,
  error: r.error,
});
const mapIntegration = (r: typeof integrations.$inferSelect): Integration => ({
  slug: r.slug,
  name: r.name,
  category: r.category as IntegrationCategory,
  description: r.description,
  scopes: r.scopes,
  docsUrl: r.docsUrl,
  status: r.status as Integration['status'],
});
const mapProjectIntegration = (r: typeof projectIntegrations.$inferSelect): ProjectIntegration => ({ id: r.id, projectId: r.projectId, integrationSlug: r.integrationSlug, status: r.status, config: r.config, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) });
const mapDeployment = (r: typeof deployments.$inferSelect): Deployment => ({ id: r.id, projectId: r.projectId, documentVersion: r.documentVersion, target: r.target, status: r.status, url: r.url, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) });

/** Postgres error codes that are worth retrying (connection-level, not constraint violations). */
const isTransient = (error: unknown): boolean => {
  const code = (error as { code?: string } | null)?.code ?? '';
  return ['57P01', '57P02', '57P03', '08000', '08003', '08006', 'ECONNRESET', 'ETIMEDOUT'].includes(code);
};

const isUniqueViolation = (error: unknown): boolean => (error as { code?: string } | null)?.code === '23505';

export class PgRepository implements Repository {
  readonly kind = 'postgres' as const;

  constructor(private readonly db: Database) {}

  private run<T>(op: () => Promise<T>): Promise<T> {
    return withRetry(op, { attempts: 3, baseMs: 80, shouldRetry: isTransient });
  }

  async ping(): Promise<boolean> {
    try {
      await this.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }

  readonly users: Repository['users'] = {
    findById: (id) => this.run(async () => (await this.db.select().from(users).where(eq(users.id, id)).limit(1)).map(mapUser)[0] ?? null),
    findByEmail: (email) =>
      this.run(async () => (await this.db.select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`).limit(1)).map(mapUser)[0] ?? null),
    create: (input) =>
      this.run(async () => {
        try {
          const [row] = await this.db
            .insert(users)
            .values({ email: input.email.trim().toLowerCase(), displayName: input.displayName, passwordHash: input.passwordHash })
            .returning();
          if (!row) throw new Error('insert returned no row');
          return mapUser(row);
        } catch (error) {
          if (isUniqueViolation(error)) throw new ConflictError('An account with this email already exists.', { email: input.email });
          throw error;
        }
      }),
    getPasswordHash: (id) => this.run(async () => (await this.db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, id)).limit(1))[0]?.hash ?? null),
    setPassword: (id, passwordHash) =>
      this.run(async () => {
        const rows = await this.db.update(users).set({ passwordHash }).where(eq(users.id, id)).returning({ id: users.id });
        if (rows.length === 0) throw new NotFoundError('User', id);
      }),
    touchLogin: (id) =>
      this.run(async () => {
        await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, id));
      }),
  };

  readonly sessions: Repository['sessions'] = {
    create: (input) =>
      this.run(async () => {
        const [row] = await this.db
          .insert(sessions)
          .values({ userId: input.userId, tokenHash: input.tokenHash, expiresAt: new Date(input.expiresAt), ip: input.ip, userAgent: input.userAgent })
          .returning();
        if (!row) throw new Error('insert returned no row');
        return mapSession(row);
      }),
    findActiveByTokenHash: (tokenHash) =>
      this.run(
        async () =>
          (await this.db.select().from(sessions).where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()))).limit(1)).map(mapSession)[0] ?? null,
      ),
    touch: (id, lastSeenAt, expiresAt) =>
      this.run(async () => {
        await this.db.update(sessions).set({ lastSeenAt: new Date(lastSeenAt), expiresAt: new Date(expiresAt) }).where(eq(sessions.id, id));
      }),
    revoke: (id) =>
      this.run(async () => {
        await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
      }),
    revokeAllForUser: (userId, exceptId) =>
      this.run(async () => {
        const where = exceptId ? and(eq(sessions.userId, userId), ne(sessions.id, exceptId), isNull(sessions.revokedAt)) : and(eq(sessions.userId, userId), isNull(sessions.revokedAt));
        const rows = await this.db.update(sessions).set({ revokedAt: new Date() }).where(where).returning({ id: sessions.id });
        return rows.length;
      }),
  };

  readonly workspaces: Repository['workspaces'] = {
    findById: (id) => this.run(async () => (await this.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1)).map(mapWorkspace)[0] ?? null),
    findDefaultForUser: (userId) =>
      this.run(async () => (await this.db.select().from(workspaces).where(eq(workspaces.ownerId, userId)).orderBy(asc(workspaces.createdAt)).limit(1)).map(mapWorkspace)[0] ?? null),
    create: (ownerId, name, slug) =>
      this.run(async () => {
        try {
          const [row] = await this.db.insert(workspaces).values({ ownerId, name, slug }).returning();
          if (!row) throw new Error('insert returned no row');
          return mapWorkspace(row);
        } catch (error) {
          if (isUniqueViolation(error)) throw new ConflictError(`Workspace slug "${slug}" is taken.`, { slug });
          throw error;
        }
      }),
    slugExists: (slug) => this.run(async () => (await this.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1)).length > 0),
  };

  readonly projects: Repository['projects'] = {
    list: (workspaceId, options) =>
      this.run(async () => {
        const where = and(eq(projects.workspaceId, workspaceId), ne(projects.status, 'archived'));
        const [{ count }] = (await this.db.select({ count: sql<number>`count(*)::int` }).from(projects).where(where)) as [{ count: number }];
        const offset = options.cursor ? Number.parseInt(options.cursor, 10) || 0 : 0;
        const rows = await this.db.select().from(projects).where(where).orderBy(desc(projects.updatedAt), desc(projects.id)).limit(options.limit + 1).offset(offset);
        const items = rows.slice(0, options.limit).map(mapProject);
        return { items, nextCursor: rows.length > options.limit ? String(offset + options.limit) : null, total: count };
      }),
    findById: (id) => this.run(async () => (await this.db.select().from(projects).where(eq(projects.id, id)).limit(1)).map(mapProject)[0] ?? null),
    create: (input) =>
      this.run(async () => {
        try {
          const [row] = await this.db
            .insert(projects)
            .values({ workspaceId: input.workspaceId, name: input.name, slug: input.slug, description: input.description, designSystem: input.designSystem })
            .returning();
          if (!row) throw new Error('insert returned no row');
          return mapProject(row);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ConflictError(`A project with slug "${input.slug}" already exists in this workspace.`, { slug: input.slug });
          }
          throw error;
        }
      }),
    update: (id, patch) =>
      this.run(async () => {
        const [row] = await this.db.update(projects).set(patch).where(eq(projects.id, id)).returning();
        if (!row) throw new NotFoundError('Project', id);
        return mapProject(row);
      }),
    delete: (id) =>
      this.run(async () => {
        const rows = await this.db.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id });
        if (rows.length === 0) throw new NotFoundError('Project', id);
      }),
    slugExists: (workspaceId, slug) =>
      this.run(async () => (await this.db.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.slug, slug))).limit(1)).length > 0),
  };

  readonly documents: Repository['documents'] = {
    latest: (projectId) =>
      this.run(async () => (await this.db.select().from(projectDocuments).where(eq(projectDocuments.projectId, projectId)).orderBy(desc(projectDocuments.version)).limit(1)).map(mapDocument)[0] ?? null),
    get: (projectId, version) =>
      this.run(async () => (await this.db.select().from(projectDocuments).where(and(eq(projectDocuments.projectId, projectId), eq(projectDocuments.version, version))).limit(1)).map(mapDocument)[0] ?? null),
    append: (projectId, expectedVersion, document: MadDocument, authoredBy, generationId) =>
      this.run(() =>
        this.db.transaction(async (tx) => {
          const [locked] = await tx.select().from(projects).where(eq(projects.id, projectId)).for('update');
          if (!locked) throw new NotFoundError('Project', projectId);
          if (locked.documentVersion !== expectedVersion) {
            throw new ConflictError('The document was modified by someone else. Reload and try again.', { expectedVersion, currentVersion: locked.documentVersion });
          }
          const version = expectedVersion + 1;
          const [row] = await tx.insert(projectDocuments).values({ projectId, version, document, authoredBy, generationId }).returning();
          if (!row) throw new Error('insert returned no row');
          await tx
            .update(projects)
            .set({ documentVersion: version, status: locked.status === 'draft' || locked.status === 'building' ? 'ready' : locked.status })
            .where(eq(projects.id, projectId));
          return mapDocument(row);
        }),
      ),
    history: (projectId, limit) =>
      this.run(async () => (await this.db.select().from(projectDocuments).where(eq(projectDocuments.projectId, projectId)).orderBy(desc(projectDocuments.version)).limit(limit)).map(mapDocument)),
  };

  readonly generations: Repository['generations'] = {
    create: (input) =>
      this.run(async () => {
        const [row] = await this.db
          .insert(generations)
          .values({ id: input.id, projectId: input.projectId, prompt: input.prompt, designSystem: input.designSystem, seed: input.seed })
          .returning();
        if (!row) throw new Error('insert returned no row');
        return mapGeneration(row);
      }),
    findById: (id) => this.run(async () => (await this.db.select().from(generations).where(eq(generations.id, id)).limit(1)).map(mapGeneration)[0] ?? null),
    listForProject: (projectId, limit) =>
      this.run(async () => (await this.db.select().from(generations).where(eq(generations.projectId, projectId)).orderBy(desc(generations.createdAt)).limit(limit)).map(mapGeneration)),
    setStatus: (id, status) =>
      this.run(async () => {
        const rows = await this.db.update(generations).set({ status }).where(eq(generations.id, id)).returning({ id: generations.id });
        if (rows.length === 0) throw new NotFoundError('Generation', id);
      }),
    complete: (id, completion: GenerationCompletion) =>
      this.run(async () => {
        const rows = await this.db
          .update(generations)
          .set({ status: completion.status, durationMs: completion.durationMs, nodeCount: completion.nodeCount, error: completion.error, completedAt: new Date() })
          .where(eq(generations.id, id))
          .returning({ id: generations.id });
        if (rows.length === 0) throw new NotFoundError('Generation', id);
      }),
    appendEvents: (id, events: GenerationEvent[]) =>
      this.run(async () => {
        if (events.length === 0) return;
        try {
          await this.db.insert(generationEvents).values(events.map((e) => ({ generationId: id, seq: e.seq, type: e.type, payload: e, at: new Date(e.at) })));
        } catch (error) {
          if (isUniqueViolation(error)) throw new ConflictError(`Duplicate event seq for generation ${id}.`);
          throw error;
        }
      }),
    eventsSince: (id, afterSeq) =>
      this.run(async () =>
        (await this.db.select({ payload: generationEvents.payload }).from(generationEvents).where(and(eq(generationEvents.generationId, id), gt(generationEvents.seq, afterSeq))).orderBy(asc(generationEvents.seq))).map((r) => r.payload),
      ),
  };

  readonly integrations: Repository['integrations'] = {
    catalog: () => this.run(async () => (await this.db.select().from(integrations).orderBy(asc(integrations.name))).map(mapIntegration)),
    findBySlug: (slug) => this.run(async () => (await this.db.select().from(integrations).where(eq(integrations.slug, slug)).limit(1)).map(mapIntegration)[0] ?? null),
    listForProject: (projectId) => this.run(async () => (await this.db.select().from(projectIntegrations).where(eq(projectIntegrations.projectId, projectId))).map(mapProjectIntegration)),
    attach: (projectId, slug) =>
      this.run(async () => {
        const [row] = await this.db
          .insert(projectIntegrations)
          .values({ id: randomUUID(), projectId, integrationSlug: slug })
          .onConflictDoNothing({ target: [projectIntegrations.projectId, projectIntegrations.integrationSlug] })
          .returning();
        if (row) return mapProjectIntegration(row);
        const [existing] = await this.db.select().from(projectIntegrations).where(and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.integrationSlug, slug))).limit(1);
        if (!existing) throw new NotFoundError('Integration', slug);
        return mapProjectIntegration(existing);
      }),
    setStatus: (id, status, config) =>
      this.run(async () => {
        const [row] = await this.db.update(projectIntegrations).set({ status, config }).where(eq(projectIntegrations.id, id)).returning();
        if (!row) throw new NotFoundError('ProjectIntegration', id);
        return mapProjectIntegration(row);
      }),
    detach: (id) =>
      this.run(async () => {
        const rows = await this.db.delete(projectIntegrations).where(eq(projectIntegrations.id, id)).returning({ id: projectIntegrations.id });
        if (rows.length === 0) throw new NotFoundError('ProjectIntegration', id);
      }),
  };

  readonly deployments: Repository['deployments'] = {
    create: (projectId, documentVersion, target) =>
      this.run(async () => {
        const [row] = await this.db.insert(deployments).values({ projectId, documentVersion, target }).returning();
        if (!row) throw new Error('insert returned no row');
        return mapDeployment(row);
      }),
    update: (id, patch) =>
      this.run(async () => {
        const [row] = await this.db.update(deployments).set(patch).where(eq(deployments.id, id)).returning();
        if (!row) throw new NotFoundError('Deployment', id);
        return mapDeployment(row);
      }),
    findById: (id) => this.run(async () => (await this.db.select().from(deployments).where(eq(deployments.id, id)).limit(1)).map(mapDeployment)[0] ?? null),
    listForProject: (projectId, limit) =>
      this.run(async () => (await this.db.select().from(deployments).where(eq(deployments.projectId, projectId)).orderBy(desc(deployments.createdAt)).limit(limit)).map(mapDeployment)),
  };
}
