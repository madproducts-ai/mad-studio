import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type {
  ComponentPreset,
  Deployment,
  DesignSystem,
  Device,
  GenerationEvent,
  GenerationStatus,
  Integration,
  MadDocument,
  MadNode,
  NodeId,
  PlanStep,
  Project,
  ProjectDocument,
} from '@mad/schema';
import { MadDocumentSchema, cloneWithFreshIds, countNodes, createIdFactory, findNode, findParent, insertNode, moveNode, patchNode, pathTo, removeNode, type NodePatch } from '@mad/schema';
import { INTEGRATION_RULES, PRESETS, nav, page, sidebar, stack, type BuildContext } from '@mad/planner';
import { ApiClient, ApiRequestError, ApiUnreachableError, type Health } from '../../core/api/api-client';
import { AuthService } from '../../core/auth/auth.service';
import { GenerationStream } from '../../core/api/generation-stream';
import { OfflineRunner } from '../../core/api/offline-runner';
import { RenderContext } from '../../core/render/render-context';
import { ToastService } from '../../core/ui/toast.service';

export type LeftPanel = 'components' | 'layers' | 'integrations' | 'schema' | 'history';
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';
export type ConnectionMode = 'unknown' | 'api' | 'offline';
export type StudioGenStatus = 'idle' | 'connecting' | GenerationStatus;

export interface LogEntry {
  id: number;
  at: string;
  level: 'info' | 'warn' | 'error' | 'event';
  message: string;
}

export interface SchemaTable {
  table: string;
  columns: string[];
}

export interface WiredIntegration {
  slug: string;
  label: string;
  scopes: string[];
  status: 'pending' | 'connected' | 'error';
}

const LOCAL_PREFIX = 'mad:project:';
const HISTORY_LIMIT = 120;

interface LocalProject {
  id: string;
  name: string;
  prompt: string;
  document: MadDocument;
  tables: SchemaTable[];
  integrations: WiredIntegration[];
  updatedAt: string;
}

/**
 * The studio's single source of truth. Signals for state, pure tree functions
 * for mutation, one `commit()` that owns history + dirty tracking + autosave.
 * Generation events from the API stream and the offline runner are applied
 * through the same reducer, so the two modes cannot drift.
 */
@Injectable()
export class StudioStore {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly render = inject(RenderContext);
  private readonly destroyRef = inject(DestroyRef);

  // ---------- document ----------
  readonly document = signal<MadDocument | null>(null);
  readonly root = computed(() => this.document()?.root ?? null);
  readonly nodeCount = computed(() => (this.root() ? countNodes(this.root() as MadNode) : 0));
  readonly designSystem = computed<DesignSystem>(() => this.document()?.designSystem ?? this.pendingDesignSystem());
  readonly pendingDesignSystem = signal<DesignSystem>('tailwind');
  readonly previewTheme = signal<'dark' | 'light'>('dark');

  // ---------- selection ----------
  readonly selectedId = signal<NodeId | null>(null);
  readonly selectedNode = computed(() => {
    const root = this.root();
    const id = this.selectedId();
    return root && id ? findNode(root, id) : null;
  });
  readonly selectedPath = computed(() => {
    const root = this.root();
    const id = this.selectedId();
    return root && id ? pathTo(root, id) : [];
  });
  readonly selectedParent = computed(() => {
    const root = this.root();
    const id = this.selectedId();
    return root && id ? findParent(root, id) : null;
  });

  // ---------- view ----------
  readonly device = signal<Device>('desktop');
  readonly zoom = signal<number | 'fit'>('fit');
  /** The palette opens by default only where it fits beside the canvas. */
  readonly leftPanel = signal<LeftPanel | null>(typeof window === 'undefined' || window.innerWidth >= 1024 ? 'components' : null);
  readonly inspectorOpen = signal(true);
  readonly consoleOpen = signal(false);

  // ---------- history ----------
  private readonly past = signal<MadNode[]>([]);
  private readonly future = signal<MadNode[]>([]);
  readonly canUndo = computed(() => this.past().length > 0);
  readonly canRedo = computed(() => this.future().length > 0);
  private coalesceKey: string | null = null;
  private coalesceUntil = 0;

  // ---------- project & persistence ----------
  readonly project = signal<Project | null>(null);
  readonly projectId = signal<string | null>(null);
  readonly projectName = signal('Untitled');
  readonly documentVersion = signal(0);
  readonly saveState = signal<SaveState>('idle');
  readonly lastSavedAt = signal<string | null>(null);
  readonly mode = signal<ConnectionMode>('unknown');
  /** Last health report from the API: which planner answers prompts and where deploys land. */
  readonly health = signal<Health | null>(null);
  /** Sign-in state, mirrored from the auth service for templates. */
  readonly signedIn = computed(() => this.auth.status() === 'authenticated');
  readonly account = computed(() => this.auth.user());
  /** False on static deployments: the badge reads "Browser mode" instead of "Offline". */
  readonly apiConfigured = this.api.configured;
  readonly isLocal = computed(() => (this.projectId() ?? '').startsWith('local-'));
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveInFlight: Promise<void> | null = null;

