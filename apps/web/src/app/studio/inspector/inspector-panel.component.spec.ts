import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { NODE_TYPES, type MadDocument, type MadNode, type NodeType } from '@mad/schema';
import { RenderContext } from '../../core/render/render-context';
import { StudioStore } from '../state/studio.store';
import { InspectorPanel } from './inspector-panel.component';
import { fakeApiClient, studioProviders, type FakeApiClient } from '../../testing/studio-harness';

const node = (over: Partial<MadNode> = {}): MadNode => ({ id: 'n_child001', type: 'stack', name: 'Main content', props: {}, style: {}, children: [], source: 'ai', locked: false, ...over });

const documentWith = (child: MadNode): MadDocument => ({
  version: 1,
  designSystem: 'tailwind',
  theme: 'dark',
  root: { id: 'n_root0001', type: 'page', name: 'Page', props: {}, style: {}, children: [child], source: 'ai', locked: false },
  integrations: [],
  tables: [],
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
});

/**
 * The inspector is where a person changes one component at a time. Every
 * control has to name itself, and every change has to reach the store as an
 * undoable edit rather than a silent mutation of the tree.
 */
describe('InspectorPanel', () => {
  let api: FakeApiClient;

  const store = () => TestBed.inject(StudioStore);
  const render = (n: MadNode) => {
    store().document.set(documentWith(n));
    store().select(n.id);
    const fixture = TestBed.createComponent(InspectorPanel);
    fixture.componentRef.setInput('node', n);
    fixture.detectChanges();
    return fixture;
  };
  const el = (fixture: { nativeElement: HTMLElement }, sel: string) => fixture.nativeElement.querySelector(sel) as HTMLElement;
  const controls = (fixture: { nativeElement: HTMLElement }) => [...fixture.nativeElement.querySelectorAll('button, input, textarea, select')] as HTMLElement[];
  /** The studio binds this input to `store.selectedNode()`; re-reading it mirrors that flow after an edit. */
  const sync = (fixture: ReturnType<typeof TestBed.createComponent<InspectorPanel>>) => {
    fixture.componentRef.setInput('node', store().selectedNode()!);
    fixture.detectChanges();
  };
  const tab = (fixture: { nativeElement: HTMLElement }, label: string) => ([...fixture.nativeElement.querySelectorAll('[role=tab]')] as HTMLButtonElement[]).find((t) => t.textContent?.includes(label))!;

  /** The name a screen reader would announce: aria-label, an associated label, own text, or title. */
  const accessibleName = (control: HTMLElement): string => {
    const labelled = control.id ? control.ownerDocument.querySelector(`label[for="${control.id}"]`) : null;
    return (control.getAttribute('aria-label') ?? labelled?.textContent ?? control.textContent ?? control.getAttribute('title') ?? '').trim();
  };

  beforeEach(() => {
    api = fakeApiClient();
    TestBed.configureTestingModule({ providers: [...studioProviders(api), RenderContext, StudioStore] });
  });

  describe('accessible names', () => {
    // The switches here once used a plain <span> as their label, which named
    // nothing: two identical unlabelled switches, announced only as "switch".
    it.each(NODE_TYPES as readonly NodeType[])('names every control for a %s', (type) => {
      const fixture = render(node({ type, style: { padding: { top: 8, right: 8, bottom: 8, left: 8 } } }));

      for (const view of ['Content', 'Layout & style']) {
        tab(fixture, view).click();
        fixture.detectChanges();
        const unnamed = controls(fixture).filter((c) => accessibleName(c) === '');
        expect(unnamed.map((c) => `${c.tagName.toLowerCase()}.${c.className.split(' ')[0]}`)).toEqual([]);
      }
    });
  });

  describe('identity', () => {
    it('renames through the store, so the change is undoable', () => {
      const fixture = render(node());
      const input = el(fixture, '[aria-label="Component name"]') as HTMLInputElement;
      expect(input.value).toBe('Main content');

      input.value = 'Report body';
      input.dispatchEvent(new Event('change'));
      expect(store().root()?.children[0]?.name).toBe('Report body');
      expect(store().canUndo()).toBe(true);
    });

    it('offers to lock what is unlocked, and refuses to delete what is locked', () => {
      const fixture = render(node({ locked: true }));
      expect(el(fixture, '[aria-label="Unlock"]')).not.toBeNull();
      expect((el(fixture, '[aria-label="Delete (Del)"]') as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('layout and style', () => {
    const layout = (n: MadNode) => {
      const fixture = render(n);
      tab(fixture, 'Layout & style').click();
      fixture.detectChanges();
      return fixture;
    };
    const styleOf = () => store().root()?.children[0]?.style ?? {};

    it('applies padding to all four sides while the sides are linked', () => {
      const fixture = layout(node({ style: { padding: { top: 4, right: 4, bottom: 4, left: 4 } } }));
      const top = el(fixture, '[aria-label="Padding top"]') as HTMLInputElement;
      top.value = '24';
      top.dispatchEvent(new Event('input'));

      expect(styleOf().padding).toEqual({ top: 24, right: 24, bottom: 24, left: 24 });
    });

    it('applies padding to one side once they are unlinked', () => {
      const fixture = layout(node({ style: { padding: { top: 4, right: 4, bottom: 4, left: 4 } } }));
      (el(fixture, '[aria-label="Link all sides"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      const top = el(fixture, '[aria-label="Padding top"]') as HTMLInputElement;
      top.value = '24';
      top.dispatchEvent(new Event('input'));

      expect(styleOf().padding).toEqual({ top: 24, right: 4, bottom: 4, left: 4 });
    });

    it('reports switch state to assistive technology as it changes', () => {
      const fixture = layout(node());
      const border = el(fixture, '#style-border-n_child001') as HTMLButtonElement;
      expect(border.getAttribute('aria-checked')).toBe('false');

      border.click();
      sync(fixture);
      expect(styleOf().border).toBe(true);
      expect((el(fixture, '#style-border-n_child001') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    });

    it('clamps a typed number to the range the control advertises', () => {
      const fixture = layout(node());
      const gap = el(fixture, 'input[aria-label="Gap"]') as HTMLInputElement;
      gap.value = '500';
      gap.dispatchEvent(new Event('input'));
      expect(styleOf().gap).toBe(96);
    });
  });

  it('explains an empty Content tab instead of showing a blank panel', () => {
    const fixture = render(node({ type: 'stack' }));
    expect(el(fixture, '.group-section')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('no content properties');
  });
});
