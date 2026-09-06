import { relations, sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { MadDocument, GenerationEvent } from '@mad/schema';

/**
 * PostgreSQL schema for MAD Studio. Mirrors packages/schema/src/entities.ts.
 * Conventions: uuid primary keys, snake_case columns, timestamptz everywhere,
 * ON DELETE CASCADE from workspace → project → children, and a composite
 * primary key on (project_id, version) for the append-only document log.
 */

export const planEnum = pgEnum('plan', ['free', 'pro', 'team', 'enterprise']);
export const designSystemEnum = pgEnum('design_system', ['tailwind', 'material', 'wordpress']);
export const projectStatusEnum = pgEnum('project_status', ['draft', 'building', 'ready', 'deployed', 'archived']);
export const authoredByEnum = pgEnum('authored_by', ['ai', 'user']);
export const generationStatusEnum = pgEnum('generation_status', ['queued', 'planning', 'generating', 'wiring', 'complete', 'failed', 'cancelled']);
export const integrationStatusEnum = pgEnum('integration_status', ['pending', 'connected', 'error']);
export const deploymentTargetEnum = pgEnum('deployment_target', ['preview', 'production']);
export const deploymentStatusEnum = pgEnum('deployment_status', ['queued', 'building', 'live', 'failed', 'rolled-back']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    plan: planEnum('plan').notNull().default('free'),
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_key').on(sql`lower(${t.email})`)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('workspaces_slug_key').on(t.slug), index('workspaces_owner_idx').on(t.ownerId)],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    designSystem: designSystemEnum('design_system').notNull().default('tailwind'),
    status: projectStatusEnum('status').notNull().default('draft'),
    lastPrompt: text('last_prompt'),
    documentVersion: integer('document_version').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('projects_workspace_slug_key').on(t.workspaceId, t.slug),
    index('projects_workspace_updated_idx').on(t.workspaceId, t.updatedAt),
    index('projects_status_idx').on(t.status),
  ],
);

export const projectDocuments = pgTable(
  'project_documents',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    document: jsonb('document').$type<MadDocument>().notNull(),
    authoredBy: authoredByEnum('authored_by').notNull(),
    generationId: uuid('generation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.version] }), index('project_documents_generation_idx').on(t.generationId)],
);

export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    designSystem: designSystemEnum('design_system').notNull(),
    seed: integer('seed'),
    status: generationStatusEnum('status').notNull().default('queued'),
    durationMs: integer('duration_ms'),
    nodeCount: integer('node_count'),
    error: text('error'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generations_project_created_idx').on(t.projectId, t.createdAt), index('generations_status_idx').on(t.status)],
);

export const generationEvents = pgTable(
  'generation_events',
  {
    generationId: uuid('generation_id')
      .notNull()
      .references(() => generations.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<GenerationEvent>().notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.generationId, t.seq] })],
);

export const integrations = pgTable('integrations', {
  slug: text('slug').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  scopes: jsonb('scopes').$type<string[]>().notNull(),
  docsUrl: text('docs_url').notNull(),
  status: text('status').notNull().default('available'),
});

export const projectIntegrations = pgTable(
  'project_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    integrationSlug: text('integration_slug')
      .notNull()
      .references(() => integrations.slug, { onDelete: 'restrict' }),
    status: integrationStatusEnum('status').notNull().default('pending'),
    config: jsonb('config').$type<Record<string, string>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [uniqueIndex('project_integrations_project_slug_key').on(t.projectId, t.integrationSlug)],
);

export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    documentVersion: integer('document_version').notNull(),
    target: deploymentTargetEnum('target').notNull(),
    status: deploymentStatusEnum('status').notNull().default('queued'),
    url: text('url'),
    ...timestamps,
  },
  (t) => [index('deployments_project_created_idx').on(t.projectId, t.createdAt)],
);

export const usersRelations = relations(users, ({ many }) => ({ workspaces: many(workspaces) }));
export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner: one(users, { fields: [workspaces.ownerId], references: [users.id] }),
  projects: many(projects),
}));
export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  documents: many(projectDocuments),
  generations: many(generations),
  integrations: many(projectIntegrations),
  deployments: many(deployments),
}));
export const generationsRelations = relations(generations, ({ one, many }) => ({
  project: one(projects, { fields: [generations.projectId], references: [projects.id] }),
  events: many(generationEvents),
}));

export const schema = {
  users,
  workspaces,
  projects,
  projectDocuments,
  generations,
  generationEvents,
  integrations,
  projectIntegrations,
  deployments,
  usersRelations,
  workspacesRelations,
  projectsRelations,
  generationsRelations,
};

export const isDocumentRow = (row: unknown): row is { document: MadDocument } => typeof row === 'object' && row !== null && 'document' in row;
export const booleanColumn = boolean;