  // ---------- generation ----------
  readonly genStatus = signal<StudioGenStatus>('idle');
  readonly generating = computed(() => ['connecting', 'queued', 'planning', 'generating', 'wiring'].includes(this.genStatus()));
  readonly steps = signal<PlanStep[]>([]);
  readonly logs = signal<LogEntry[]>([]);
  readonly tables = signal<SchemaTable[]>([]);
  readonly integrations = signal<WiredIntegration[]>([]);
  readonly catalog = signal<Integration[]>([]);
  readonly prompt = signal('');
  readonly lastPrompt = signal<string | null>(null);
  readonly generationId = signal<string | null>(null);
  readonly startedAt = signal<number | null>(null);
  readonly finishedAt = signal<number | null>(null);
  readonly now = signal(Date.now());
  readonly elapsedMs = computed(() => {
    const s = this.startedAt();
    if (s === null) return 0;
    return Math.max(0, (this.finishedAt() ?? this.now()) - s);
  });
  readonly tokens = signal<{ input: number; output: number } | null>(null);
  readonly statusMessage = signal('');
  /** True between submitting a prompt and the build actually starting (connectivity probe, sign-in). */
  readonly preparing = signal(false);
  readonly reconnecting = signal(false);
  private stream: GenerationStream | null = null;
  private offline: OfflineRunner | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private logSeq = 0;

  // ---------- deployments ----------
  readonly deployments = signal<Deployment[]>([]);
  readonly deploying = signal(false);

  // ---------- presets ----------
  readonly presets = computed<ComponentPreset[]>(() => PRESETS.filter((p) => p.designSystem === this.designSystem()));

  constructor() {
    this.render.interactive.set(true);
    this.render.onSelect = (id) => this.select(id);
    this.render.onDrop = (parentId, index, payload) => {
      if (payload.kind === 'preset') this.insertPreset(parentId, index, payload.id);
      else this.moveNodeTo(payload.id, parentId, index);
    };
    this.destroyRef.onDestroy(() => {
      this.stream?.close();
      this.offline?.cancel();
      if (this.ticker) clearInterval(this.ticker);
      if (this.saveTimer) clearTimeout(this.saveTimer);
    });
    void this.probe();
  }

  // =====================================================================
  // Connectivity
  // =====================================================================

  private probePromise: Promise<ConnectionMode> | null = null;
  private probedAt = 0;

  async probe(force = false): Promise<ConnectionMode> {
    if (!force && this.probePromise) return this.probePromise;
    if (!force && Date.now() - this.probedAt < 20000 && this.mode() !== 'unknown') return this.mode();
    this.probePromise = (async () => {
      try {
        const health = await this.api.health();
        const first = this.health() === null;
        this.health.set(health);
        this.mode.set('api');
        await this.auth.refresh();
        if (first && health.planner) {
          const planner = health.planner.mode === 'model' ? `${health.planner.model} with deterministic fallback` : 'deterministic';
          const deploys = health.deploy?.mode === 'fleet' ? health.deploy.publicBase : 'local preview';
          this.log('info', `Connected to the API. Planner: ${planner}. Deploys: ${deploys}.`);
        }
        if (this.catalog().length === 0) {
          this.api.integrationCatalog().then((c) => this.catalog.set(c)).catch(() => undefined);
        }
      } catch {
        this.mode.set('offline');
      } finally {
        this.probedAt = Date.now();
        this.probePromise = null;
      }
      return this.mode();
    })();
    return this.probePromise;
  }

  // =====================================================================
  // Loading
  // =====================================================================

  async loadProject(id: string): Promise<void> {
    this.resetDocumentState();
    this.projectId.set(id);
    if (id.startsWith('local-')) {
      const local = this.readLocal(id);
      if (!local) {
        this.toast.error('Project not found', 'This local project no longer exists in this browser.');
        await this.router.navigate(['/studio'], { replaceUrl: true });
        return;
      }
      this.mode.set(this.mode() === 'unknown' ? 'offline' : this.mode());
      this.projectName.set(local.name);
      this.lastPrompt.set(local.prompt);
      this.document.set(local.document);
      this.tables.set(local.tables);
      this.integrations.set(local.integrations);
      this.saveState.set('saved');
      this.lastSavedAt.set(local.updatedAt);
      this.log('info', `Opened local project "${local.name}".`);
      return;
    }
    try {
      if ((await this.probe()) === 'api' && !(await this.auth.requireSession())) {
        this.toast.info('Sign in to open cloud projects', 'Your local projects are still available from the History panel.');
        await this.router.navigate(['/studio'], { replaceUrl: true });
        return;
      }
      const [project, doc] = await Promise.all([this.api.getProject(id), this.api.getDocument(id).catch((e) => (e instanceof ApiRequestError && e.code === 'invalid_state' ? null : Promise.reject(e)))]);
      this.mode.set('api');
      this.project.set(project);
      this.projectName.set(project.name);
      this.lastPrompt.set(project.lastPrompt);
      this.documentVersion.set(project.documentVersion);
      if (doc) {
        this.applyDocument(doc);
        this.deriveSidePanelsFromDocument(doc.document);
      }
      this.saveState.set('saved');
      this.lastSavedAt.set(project.updatedAt);
      this.api.listDeployments(id).then((d) => this.deployments.set(d)).catch(() => undefined);
      this.api.listProjectIntegrations(id).then((list) => {
        if (list.length === 0) return;
        this.integrations.update((current) => {
          const next = [...current];
          for (const pi of list) {
            const idx = next.findIndex((x) => x.slug === pi.integrationSlug);
            const rule = INTEGRATION_RULES.find((r) => r.slug === pi.integrationSlug);
            const entry: WiredIntegration = { slug: pi.integrationSlug, label: rule?.label ?? pi.integrationSlug, scopes: [...(rule?.scopes ?? [])], status: pi.status };
            if (idx >= 0) next[idx] = entry;
            else next.push(entry);
          }
          return next;
        });
      }).catch(() => undefined);
      this.log('info', `Opened "${project.name}" (v${project.documentVersion}).`);
    } catch (error) {
      if (error instanceof ApiUnreachableError) {
        this.mode.set('offline');
        this.toast.error('API unreachable', 'Could not load the project. Start the API or open a local project.', { label: 'Retry', run: () => void this.loadProject(id) });
      } else if (error instanceof ApiRequestError && error.status === 404) {
        this.toast.error('Project not found', 'It may have been deleted, or it belongs to another account.');
        await this.router.navigate(['/studio'], { replaceUrl: true });
      } else if (error instanceof ApiRequestError && error.status === 401) {
        this.toast.error('Signed out', 'Sign in again to open this project.', { label: 'Sign in', run: () => void this.auth.requireSession().then((ok) => { if (ok) void this.loadProject(id); }) });
      } else {
        this.toast.error('Could not load project', error instanceof Error ? error.message : String(error));
      }
    }
  }

