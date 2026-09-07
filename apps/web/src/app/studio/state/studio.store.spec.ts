import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MadDocumentSchema, type MadDocument, type MadNode } from '@mad/schema';
import { ApiRequestError } from '../../core/api/api-client';
import { AuthService } from '../../core/auth/auth.service';
import { RenderContext } from '../../core/render/render-context';
import { StudioStore } from './studio.store';
import { aHealth, aProject, anAuthState, fakeApiClient, studioProviders, type FakeApiClient } from '../../testing/studio-harness';

const node = (id: string, over: Partial<MadNode> = {}): MadNode => ({ id, type: 'stack', name: 'Stack', props: {}, style: {}, children: [], source: 'ai', locked: false, ...over });

const aDocument = (): MadDocument => ({
  version: 1,
  designSystem: 'tailwind',
  theme: 'dark',
  root: node('n_root0001', { type: 'page', name: 'Page', children: [node('n_child001', { name: 'Main content' })] }),
  integrations: [],
  tables: [],
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
});

/**
 * The store is the studio's state machine: what is being built, what is saved,
 * and what the editor is allowed to do next. These cover the paths a person
 * actually walks, including the ones that used to misreport their state.
 */
describe('StudioStore', () => {
  let api: FakeApiClient;

  const boot = (overrides: Record<string, unknown> = {}) => {
    api = fakeApiClient(overrides);
    TestBed.configureTestingModule({ providers: [...studioProviders(api), RenderContext, StudioStore] });
    return TestBed.inject(StudioStore);
  };
  /** A reachable API, so the store takes the cloud path. */
  const online = () => ({ configured: true, health: vi.fn(() => Promise.resolve(aHealth())) });
  /** Drains microtasks until a condition holds; works under fake timers. */
  const settle = async (until: () => boolean) => {
    for (let i = 0; i < 200 && !until(); i += 1) await Promise.resolve();
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  describe('building without an API', () => {
    it('runs the planner in the browser and keeps a valid result', async () => {
      vi.useFakeTimers();
      const s = boot();
      void s.generate('Build an internal CRM dashboard with Stripe billing and a customer support chat');
      await vi.advanceTimersByTimeAsync(60_000);

      expect(s.genStatus()).toBe('complete');
      expect(MadDocumentSchema.safeParse(s.document()).success).toBe(true);
      expect(s.nodeCount()).toBeGreaterThan(10);
      expect(s.tables().length).toBeGreaterThan(0);
      expect(s.integrations().map((i) => i.slug)).toContain('stripe');
      // A local project is written to this browser, so a reload finds it again.
      expect(s.projectId()?.startsWith('local-')).toBe(true);
      expect(s.saveState()).toBe('saved');
      expect(s.listLocalProjects().map((p) => p.id)).toContain(s.projectId());
    });

    it('reports a build that is running, and stops reporting when it ends', async () => {
      vi.useFakeTimers();
      const s = boot();
      void s.generate('Build a task board for a design team');
      await settle(() => s.generating());
      expect(s.generating()).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(s.generating()).toBe(false);
      expect(s.elapsedMs()).toBeGreaterThan(0);
    });
  });

  describe('signing in before building', () => {
    it('does not claim to be building while it waits for a password', async () => {
      vi.useFakeTimers();
      const s = boot(online());
      const auth = TestBed.inject(AuthService);

      const pending = s.generate('Build a warehouse console with inventory');
      await settle(() => auth.dialogOpen());

      // The sheet is open and nothing has started: no timer, no Stop button, no cleared canvas.
      expect(s.preparing()).toBe(true);
      expect(s.generating()).toBe(false);
      expect(s.genStatus()).toBe('idle');
      expect(s.startedAt()).toBeNull();

      auth.dismissDialog();
      await vi.advanceTimersByTimeAsync(60_000);
      await pending;
      expect(s.preparing()).toBe(false);
      expect(s.genStatus()).toBe('complete');
    });

    it('ignores a second prompt while the first is still waiting to start', async () => {
      vi.useFakeTimers();
      const s = boot(online());
      const auth = TestBed.inject(AuthService);
      void s.generate('Build a warehouse console');
      await settle(() => auth.dialogOpen());

      await s.generate('Build something else entirely');
      expect(s.lastPrompt()).toBeNull();
      expect(api.createGeneration).not.toHaveBeenCalled();

      auth.dismissDialog();
      await vi.advanceTimersByTimeAsync(60_000);
    });
  });

  describe('editing', () => {
    it('coalesces a run of edits into one undo step', () => {
      const s = boot();
      s.document.set(aDocument());

      s.renameNode('n_child001', 'First');
      s.renameNode('n_child001', 'Second');
      expect(s.canUndo()).toBe(true);

      s.undo();
      expect(s.root()?.children[0]?.name).toBe('Main content');
      expect(s.canUndo()).toBe(false);
      expect(s.canRedo()).toBe(true);

      s.redo();
      expect(s.root()?.children[0]?.name).toBe('Second');
    });

    it('keeps different kinds of edit separately undoable', () => {
      const s = boot();
      s.document.set(aDocument());
      s.renameNode('n_child001', 'Renamed');
      s.updateProps('n_child001', { text: 'hello' });

      s.undo();
      expect(s.root()?.children[0]?.props['text']).toBeUndefined();
      expect(s.root()?.children[0]?.name).toBe('Renamed');
      s.undo();
      expect(s.root()?.children[0]?.name).toBe('Main content');
    });

    it('refuses to delete a locked component', () => {
      const s = boot();
      const doc = aDocument();
      s.document.set({ ...doc, root: { ...doc.root, children: [node('n_child001', { locked: true })] } });
      s.remove('n_child001');
      expect(s.root()?.children).toHaveLength(1);
    });

    it('marks the document dirty on every edit', () => {
      const s = boot();
      s.document.set(aDocument());
      s.saveState.set('saved');
      s.renameNode('n_child001', 'Changed');
      expect(s.saveState()).toBe('dirty');
    });
  });

  describe('saving', () => {
    const withCloudProject = (s: StudioStore) => {
      s.project.set(aProject());
      s.projectId.set(aProject().id);
      s.documentVersion.set(1);
      s.document.set(aDocument());
    };

    it('reports a conflict instead of pretending the save worked', async () => {
      const s = boot(online());
      api.saveDocument.mockRejectedValueOnce(new ApiRequestError({ statusCode: 409, code: 'conflict', message: 'stale', requestId: 'r' }, 409));
      withCloudProject(s);

      await s.save();
      expect(s.saveState()).toBe('conflict');
    });

    it('keeps the work in memory when the session has gone', async () => {
      const s = boot(online());
      api.saveDocument.mockRejectedValueOnce(new ApiRequestError({ statusCode: 401, code: 'unauthenticated', message: 'gone', requestId: 'r' }, 401));
      withCloudProject(s);

      await s.save();
      expect(s.saveState()).toBe('error');
      expect(s.document()).not.toBeNull();
    });

    it('writes a local project to this browser rather than to the API', async () => {
      const s = boot(online());
      s.projectId.set('local-abc');
      s.document.set(aDocument());
      await s.save();

      expect(api.saveDocument).not.toHaveBeenCalled();
      expect(s.saveState()).toBe('saved');
      expect(s.listLocalProjects().map((p) => p.id)).toContain('local-abc');
    });
  });

  describe('account', () => {
    it('mirrors the signed-in identity for the chrome to render', () => {
      const s = boot(online());
      const auth = TestBed.inject(AuthService);
      expect(s.signedIn()).toBe(false);

      auth.state.set(anAuthState());
      auth.status.set('authenticated');
      expect(s.signedIn()).toBe(true);
      expect(s.account()?.email).toBe('ada@example.com');
    });

    it('leaves a cloud project on sign-out, so nothing stays on screen unowned', async () => {
      const s = boot(online());
      const auth = TestBed.inject(AuthService);
      auth.state.set(anAuthState());
      auth.status.set('authenticated');
      s.project.set(aProject());
      s.projectId.set(aProject().id);
      s.document.set(aDocument());
      s.saveState.set('saved');

      await s.signOut();
      expect(auth.status()).toBe('anonymous');
      expect(s.document()).toBeNull();
      expect(s.projectId()).toBeNull();
    });
  });
});
