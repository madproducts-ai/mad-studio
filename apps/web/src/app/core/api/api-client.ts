import { Injectable, signal } from '@angular/core';
import { z, type ZodType } from 'zod';
import {
  ApiErrorSchema,
  ComponentPresetSchema,
  DeploymentSchema,
  GenerationCreatedSchema,
  GenerationSummarySchema,
  IntegrationSchema,
  PaginatedSchema,
  ProjectDocumentSchema,
  ProjectIntegrationSchema,
  ProjectSchema,
  type ApiError,
  type ComponentPreset,
  type CreateGenerationRequest,
  type Deployment,
  type DesignSystem,
  type GenerationCreated,
  type GenerationSummary,
  type Integration,
  type Project,
  type ProjectDocument,
  type ProjectIntegration,
  type SaveDocumentRequest,
} from '@mad/schema';
import { environment } from '../../../environments/environment';

export class ApiRequestError extends Error {
  constructor(
    public readonly error: ApiError,
    public readonly status: number,
  ) {
    super(error.message);
    this.name = 'ApiRequestError';
  }
  get code(): string {
    return this.error.code;
  }
}

export class ApiUnreachableError extends Error {
  constructor(cause: unknown) {
    super('The MAD Studio API is unreachable.');
    this.name = 'ApiUnreachableError';
    this.cause = cause;
  }
}

const HealthSchema = z.object({ status: z.enum(['ok', 'degraded']), storage: z.string(), storageReachable: z.boolean(), uptimeMs: z.number(), env: z.string(), version: z.string() });
export type Health = z.infer<typeof HealthSchema>;

const PresetsResponseSchema = z.object({ categories: z.array(z.object({ id: z.string(), label: z.string() })), items: z.array(ComponentPresetSchema) });

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Retries apply to idempotent reads and to network-level failures only. */
  retries?: number;
  timeoutMs?: number;
}

