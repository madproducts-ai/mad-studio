import type {
  Deployment,
  DesignSystem,
  GenerationEvent,
  GenerationStatus,
  GenerationSummary,
  Integration,
  MadDocument,
  Project,
  ProjectDocument,
  ProjectIntegration,
  User,
  Workspace,
} from '@mad/schema';

/**
 * The repository is the only boundary between domain services and storage.
 * Two implementations exist: PostgreSQL via Drizzle, and an in-memory mirror
 * with the same constraints (unique slugs, cascading deletes, version checks).
 * Services never know which one they are talking to.
 */

export interface NewProject {
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  designSystem: DesignSystem;
}

export interface NewGeneration {
  id: string;
  projectId: string;
  prompt: string;
  designSystem: DesignSystem;
  seed: number | null;
}

export interface GenerationCompletion {
  status: Extract<GenerationStatus, 'complete' | 'failed' | 'cancelled'>;
  durationMs: number | null;
  nodeCount: number | null;
  error: string | null;
}

export interface ListOptions {
  limit: number;
  cursor: string | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export interface Repository {
  readonly kind: 'postgres' | 'memory';
  ping(): Promise<boolean>;

  users: {
    findById(id: string): Promise<User | null>;
  };
  workspaces: {
    findById(id: string): Promise<Workspace | null>;
    findDefaultForUser(userId: string): Promise<Workspace | null>;
  };
  projects: {
    list(workspaceId: string, options: ListOptions): Promise<Page<Project>>;
    findById(id: string): Promise<Project | null>;
    create(input: NewProject): Promise<Project>;
    update(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'status' | 'lastPrompt' | 'designSystem'>>): Promise<Project>;
    delete(id: string): Promise<void>;
    slugExists(workspaceId: string, slug: string): Promise<boolean>;
  };
  documents: {
    latest(projectId: string): Promise<ProjectDocument | null>;
    get(projectId: string, version: number): Promise<ProjectDocument | null>;
    /**
     * Appends a new version. Fails with ConflictError when `expectedVersion`
     * does not match the project's current document version (optimistic lock).
     */
    append(projectId: string, expectedVersion: number, document: MadDocument, authoredBy: 'ai' | 'user', generationId: string | null): Promise<ProjectDocument>;
    history(projectId: string, limit: number): Promise<ProjectDocument[]>;
  };
  generations: {
    create(input: NewGeneration): Promise<GenerationSummary>;
    findById(id: string): Promise<GenerationSummary | null>;
    listForProject(projectId: string, limit: number): Promise<GenerationSummary[]>;
    setStatus(id: string, status: GenerationStatus): Promise<void>;
    complete(id: string, completion: GenerationCompletion): Promise<void>;
    appendEvents(id: string, events: GenerationEvent[]): Promise<void>;
    eventsSince(id: string, afterSeq: number): Promise<GenerationEvent[]>;
  };
  integrations: {
    catalog(): Promise<Integration[]>;
    findBySlug(slug: string): Promise<Integration | null>;
    listForProject(projectId: string): Promise<ProjectIntegration[]>;
    attach(projectId: string, slug: string): Promise<ProjectIntegration>;
    setStatus(id: string, status: ProjectIntegration['status'], config: Record<string, string>): Promise<ProjectIntegration>;
    detach(id: string): Promise<void>;
  };
  deployments: {
    create(projectId: string, documentVersion: number, target: Deployment['target']): Promise<Deployment>;
    update(id: string, patch: Partial<Pick<Deployment, 'status' | 'url'>>): Promise<Deployment>;
    findById(id: string): Promise<Deployment | null>;
    listForProject(projectId: string, limit: number): Promise<Deployment[]>;
  };
}

export const REPOSITORY = Symbol('REPOSITORY');