  private applyDocument(doc: ProjectDocument): void {
    this.document.set(doc.document);
    this.documentVersion.set(doc.version);
  }

  private deriveSidePanelsFromDocument(doc: MadDocument): void {
    if (this.tables().length === 0 && doc.tables.length) this.tables.set(doc.tables.map((t) => ({ table: t.table, columns: [...t.columns] })));
    if (this.integrations().length === 0) {
      this.integrations.set(
        doc.integrations.map((slug) => {
          const rule = INTEGRATION_RULES.find((r) => r.slug === slug);
          return { slug, label: rule?.label ?? slug, scopes: [...(rule?.scopes ?? [])], status: 'pending' as const };
        }),
      );
    }
  }

  private resetDocumentState(): void {
    this.stream?.close();
    this.offline?.cancel();
    this.stream = null;
    this.offline = null;
    this.document.set(null);
    this.selectedId.set(null);
    this.render.selectedId.set(null);
    this.past.set([]);
    this.future.set([]);
    this.project.set(null);
    this.projectId.set(null);
    this.documentVersion.set(0);
    this.saveState.set('idle');
    this.steps.set([]);
    this.tables.set([]);
    this.integrations.set([]);
    this.deployments.set([]);
    this.tokens.set(null);
    this.genStatus.set('idle');
    this.startedAt.set(null);
    this.finishedAt.set(null);
    this.statusMessage.set('');
  }

  // =====================================================================
  // Generation
  // =====================================================================

  async generate(prompt: string, options: { designSystem?: DesignSystem; intoCurrentProject?: boolean } = {}): Promise<void> {
    const text = prompt.trim();
    if (text.length < 4 || this.generating() || this.preparing()) return;
    const designSystem = options.designSystem ?? this.designSystem();
    const keepProject = options.intoCurrentProject === true && this.projectId() !== null && !this.isLocal();
    const currentProjectId = this.projectId();

    // Settle connectivity and the session first. Asking for a password is not
    // building: entering the build state here would show a running timer and a
    // Stop button for work that has not started, and would leave the canvas
    // blank behind the sign-in sheet.
    this.preparing.set(true);
    let useApi: boolean;
    try {
      const mode = await this.probe(true);
      useApi = mode === 'api';
      if (useApi && !this.signedIn()) {
        useApi = await this.auth.requireSession();
      }
    } finally {
      this.preparing.set(false);
    }

    this.resetDocumentState();
    if (keepProject && currentProjectId) this.projectId.set(currentProjectId);
    this.pendingDesignSystem.set(designSystem);
    this.lastPrompt.set(text);
    this.prompt.set('');
    this.genStatus.set('connecting');
    this.statusMessage.set('Connecting');
    this.startTicker();
    this.log('info', `Prompt: "${text}"`);
    if (!useApi && this.signedIn() === false && this.apiConfigured) this.log('info', 'Continuing without an account: this build runs in your browser and saves locally.');
    if (useApi) {
      try {
        const created = await this.api.createGeneration({ prompt: text, designSystem, ...(keepProject && currentProjectId ? { projectId: currentProjectId } : {}) });
        this.generationId.set(created.id);
        this.projectId.set(created.projectId);
        this.genStatus.set('queued');
        this.stream?.close();
        this.stream = new GenerationStream(
          (after) => this.api.streamUrl(created.id, after),
          {
            onEvent: (e) => this.applyEvent(e),
            onOpen: () => this.reconnecting.set(false),
            onReconnect: (attempt) => {
              this.reconnecting.set(true);
              this.log('warn', `Stream interrupted, reconnecting (attempt ${attempt})…`);
            },
            onError: (err) => {
              this.log('error', err.message);
              this.finish('failed');
              this.toast.error('Generation stream failed', err.message, { label: 'Retry', run: () => void this.generate(text, { designSystem }) });
            },
            onComplete: () => {
              this.stream = null;
              void this.afterApiGeneration(created.projectId);
            },
          },
        );
        this.stream.open();
        return;
      } catch (error) {
        if (!(error instanceof ApiUnreachableError)) {
          const message = error instanceof Error ? error.message : String(error);
          this.log('error', message);
          this.finish('failed');
          this.toast.error('Could not start generation', message);
          return;
        }
        this.mode.set('offline');
      }
    }

    // Offline: run the planner locally, persist to this browser.
    const localId = keepProject && currentProjectId?.startsWith('local-') ? currentProjectId : `local-${Date.now().toString(36)}`;
    this.projectId.set(localId);
    if (this.mode() !== 'api') this.log(this.apiConfigured ? 'warn' : 'info', `${this.apiConfigured ? 'API unreachable.' : 'No API configured for this build.'} Running the planner in your browser; this project is saved locally.`);
    this.genStatus.set('queued');
    this.offline = new OfflineRunner(
      text,
      { designSystem },
      (e) => this.applyEvent(e),
      () => {
        this.offline = null;
        this.finalizeLocal(localId, text);
      },
    );
    this.offline.start();
    void this.router.navigate(['/studio', localId], { replaceUrl: true, queryParams: {} });
  }

