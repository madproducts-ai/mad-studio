import { TestBed } from '@angular/core/testing';
import { RenderContext } from '../../core/render/render-context';
import { StudioStore } from '../state/studio.store';
import { StudioTopbar } from './studio-topbar.component';
import { aDeployment, aProject, anAuthState, fakeApiClient, studioProviders, type FakeApiClient } from '../../testing/studio-harness';
import { AuthService } from '../../core/auth/auth.service';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The top bar carries the studio's primary actions, so its states have to be
 * truthful: what is saved, what is deployed, what can still be opened, and what
 * a keyboard or screen reader user is told about each.
 */
describe('StudioTopbar', () => {
  let api: FakeApiClient;

  const render = () => {
    const fixture = TestBed.createComponent(StudioTopbar);
    fixture.detectChanges();
    return fixture;
  };

  const store = () => TestBed.inject(StudioStore);
  const text = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const button = (fixture: { nativeElement: HTMLElement }, label: string) =>
    [...fixture.nativeElement.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').trim().startsWith(label)) as HTMLButtonElement | undefined;

  beforeEach(() => {
    api = fakeApiClient();
    TestBed.configureTestingModule({ providers: [...studioProviders(api), RenderContext, StudioStore] });
  });

  describe('save state', () => {
    it('reads Draft before anything is built and Building while it runs', () => {
      const fixture = render();
      expect(text(fixture)).toContain('Draft');
      store().genStatus.set('generating');
      fixture.detectChanges();
      expect(text(fixture)).toContain('Building');
    });

    it('names the saved version for a cloud project and says local for a local one', () => {
      const fixture = render();
      store().documentVersion.set(4);
      store().saveState.set('saved');
      store().projectId.set(aProject().id);
      fixture.detectChanges();
      expect(text(fixture)).toContain('Saved · v4');

      store().projectId.set('local-abc');
      fixture.detectChanges();
      expect(text(fixture)).toContain('Saved locally');
    });

    it('surfaces a conflict rather than reporting success', () => {
      const fixture = render();
      store().saveState.set('conflict');
      fixture.detectChanges();
      expect(text(fixture)).toContain('Conflict');
      expect(fixture.nativeElement.querySelector('.status')?.getAttribute('data-state')).toBe('error');
    });
  });

  describe('deploy panel', () => {
    const openable = () => {
      const s = store();
      s.document.set({ version: 1, designSystem: 'tailwind', theme: 'dark', root: { id: 'n_root0001', type: 'page', name: 'Page', props: {}, style: {}, children: [], source: 'ai', locked: false }, integrations: [], tables: [], updatedAt: new Date().toISOString() });
    };

    it('is a labelled disclosure, not an ARIA menu with no items', () => {
      const fixture = render();
      openable();
      fixture.detectChanges();
      const trigger = button(fixture, 'Deploy')!;
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(trigger.getAttribute('aria-controls')).toBe('deploy-menu');

      trigger.click();
      fixture.detectChanges();
      const panel = fixture.nativeElement.querySelector('#deploy-menu') as HTMLElement;
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      expect(panel.getAttribute('role')).toBe('group');
      expect(panel.getAttribute('aria-label')).toBeTruthy();
      // A menu role would promise menuitem children and an arrow-key model.
      expect(panel.querySelectorAll('[role=menuitem]')).toHaveLength(0);
    });

    it('closes on Escape and hands focus back to the trigger', () => {
      const fixture = render();
      openable();
      fixture.detectChanges();
      const trigger = button(fixture, 'Deploy')!;
      trigger.click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#deploy-menu')).not.toBeNull();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#deploy-menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('stays shut while a build is running, since there is nothing settled to deploy', () => {
      const fixture = render();
      openable();
      store().genStatus.set('generating');
      fixture.detectChanges();
      expect(button(fixture, 'Deploy')!.disabled).toBe(true);
    });

    it('renders a deployment without a URL as plain text instead of a link to nowhere', () => {
      const fixture = render();
      openable();
      store().deployments.set([aDeployment({ status: 'rolled-back', url: null }), aDeployment({ id: 'live-1', status: 'live' })]);
      fixture.detectChanges();
      button(fixture, 'Deploy')!.click();
      fixture.detectChanges();

      const panel = fixture.nativeElement.querySelector('#deploy-menu') as HTMLElement;
      const links = [...panel.querySelectorAll('a.menu-item')];
      const statics = [...panel.querySelectorAll('span.menu-item.is-static')];
      expect(links).toHaveLength(1);
      expect(statics).toHaveLength(1);
      expect(statics[0]?.textContent).toContain('Withdrawn');
      expect(links[0]?.getAttribute('href')).toBe(aDeployment().url);
    });
  });

  describe('account', () => {
    beforeEach(() => {
      TestBed.resetTestingModule();
      api = fakeApiClient({ configured: true });
      TestBed.configureTestingModule({ providers: [...studioProviders(api), RenderContext, StudioStore] });
    });

    it('offers sign-in when the API is reachable and nobody is signed in', () => {
      const fixture = render();
      store().mode.set('api');
      fixture.detectChanges();
      expect(button(fixture, 'Sign in')).toBeDefined();
      expect(fixture.nativeElement.querySelector('[aria-label="Account"]')).toBeNull();
    });

    it('shows the account panel with the signed-in identity', () => {
      const fixture = render();
      const auth = TestBed.inject(AuthService);
      auth.state.set(anAuthState());
      auth.status.set('authenticated');
      store().mode.set('api');
      fixture.detectChanges();

      const trigger = fixture.nativeElement.querySelector('[aria-label="Account"]') as HTMLButtonElement;
      expect(trigger.textContent?.trim()).toBe('AL');
      trigger.click();
      fixture.detectChanges();
      const panel = fixture.nativeElement.querySelector('#account-menu') as HTMLElement;
      expect(panel.getAttribute('role')).toBe('group');
      expect(panel.textContent).toContain('ada@example.com');
      expect(panel.textContent).toContain('Ada Workspace');
    });

    it('is absent entirely when the studio is running without an API', () => {
      const fixture = render();
      store().mode.set('offline');
      fixture.detectChanges();
      expect(button(fixture, 'Sign in')).toBeUndefined();
      expect(fixture.nativeElement.querySelector('[aria-label="Account"]')).toBeNull();
    });
  });

  it('names the production target from what the API reports, not a guess', () => {
    const fixture = render();
    const s = store();
    s.projectId.set(aProject().id);
    s.project.set(aProject());
    s.document.set({ version: 1, designSystem: 'tailwind', theme: 'dark', root: { id: 'n_root0001', type: 'page', name: 'Page', props: {}, style: {}, children: [], source: 'ai', locked: false }, integrations: [], tables: [], updatedAt: new Date().toISOString() });
    s.health.set({ status: 'ok', storage: 'postgres', storageReachable: true, uptimeMs: 1, env: 'production', version: '0.2.0', planner: { mode: 'model', model: 'claude-opus-5' }, deploy: { mode: 'fleet', publicBase: 'https://studio.madproducts.ai/apps' } });
    fixture.detectChanges();
    button(fixture, 'Deploy')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#deploy-menu')?.textContent).toContain('studio.madproducts.ai/apps/ops-console-111111/');
  });
});
