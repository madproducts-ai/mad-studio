import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { RenderContext } from '../../core/render/render-context';
import { StudioStore } from '../state/studio.store';
import { PromptBar } from './prompt-bar.component';
import { fakeApiClient, studioProviders, type FakeApiClient } from '../../testing/studio-harness';

/**
 * The prompt bar is the studio's main control. Its action must describe what
 * pressing it will do, and it must never offer to stop work that has not begun.
 */
describe('PromptBar', () => {
  let api: FakeApiClient;

  const render = () => {
    const fixture = TestBed.createComponent(PromptBar);
    fixture.detectChanges();
    return fixture;
  };
  const store = () => TestBed.inject(StudioStore);
  const action = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.querySelector('button[type=submit], button.btn-secondary') as HTMLButtonElement;
  const textarea = (fixture: { nativeElement: HTMLElement }) => fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;

  const withDocument = () =>
    store().document.set({
      version: 1,
      designSystem: 'tailwind',
      theme: 'dark',
      root: { id: 'n_root0001', type: 'page', name: 'Page', props: {}, style: {}, children: [], source: 'ai', locked: false },
      integrations: [],
      tables: [],
      updatedAt: new Date().toISOString(),
    });

  beforeEach(() => {
    api = fakeApiClient();
    TestBed.configureTestingModule({ providers: [...studioProviders(api), RenderContext, StudioStore] });
  });

  it('offers Build first and Rebuild once something exists', () => {
    const fixture = render();
    expect(action(fixture).textContent).toContain('Build');
    expect(action(fixture).textContent).not.toContain('Rebuild');

    withDocument();
    fixture.detectChanges();
    expect(action(fixture).textContent).toContain('Rebuild');
  });

  it('needs a prompt worth building before it will submit', () => {
    const fixture = render();
    expect(action(fixture).disabled).toBe(true);

    store().prompt.set('abc');
    fixture.detectChanges();
    expect(action(fixture).disabled).toBe(true);

    store().prompt.set('build a crm');
    fixture.detectChanges();
    expect(action(fixture).disabled).toBe(false);
  });

  it('turns into Stop only while a build is actually running', () => {
    const fixture = render();
    store().genStatus.set('generating');
    fixture.detectChanges();
    expect(action(fixture).textContent).toContain('Stop');
    expect(textarea(fixture).disabled).toBe(true);
  });

  it('stays a disabled Build while a request is being prepared, since there is nothing to stop', () => {
    const fixture = render();
    store().prompt.set('build a crm');
    store().preparing.set(true);
    fixture.detectChanges();

    expect(action(fixture).textContent).not.toContain('Stop');
    expect(action(fixture).disabled).toBe(true);
    expect(textarea(fixture).disabled).toBe(true);
  });

  it('shows the console with the build log and token usage when opened', () => {
    const fixture = render();
    store().consoleOpen.set(true);
    store().log('info', 'Reading the brief');
    store().tokens.set({ input: 1200, output: 640 });
    fixture.detectChanges();

    const console_ = fixture.nativeElement.querySelector('[aria-label="Build console"]') as HTMLElement;
    expect(console_).not.toBeNull();
    expect(console_.textContent).toContain('Reading the brief');
    expect(console_.textContent).toContain('1200');
  });

  it('announces build progress politely rather than stealing focus', () => {
    const fixture = render();
    store().genStatus.set('generating');
    store().steps.set([{ id: 'analyze', label: 'Understand the brief', status: 'active' }]);
    fixture.detectChanges();

    const plan = fixture.nativeElement.querySelector('[aria-label="Build plan"]') as HTMLElement;
    expect(plan.getAttribute('role')).toBe('status');
    expect(plan.getAttribute('aria-live')).toBe('polite');
  });
});