  async cancelGeneration(): Promise<void> {
    if (!this.generating()) return;
    if (this.offline) {
      this.offline.cancel();
      return;
    }
    const id = this.generationId();
    if (id && this.mode() === 'api') {
      try {
        await this.api.cancelGeneration(id);
      } catch (error) {
        this.log('warn', `Cancel request failed: ${error instanceof Error ? error.message : String(error)}`);
        this.stream?.close();
        this.finish('cancelled');
      }
    }
  }

  private async afterApiGeneration(projectId: string): Promise<void> {
    const status = this.genStatus();
    if (status !== 'complete') return;
    try {
      const [project, doc] = await Promise.all([this.api.getProject(projectId), this.api.getDocument(projectId)]);
      this.project.set(project);
      this.projectName.set(project.name);
      this.documentVersion.set(doc.version);
      // The streamed tree and the persisted tree are identical by construction; adopt the persisted copy so versions line up.
      this.document.set({ ...doc.document, tables: doc.document.tables.length ? doc.document.tables : this.tables() });
      this.past.set([]);
      this.future.set([]);
      this.saveState.set('saved');
      this.lastSavedAt.set(doc.createdAt);
      await this.router.navigate(['/studio', projectId], { replaceUrl: true, queryParams: {} });
      this.toast.success(`${project.name} is ready`, `${this.nodeCount()} components in ${(this.elapsedMs() / 1000).toFixed(1)}s. Click any element to edit it.`);
    } catch (error) {
      this.log('error', `Generated, but could not load the saved document: ${error instanceof Error ? error.message : String(error)}`);
      this.saveState.set('dirty');
    }
  }

  private finalizeLocal(localId: string, prompt: string): void {
    if (this.genStatus() !== 'complete') return;
    const doc = this.document();
    if (!doc) return;
    const name = doc.root.name;
    this.projectName.set(name);
    this.past.set([]);
    this.future.set([]);
    this.writeLocal(localId, prompt);
    this.toast.success(`${name} is ready (offline)`, `${this.nodeCount()} components in ${(this.elapsedMs() / 1000).toFixed(1)}s. Saved in this browser.`);
  }

  private applyEvent(e: GenerationEvent): void {
    switch (e.type) {
      case 'status':
        this.genStatus.set(e.status);
        this.statusMessage.set(e.message);
        if (e.status === 'planning' && this.startedAt() === null) this.startedAt.set(Date.now());
        if (e.status === 'complete' || e.status === 'failed' || e.status === 'cancelled') this.finish(e.status);
        this.log('event', e.message);
        break;
      case 'plan':
        this.steps.set(e.steps);
        break;
      case 'step':
        this.steps.update((list) => list.map((s) => (s.id === e.stepId ? { ...s, status: e.status } : s)));
        if (e.status === 'active') {
          const step = this.steps().find((s) => s.id === e.stepId);
          if (step) this.log('event', step.label);
        }
        break;
      case 'node.add': {
        const current = this.document();
        const root = current?.root ?? null;
        const nextRoot = root === null || e.parentId === null ? e.node : insertNode(root, e.parentId, e.index, e.node);
        this.document.set({
          version: 1,
          designSystem: current?.designSystem ?? this.pendingDesignSystem(),
          theme: current?.theme ?? 'dark',
          root: nextRoot,
          integrations: current?.integrations ?? [],
          tables: current?.tables ?? [],
          updatedAt: new Date().toISOString(),
        });
        this.render.markEntering([e.node.id]);
        break;
      }
      case 'node.patch': {
        const current = this.document();
        if (current) this.document.set({ ...current, root: patchNode(current.root, e.nodeId, { ...(e.props ? { props: e.props } : {}), ...(e.style ? { style: e.style } : {}), ...(e.name ? { name: e.name } : {}) }) });
        break;
      }
      case 'node.remove': {
        const current = this.document();
        if (current) this.document.set({ ...current, root: removeNode(current.root, e.nodeId) });
        break;
      }
      case 'schema.table':
        this.tables.update((t) => (t.some((x) => x.table === e.table) ? t : [...t, { table: e.table, columns: e.columns }]));
        this.document.update((d) => (d && !d.tables.some((x) => x.table === e.table) ? { ...d, tables: [...d.tables, { table: e.table, columns: [...e.columns] }] } : d));
        this.log('event', `table ${e.table} (${e.columns.length} columns)`);
        break;
      case 'integration.add':
        this.integrations.update((list) => (list.some((i) => i.slug === e.slug) ? list : [...list, { slug: e.slug, label: e.label, scopes: e.scopes, status: 'pending' }]));
        this.document.update((d) => (d && !d.integrations.includes(e.slug) ? { ...d, integrations: [...d.integrations, e.slug] } : d));
        this.log('event', `integration ${e.label}`);
        break;
      case 'log':
        this.log(e.level, e.message);
        break;
      case 'tokens':
        this.tokens.set({ input: e.input, output: e.output });
        break;
      case 'done':
        this.log('info', `Done: ${e.nodeCount} nodes in ${(e.durationMs / 1000).toFixed(1)}s.`);
        break;
      case 'error':
        this.log('error', e.message);
        this.finish('failed');
        this.toast.error('Generation failed', e.message);
        break;
      default:
        break;
    }
  }

