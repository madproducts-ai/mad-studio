import { Component, signal, type EnvironmentProviders, type Provider } from '@angular/core';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import type { AuthState, ComponentPreset, Deployment, GenerationCreated, GenerationSummary, Integration, Project, ProjectDocument, ProjectIntegration } from '@mad/schema';
import type { Health } from '../core/api/api-client';
import { ApiClient, ApiUnreachableError } from '../core/api/api-client';

/**
 * Test wiring for studio components. The real store, auth service, theme and
 * toast services are used; only the network boundary is replaced, so the tests
 * exercise the same state machine the application runs.
 */

/** A call that fails the way an unreachable API does, typed so a test can override it with a real value. */
const rejecting = <T>() => vi.fn((...__args: never[]): Promise<T> => Promise.reject(new ApiUnreachableError(new Error('offline in tests'))));

/**
 * An ApiClient stand-in. Every call rejects as unreachable unless a test
 * overrides it, so nothing reaches the network by accident.
 */
export const fakeApiClient = (overrides: Record<string, unknown> = {}) => ({
  baseUrl: '',
  configured: false,
  reachable: signal<boolean | null>(false),
  sessionLost: signal(0),
  health: rejecting<Health>(),
  me: rejecting<AuthState>(),
  login: rejecting<AuthState>(),
  register: rejecting<AuthState>(),
  logout: vi.fn((): Promise<void> => Promise.resolve()),
  changePassword: rejecting<{ revokedSessions: number }>(),
  listProjects: rejecting<{ items: Project[]; nextCursor: string | null; total: number }>(),
  getProject: rejecting<Project>(),
  renameProject: rejecting<Project>(),
  getDocument: rejecting<ProjectDocument>(),
  documentHistory: vi.fn((): Promise<ProjectDocument[]> => Promise.resolve([])),
  saveDocument: rejecting<ProjectDocument>(),
  createGeneration: rejecting<GenerationCreated>(),
  getGeneration: rejecting<GenerationSummary>(),
  cancelGeneration: rejecting<GenerationSummary>(),
  streamUrl: vi.fn((id: string, after: number) => `/v1/generations/${id}/events?after=${after}`),
  listPresets: rejecting<{ categories: { id: string; label: string }[]; items: ComponentPreset[] }>(),
  integrationCatalog: vi.fn((): Promise<Integration[]> => Promise.resolve([])),
  listProjectIntegrations: vi.fn((): Promise<ProjectIntegration[]> => Promise.resolve([])),
  attachIntegration: rejecting<ProjectIntegration>(),
  setIntegrationStatus: rejecting<ProjectIntegration>(),
  createDeployment: rejecting<Deployment>(),
  getDeployment: rejecting<Deployment>(),
  listDeployments: vi.fn((): Promise<Deployment[]> => Promise.resolve([])),
  ...overrides,
});

export type FakeApiClient = ReturnType<typeof fakeApiClient>;

/** A route for every URL the store navigates to, so navigation resolves instead of rejecting. */
@Component({ selector: 'mad-test-blank', template: '' })
class BlankPage {}

export const studioProviders = (api: FakeApiClient): (Provider | EnvironmentProviders)[] => [provideRouter([{ path: '**', component: BlankPage }]), { provide: ApiClient, useValue: api }];

const iso = new Date('2026-01-01T00:00:00.000Z').toISOString();

export const aProject = (over: Partial<Project> = {}): Project => ({
  id: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  name: 'Ops Console',
  slug: 'ops-console',
  description: null,
  designSystem: 'tailwind',
  status: 'ready',
  lastPrompt: null,
  documentVersion: 2,
  createdAt: iso,
  updatedAt: iso,
  ...over,
});

export const aDeployment = (over: Partial<Deployment> = {}): Deployment => ({
  id: '33333333-3333-4333-8333-333333333333',
  projectId: '11111111-1111-4111-8111-111111111111',
  documentVersion: 2,
  target: 'preview',
  status: 'live',
  url: 'https://studio.madproducts.ai/apps/ops-console-111111/p/33333333/',
  createdAt: iso,
  updatedAt: iso,
  ...over,
});

export const aHealth = (over: Partial<Health> = {}): Health => ({
  status: 'ok',
  storage: 'postgres',
  storageReachable: true,
  uptimeMs: 1000,
  env: 'test',
  version: '0.2.0',
  planner: { mode: 'model', model: 'claude-opus-5' },
  deploy: { mode: 'fleet', publicBase: 'https://studio.madproducts.ai/apps' },
  ...over,
});

export const anAuthState = (over: Partial<AuthState> = {}): AuthState => ({
  user: { id: '44444444-4444-4444-8444-444444444444', email: 'ada@example.com', displayName: 'Ada Lovelace', avatarUrl: null, plan: 'pro', createdAt: iso, updatedAt: iso },
  workspace: { id: '22222222-2222-4222-8222-222222222222', ownerId: '44444444-4444-4444-8444-444444444444', name: 'Ada Workspace', slug: 'ada', createdAt: iso, updatedAt: iso },
  session: { id: '55555555-5555-4555-8555-555555555555', createdAt: iso, expiresAt: iso },
  ...over,
});
