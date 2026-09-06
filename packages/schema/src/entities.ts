import { z } from 'zod';
import { MadDocumentSchema, DesignSystemSchema } from './document';

/**
 * Entity contracts mirror the PostgreSQL schema in apps/api/src/db/schema.ts
 * one-to-one. Anything the API returns is validated against these before it
 * leaves the process, and the web app validates again on the way in.
 */

const timestamps = {
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
};

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().min(1).max(80),
  avatarUrl: z.string().url().nullable(),
  plan: z.enum(['free', 'pro', 'team', 'enterprise']),
  ...timestamps,
});
export type User = z.infer<typeof UserSchema>;

export const WorkspaceSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9-]{2,48}$/),
  ...timestamps,
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

export const ProjectStatusSchema = z.enum(['draft', 'building', 'ready', 'deployed', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9-]{2,64}$/),
  description: z.string().max(400).nullable(),
  designSystem: DesignSystemSchema,
  status: ProjectStatusSchema,
  lastPrompt: z.string().max(2000).nullable(),
  documentVersion: z.number().int().nonnegative(),
  ...timestamps,
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectDocumentSchema = z.object({
  projectId: z.string().uuid(),
  version: z.number().int().nonnegative(),
  document: MadDocumentSchema,
  authoredBy: z.enum(['ai', 'user']),
  generationId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;

export const IntegrationCategorySchema = z.enum(['payments', 'crm', 'auth', 'database', 'messaging', 'analytics', 'storage', 'email']);
export type IntegrationCategory = z.infer<typeof IntegrationCategorySchema>;

export const IntegrationSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(1).max(60),
  category: IntegrationCategorySchema,
  description: z.string().max(240),
  scopes: z.array(z.string()),
  docsUrl: z.string().url(),
  status: z.enum(['available', 'beta', 'coming-soon']),
});
export type Integration = z.infer<typeof IntegrationSchema>;

export const ProjectIntegrationSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  integrationSlug: z.string(),
  status: z.enum(['pending', 'connected', 'error']),
  config: z.record(z.string(), z.string()),
  ...timestamps,
});
export type ProjectIntegration = z.infer<typeof ProjectIntegrationSchema>;

export const DeploymentSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  documentVersion: z.number().int().nonnegative(),
  target: z.enum(['preview', 'production']),
  status: z.enum(['queued', 'building', 'live', 'failed', 'rolled-back']),
  url: z.string().url().nullable(),
  ...timestamps,
});
export type Deployment = z.infer<typeof DeploymentSchema>;

export const ComponentPresetSchema = z.object({
  id: z.string().regex(/^p_[a-z0-9-]{2,48}$/),
  designSystem: DesignSystemSchema,
  category: z.enum(['layout', 'navigation', 'data', 'forms', 'commerce', 'communication', 'marketing']),
  name: z.string().min(1).max(60),
  description: z.string().max(160),
  keywords: z.array(z.string()),
  node: MadDocumentSchema.shape.root,
});
export type ComponentPreset = z.infer<typeof ComponentPresetSchema>;

/* DTOs */

export const CreateProjectRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(400).optional(),
    designSystem: DesignSystemSchema.default('tailwind'),
  })
  .strict();
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const SaveDocumentRequestSchema = z
  .object({
    baseVersion: z.number().int().nonnegative(),
    document: MadDocumentSchema,
  })
  .strict();
export type SaveDocumentRequest = z.infer<typeof SaveDocumentRequestSchema>;

export const ApiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const PaginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  });