  private finish(status: GenerationStatus): void {
    this.genStatus.set(status);
    this.finishedAt.set(Date.now());
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.reconnecting.set(false);
    if (status !== 'complete') {
      this.steps.update((list) => list.map((s) => (s.status === 'active' ? { ...s, status: 'skipped' } : s)));
    }
  }

  private startTicker(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.now.set(Date.now());
    this.ticker = setInterval(() => this.now.set(Date.now()), 100);
  }

  log(level: LogEntry['level'], message: string): void {
    this.logSeq += 1;
    this.logs.update((list) => [...list.slice(-399), { id: this.logSeq, at: new Date().toISOString(), level, message }]);
  }

  clearLogs(): void {
    this.logs.set([]);
  }

  // =====================================================================
  // Blank canvas
  // =====================================================================

  startBlank(designSystem: DesignSystem = this.designSystem()): void {
    this.resetDocumentState();
    const ctx: BuildContext = { nextId: createIdFactory(), designSystem, random: Math.random };
    const root = page(ctx, 'Untitled', 'app-shell', [
      nav(ctx, 'Untitled', ['Overview', 'Docs'], 'Invite team'),
      sidebar(ctx, ['Overview', 'Settings'], 0),
      stack(ctx, 'Main content', [], { gap: 24, padding: { top: 28, right: 32, bottom: 40, left: 32 } }),
    ]);
    const localId = `local-${Date.now().toString(36)}`;
    this.projectId.set(localId);
    this.projectName.set('Untitled');
    this.document.set({ version: 1, designSystem, theme: 'dark', root, integrations: [], tables: [], updatedAt: new Date().toISOString() });
    this.genStatus.set('idle');
    this.writeLocal(localId, '');
    this.log('info', 'Started a blank canvas.');
    void this.router.navigate(['/studio', localId], { replaceUrl: true, queryParams: {} });
  }

  // =====================================================================
  // Selection & navigation
  // =====================================================================

  select(id: NodeId | null): void {
    this.selectedId.set(id);
    this.render.selectedId.set(id);
    if (id && !this.inspectorOpen()) this.inspectorOpen.set(true);
  }

  selectParent(): void {
    const parent = this.selectedParent();
    if (parent) this.select(parent.id);
  }
  selectFirstChild(): void {
    const node = this.selectedNode();
    const first = node?.children[0];
    if (first) this.select(first.id);
  }
  selectSibling(delta: 1 | -1): void {
    const parent = this.selectedParent();
    const id = this.selectedId();
    if (!parent || !id) return;
    const idx = parent.children.findIndex((c) => c.id === id);
    const next = parent.children[idx + delta];
    if (next) this.select(next.id);
  }

  // =====================================================================
  // Mutation (all routes through commit)
  // =====================================================================

  private commit(nextRoot: MadNode, coalesceKey: string | null = null): void {
    const current = this.document();
    if (!current || nextRoot === current.root) return;
    const now = Date.now();
    const coalesce = coalesceKey !== null && coalesceKey === this.coalesceKey && now < this.coalesceUntil;
    if (!coalesce) {
      this.past.update((p) => [...p.slice(-(HISTORY_LIMIT - 1)), current.root]);
      this.future.set([]);
    }
    this.coalesceKey = coalesceKey;
    this.coalesceUntil = now + 900;
    this.document.set({ ...current, root: nextRoot, updatedAt: new Date().toISOString() });
    this.markDirty();
  }

  updateProps(id: NodeId, props: NodePatch['props']): void {
    const root = this.root();
    if (!root || !props) return;
    this.commit(patchNode(root, id, { props }), `props:${id}:${Object.keys(props).join(',')}`);
  }

  updateStyle(id: NodeId, style: NodePatch['style']): void {
    const root = this.root();
    if (!root || !style) return;
    this.commit(patchNode(root, id, { style }), `style:${id}:${Object.keys(style).join(',')}`);
  }

  renameNode(id: NodeId, name: string): void {
    const root = this.root();
    if (!root || !name.trim()) return;
    this.commit(patchNode(root, id, { name: name.trim().slice(0, 80) }), `name:${id}`);
  }

  toggleLock(id: NodeId): void {
    const root = this.root();
    const node = root ? findNode(root, id) : null;
    if (!root || !node) return;
    this.commit(patchNode(root, id, { locked: !node.locked }));
  }

  toggleHidden(id: NodeId): void {
    const root = this.root();
    const node = root ? findNode(root, id) : null;
    if (!root || !node) return;
    this.commit(patchNode(root, id, { style: { hidden: !node.style.hidden } }));
  }