/**
 * Typed fetch wrapper. Every response is validated against the shared Zod
 * contract before it reaches a signal, network failures back off with jitter,
 * and structured API errors surface as `ApiRequestError` with a stable code.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  readonly baseUrl = environment.apiUrl.replace(/\/$/, '');
  /** False on static hosts (GitHub Pages) where no API URL is configured; the studio then runs in browser mode. */
  readonly configured = this.baseUrl.length > 0;
  /** Last observed reachability; the studio uses it to decide on offline mode. */
  readonly reachable = signal<boolean | null>(this.configured ? null : false);

  async health(signal?: AbortSignal): Promise<Health> {
    return this.request('/health', HealthSchema, { retries: 1, timeoutMs: 3500, ...(signal ? { signal } : {}) });
  }

  listProjects(limit = 24): Promise<{ items: Project[]; nextCursor: string | null; total: number }> {
    return this.request(`/projects?limit=${limit}`, PaginatedSchema(ProjectSchema));
  }

  getProject(id: string): Promise<Project> {
    return this.request(`/projects/${id}`, ProjectSchema);
  }

  renameProject(id: string, name: string, description: string | null): Promise<Project> {
    return this.request(`/projects/${id}`, ProjectSchema, { method: 'PATCH', body: { name, description } });
  }

  getDocument(projectId: string): Promise<ProjectDocument> {
    return this.request(`/projects/${projectId}/document`, ProjectDocumentSchema);
  }

  saveDocument(projectId: string, body: SaveDocumentRequest): Promise<ProjectDocument> {
    return this.request(`/projects/${projectId}/document`, ProjectDocumentSchema, { method: 'PUT', body, retries: 0 });
  }

  createGeneration(body: CreateGenerationRequest): Promise<GenerationCreated> {
    return this.request('/generations', GenerationCreatedSchema, { method: 'POST', body, retries: 0 });
  }

  getGeneration(id: string): Promise<GenerationSummary> {
    return this.request(`/generations/${id}`, GenerationSummarySchema);
  }

  cancelGeneration(id: string): Promise<GenerationSummary> {
    return this.request(`/generations/${id}/cancel`, GenerationSummarySchema, { method: 'POST', retries: 0 });
  }

  listPresets(designSystem: DesignSystem, q?: string): Promise<{ categories: { id: string; label: string }[]; items: ComponentPreset[] }> {
    const query = new URLSearchParams({ designSystem });
    if (q) query.set('q', q);
    return this.request(`/presets?${query.toString()}`, PresetsResponseSchema);
  }

  integrationCatalog(): Promise<Integration[]> {
    return this.request('/integrations', z.array(IntegrationSchema));
  }

  listProjectIntegrations(projectId: string): Promise<ProjectIntegration[]> {
    return this.request(`/projects/${projectId}/integrations`, z.array(ProjectIntegrationSchema));
  }

  attachIntegration(projectId: string, slug: string): Promise<ProjectIntegration> {
    return this.request(`/projects/${projectId}/integrations`, ProjectIntegrationSchema, { method: 'POST', body: { slug }, retries: 0 });
  }

  setIntegrationStatus(projectId: string, integrationId: string, status: ProjectIntegration['status'], config: Record<string, string>): Promise<ProjectIntegration> {
    return this.request(`/projects/${projectId}/integrations/${integrationId}`, ProjectIntegrationSchema, { method: 'PATCH', body: { status, config }, retries: 0 });
  }

  createDeployment(projectId: string, target: Deployment['target']): Promise<Deployment> {
    return this.request(`/projects/${projectId}/deployments`, DeploymentSchema, { method: 'POST', body: { target }, retries: 0 });
  }

  getDeployment(projectId: string, id: string): Promise<Deployment> {
    return this.request(`/projects/${projectId}/deployments/${id}`, DeploymentSchema);
  }

  listDeployments(projectId: string, limit = 10): Promise<Deployment[]> {
    return this.request(`/projects/${projectId}/deployments?limit=${limit}`, z.array(DeploymentSchema));
  }

  streamUrl(generationId: string, after: number): string {
    return `${this.baseUrl}/generations/${generationId}/events?after=${after}`;
  }

  private async request<T>(path: string, schema: ZodType<T>, options: RequestOptions = {}): Promise<T> {
    if (!this.configured) {
      // No network round-trip, no timeout: callers fall back to browser mode immediately.
      throw new ApiUnreachableError(new Error('No API URL is configured for this build.'));
    }
    const method = options.method ?? 'GET';
    const retries = options.retries ?? (method === 'GET' ? 2 : 0);
    const timeoutMs = options.timeoutMs ?? 12000;
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= retries) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
      const onOuterAbort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', onOuterAbort, { once: true });
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: { accept: 'application/json', ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}) },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        this.reachable.set(true);
        if (res.status === 204) return schema.parse(undefined);
        const text = await res.text();
        const json: unknown = text.length ? JSON.parse(text) : null;
        if (!res.ok) {
          const parsed = ApiErrorSchema.safeParse(json);
          const error: ApiError = parsed.success
            ? parsed.data
            : { statusCode: res.status, code: 'http_error', message: res.statusText || `Request failed with ${res.status}`, requestId: res.headers.get('x-request-id') ?? 'n/a' };
          throw new ApiRequestError(error, res.status);
        }
        const result = schema.safeParse(json);
        if (!result.success) {
          throw new ApiRequestError(
            { statusCode: res.status, code: 'contract_mismatch', message: 'The API response did not match the expected contract.', details: result.error.issues, requestId: res.headers.get('x-request-id') ?? 'n/a' },
            res.status,
          );
        }
        return result.data;
      } catch (error) {
        lastError = error;
        if (error instanceof ApiRequestError) {
          // 5xx on an idempotent request is worth one more try; everything else is final.
          if (!(error.status >= 500 && method === 'GET' && attempt < retries)) throw error;
        } else if (options.signal?.aborted) {
          throw error;
        } else {
          this.reachable.set(false);
          if (attempt >= retries) throw new ApiUnreachableError(error);
        }
        const cap = Math.min(2500, 200 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, Math.random() * cap));
        attempt += 1;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onOuterAbort);
      }
    }
    throw lastError instanceof Error ? lastError : new ApiUnreachableError(lastError);
  }
}