  remove(id: NodeId): void {
    const root = this.root();
    if (!root || root.id === id) return;
    const node = findNode(root, id);
    if (!node || node.locked) {
      this.toast.info('Locked', 'Unlock the component before deleting it.');
      return;
    }
    const parent = findParent(root, id);
    this.commit(removeNode(root, id));
    this.select(parent?.id ?? null);
  }

  duplicate(id: NodeId): void {
    const root = this.root();
    if (!root || root.id === id) return;
    const node = findNode(root, id);
    const parent = findParent(root, id);
    if (!node || !parent) return;
    const copy = cloneWithFreshIds(node, createIdFactory());
    const idx = parent.children.findIndex((c) => c.id === id);
    this.commit(insertNode(root, parent.id, idx + 1, { ...copy, source: 'user', name: `${node.name} copy`.slice(0, 80) }));
    this.select(copy.id);
    this.render.markEntering([copy.id]);
  }

  moveWithinParent(id: NodeId, delta: 1 | -1): void {
    const root = this.root();
    if (!root) return;
    const parent = findParent(root, id);
    if (!parent) return;
    const idx = parent.children.findIndex((c) => c.id === id);
    const target = idx + delta;
    if (target < 0 || target >= parent.children.length) return;
    this.commit(moveNode(root, id, parent.id, target > idx ? target + 1 : target));
  }

  moveNodeTo(id: NodeId, parentId: NodeId, index: number): void {
    const root = this.root();
    if (!root || id === parentId) return;
    const node = findNode(root, id);
    if (!node) return;
    if (node.locked) {
      this.toast.info('Locked', 'Unlock the component before moving it.');
      return;
    }
    const currentParent = findParent(root, id);
    let targetIndex = index;
    if (currentParent?.id === parentId) {
      const currentIdx = currentParent.children.findIndex((c) => c.id === id);
      if (currentIdx < index) targetIndex = index - 1;
      if (currentIdx === targetIndex) return;
    }
    const next = moveNode(root, id, parentId, targetIndex);
    if (next === root) return;
    this.commit(next);
    this.select(id);
  }

  insertPreset(parentId: NodeId, index: number, presetId: string): void {
    const root = this.root();
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!root || !preset) return;
    const node = cloneWithFreshIds(preset.node, createIdFactory());
    this.commit(insertNode(root, parentId, index, node));
    this.select(node.id);
    this.render.markEntering([node.id]);
    this.log('info', `Inserted ${preset.name}.`);
  }

  /** Insert at the end of the selected container (or the main content area). */
  insertPresetAtSelection(presetId: string): void {
    const root = this.root();
    if (!root) {
      this.toast.info('Start with a build', 'Generate an app or start a blank canvas first.');
      return;
    }
    const selected = this.selectedNode();
    const target = selected && ['page', 'section', 'stack', 'grid', 'card', 'form', 'tabs'].includes(selected.type) ? selected : (this.selectedParent() ?? this.mainContent(root) ?? root);
    this.insertPreset(target.id, target.children.length, presetId);
  }

  private mainContent(root: MadNode): MadNode | null {
    return root.children.find((c) => c.type === 'stack' && c.name === 'Main content') ?? root.children.find((c) => c.type === 'stack') ?? null;
  }

  setDesignSystem(ds: DesignSystem): void {
    this.pendingDesignSystem.set(ds);
    const current = this.document();
    if (!current || current.designSystem === ds) return;
    this.document.set({ ...current, designSystem: ds, updatedAt: new Date().toISOString() });
    this.markDirty();
  }

  undo(): void {
    const current = this.document();
    const past = this.past();
    const prev = past[past.length - 1];
    if (!current || !prev) return;
    this.past.set(past.slice(0, -1));
    this.future.update((f) => [current.root, ...f]);
    this.document.set({ ...current, root: prev });
    this.coalesceKey = null;
    this.reconcileSelection();
    this.markDirty();
  }

  redo(): void {
    const current = this.document();
    const future = this.future();
    const next = future[0];
    if (!current || !next) return;
    this.future.set(future.slice(1));
    this.past.update((p) => [...p, current.root]);
    this.document.set({ ...current, root: next });
    this.coalesceKey = null;
    this.reconcileSelection();
    this.markDirty();
  }

  private reconcileSelection(): void {
    const root = this.root();
    const id = this.selectedId();
    if (root && id && !findNode(root, id)) this.select(null);
  }

  // =====================================================================
  // Persistence
  // =====================================================================

  private markDirty(): void {
    this.saveState.set('dirty');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), 900);
  }

  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.saveInFlight) {
      await this.saveInFlight;
      if (this.saveState() !== 'dirty') return;
    }
    const doc = this.document();
    const id = this.projectId();
    if (!doc || !id) return;
    this.saveInFlight = (async () => {
      if (id.startsWith('local-')) {
        this.writeLocal(id, this.lastPrompt() ?? '');
        return;
      }
      this.saveState.set('saving');
      try {
        const saved = await this.api.saveDocument(id, { baseVersion: this.documentVersion(), document: MadDocumentSchema.parse(doc) });
        this.documentVersion.set(saved.version);
        this.saveState.set('saved');
        this.lastSavedAt.set(saved.createdAt);
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'conflict') {
          this.saveState.set('conflict');
          this.toast.error('Save conflict', 'This project was changed elsewhere. Reload to get the latest version; your local edits stay in undo history.', { label: 'Reload latest', run: () => void this.reloadLatest() });
        } else if (error instanceof ApiRequestError && error.status === 401) {
          this.saveState.set('error');
          this.toast.error('Signed out', 'Your session ended. Sign in to keep saving this project; edits are kept in memory.', { label: 'Sign in', run: () => void this.auth.requireSession().then((ok) => { if (ok) void this.save(); }) });
        } else if (error instanceof ApiUnreachableError) {
          this.saveState.set('error');
          this.mode.set('offline');
          this.toast.error('Could not save', 'The API is unreachable. Edits are kept in memory; retry when it is back.', { label: 'Retry', run: () => void this.save() });
        } else {
          this.saveState.set('error');
          this.toast.error('Could not save', error instanceof Error ? error.message : String(error), { label: 'Retry', run: () => void this.save() });
        }
      }
    })();
    try {
      await this.saveInFlight;
    } finally {
      this.saveInFlight = null;
    }
  }

  async reloadLatest(): Promise<void> {
    const id = this.projectId();
    if (!id || id.startsWith('local-')) return;
    try {
      const doc = await this.api.getDocument(id);
      const current = this.document();
      if (current) this.past.update((p) => [...p, current.root]);
      this.applyDocument(doc);
      this.saveState.set('saved');
      this.toast.success('Reloaded', `Now on version ${doc.version}.`);
    } catch (error) {
      this.toast.error('Reload failed', error instanceof Error ? error.message : String(error));
    }
  }

  async renameProject(name: string): Promise<void> {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed || trimmed === this.projectName()) return;
    const previous = this.projectName();
    this.projectName.set(trimmed);
    const id = this.projectId();
    if (!id) return;
    if (id.startsWith('local-')) {
      this.writeLocal(id, this.lastPrompt() ?? '');
      return;
    }
    try {
      const project = await this.api.renameProject(id, trimmed, this.project()?.description ?? null);
      this.project.set(project);
    } catch (error) {
      this.projectName.set(previous);
      this.toast.error('Rename failed', error instanceof Error ? error.message : String(error));
    }
  }

  private writeLocal(id: string, prompt: string): void {
    const doc = this.document();
    if (!doc) return;
    const record: LocalProject = { id, name: this.projectName(), prompt, document: doc, tables: this.tables(), integrations: this.integrations(), updatedAt: new Date().toISOString() };
    try {
      localStorage.setItem(`${LOCAL_PREFIX}${id}`, JSON.stringify(record));
      this.saveState.set('saved');
      this.lastSavedAt.set(record.updatedAt);
    } catch {
      this.saveState.set('error');
      this.toast.error('Could not save locally', 'Browser storage is unavailable or full.');
    }
  }

  private readLocal(id: string): LocalProject | null {
    try {
      const raw = localStorage.getItem(`${LOCAL_PREFIX}${id}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LocalProject;
      const doc = MadDocumentSchema.safeParse(parsed.document);
      if (!doc.success) return null;
      return { ...parsed, document: doc.data };
    } catch {
      return null;
    }
  }

  listLocalProjects(): Array<{ id: string; name: string; updatedAt: string; prompt: string }> {
    const out: Array<{ id: string; name: string; updatedAt: string; prompt: string }> = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key?.startsWith(LOCAL_PREFIX)) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as LocalProject;
        out.push({ id: parsed.id, name: parsed.name, updatedAt: parsed.updatedAt, prompt: parsed.prompt });
      }
    } catch {
      // storage unavailable
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  // =====================================================================
  // Integrations & deployments
  // =====================================================================

  async attachIntegration(slug: string): Promise<void> {
    const rule = INTEGRATION_RULES.find((r) => r.slug === slug);
    const fromCatalog = this.catalog().find((c) => c.slug === slug);
    const label = fromCatalog?.name ?? rule?.label ?? slug;
    const scopes = fromCatalog?.scopes ?? [...(rule?.scopes ?? [])];
    if (this.integrations().some((i) => i.slug === slug)) return;
    this.integrations.update((list) => [...list, { slug, label, scopes, status: 'pending' }]);
    this.document.update((d) => (d && !d.integrations.includes(slug) ? { ...d, integrations: [...d.integrations, slug] } : d));
    this.markDirty();
    const id = this.projectId();
    if (id && !id.startsWith('local-') && this.mode() === 'api') {
      try {
        await this.api.attachIntegration(id, slug);
      } catch (error) {
        this.integrations.update((list) => list.filter((i) => i.slug !== slug));
        this.toast.error('Could not add integration', error instanceof Error ? error.message : String(error));
      }
    }
  }

  async connectIntegration(slug: string): Promise<void> {
    // Optimistic: mark connected, confirm with the API when available.
    this.integrations.update((list) => list.map((i) => (i.slug === slug ? { ...i, status: 'connected' } : i)));
    const id = this.projectId();
    if (id && !id.startsWith('local-') && this.mode() === 'api') {
      try {
        const list = await this.api.listProjectIntegrations(id);
        const existing = list.find((pi) => pi.integrationSlug === slug) ?? (await this.api.attachIntegration(id, slug));
        await this.api.setIntegrationStatus(id, existing.id, 'connected', { connectedAt: new Date().toISOString() });
      } catch (error) {
        this.integrations.update((list) => list.map((i) => (i.slug === slug ? { ...i, status: 'error' } : i)));
        this.toast.error('Connection failed', error instanceof Error ? error.message : String(error));
        return;
      }
    } else {
      this.writeLocal(id ?? '', this.lastPrompt() ?? '');
    }
    this.toast.success(`${this.integrations().find((i) => i.slug === slug)?.label ?? slug} connected`);
  }

  async deploy(target: Deployment['target']): Promise<void> {
    const id = this.projectId();
    if (!id) return;
    if (id.startsWith('local-') || this.mode() !== 'api') {
      this.toast.info('Deploy needs the API', 'Local projects cannot be deployed. Sign in and re-run the build to deploy it.');
      return;
    }
    if (!(await this.auth.requireSession())) return;
    if (this.saveState() === 'dirty' || this.saveState() === 'saving') await this.save();
    this.deploying.set(true);
    try {
      let deployment = await this.api.createDeployment(id, target);
      this.deployments.update((d) => [deployment, ...d]);
      this.toast.info(`Deploying to ${target}`, this.health()?.deploy?.mode === 'fleet' ? 'Rendering the page and publishing it to the fleet…' : 'Rendering the page and publishing it to the local export root…');
      // Poll until terminal.
      for (let i = 0; i < 40 && (deployment.status === 'queued' || deployment.status === 'building'); i += 1) {
        await new Promise((r) => setTimeout(r, 700));
        deployment = await this.api.getDeployment(id, deployment.id);
        this.deployments.update((list) => list.map((d) => (d.id === deployment.id ? deployment : d)));
      }
      if (deployment.status === 'live' && deployment.url) {
        const url = deployment.url;
        this.toast.success('Deployed', url.replace(/^https?:\/\//, ''), { label: 'Open', run: () => void window.open(url, '_blank', 'noopener') });
        this.log('info', `Deployed ${target}: ${url}`);
        if (target === 'production') this.project.update((p) => (p ? { ...p, status: 'deployed' } : p));
      } else {
        this.toast.error('Deployment did not finish', `Status: ${deployment.status}`);
      }
    } catch (error) {
      this.toast.error('Deployment failed', error instanceof Error ? error.message : String(error));
    } finally {
      this.deploying.set(false);
    }
  }

  // =====================================================================
  // Account
  // =====================================================================

  /** Ends the session and leaves any cloud project; local projects stay available. */
  async signOut(): Promise<void> {
    const wasCloud = this.projectId() !== null && !this.isLocal();
    if (wasCloud && (this.saveState() === 'dirty' || this.saveState() === 'saving')) await this.save().catch(() => undefined);
    await this.auth.signOut();
    if (wasCloud) {
      this.resetDocumentState();
      await this.router.navigate(['/studio'], { replaceUrl: true, queryParams: {} });
    }
    this.toast.info('Signed out', 'Cloud projects are hidden until you sign in again.');
  }

  /** Opens the sign-in sheet; resolves true once a session exists. */
  signIn(): Promise<boolean> {
    return this.auth.requireSession('sign-in');
  }
  // =====================================================================
  // Schema export
  // =====================================================================

  schemaSql(): string {
    const typeFor = (col: string): string => {
      if (col === 'id') return 'uuid PRIMARY KEY DEFAULT gen_random_uuid()';
      if (col.endsWith('_id')) return 'uuid NOT NULL';
      if (col.endsWith('_at') || col === 'day') return col === 'day' ? 'date NOT NULL' : 'timestamptz';
      if (col.endsWith('_cents') || col === 'quantity' || col === 'position' || col === 'probability' || col.endsWith('_qty') || col.endsWith('_days') || col === 'weekday') return 'integer';
      if (col === 'enabled' || col.startsWith('is_')) return 'boolean NOT NULL DEFAULT false';
      if (col === 'payload' || col === 'properties' || col === 'permissions' || col === 'attachments' || col === 'definition') return 'jsonb NOT NULL DEFAULT \'{}\'::jsonb';
      if (col === 'value' || col === 'tax_rate') return 'numeric(12,2)';
      return 'text';
    };
    const lines: string[] = ['-- Generated by MAD Studio', 'BEGIN;', 'CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''];
    const tables = this.tables();
    const names = new Set(tables.map((t) => t.table));
    for (const t of tables) {
      lines.push(`CREATE TABLE ${t.table} (`);
      const cols = t.columns.map((c) => `  ${c.padEnd(24)} ${typeFor(c)}`);
      const hasId = t.columns.includes('id');
      const fks = t.columns
        .filter((c) => c.endsWith('_id') && c !== 'id')
        .map((c) => {
          const base = c.slice(0, -3);
          const candidates = [`${base}s`, `${base}es`, base, `${base.replace(/y$/, 'ies')}`];
          const ref = candidates.find((n) => names.has(n));
          return ref ? `  FOREIGN KEY (${c}) REFERENCES ${ref}(id) ON DELETE CASCADE` : null;
        })
        .filter((x): x is string => x !== null);
      if (!hasId && t.columns.length >= 2) fks.unshift(`  PRIMARY KEY (${t.columns.slice(0, 2).join(', ')})`);
      lines.push([...cols, ...fks].join(',\n'));
      lines.push(');');
      for (const c of t.columns.filter((x) => x.endsWith('_id') && x !== 'id')) lines.push(`CREATE INDEX ${t.table}_${c}_idx ON ${t.table} (${c});`);
      lines.push('');
    }
    lines.push('COMMIT;');
    return lines.join('\n');
  }
}
