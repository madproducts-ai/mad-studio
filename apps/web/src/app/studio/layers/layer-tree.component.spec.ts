import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MadDocument, MadNode } from '@mad/schema';
import { DRAG_MIME, RenderContext } from '../../core/render/render-context';
import { StudioStore } from '../state/studio.store';
import { LayerTree } from './layer-tree.component';
import { fakeApiClient, studioProviders, type FakeApiClient } from '../../testing/studio-harness';

const node = (id: string, name: string, over: Partial<MadNode> = {}): MadNode => ({ id, type: 'stack', name, props: {}, style: {}, children: [], source: 'ai', locked: false, ...over });

/** Page > Main content > [Header, Sidebar]. Enough depth to test nesting and reparenting. */
const aDocument = (): MadDocument => ({
  version: 1,
  designSystem: 'tailwind',
  theme: 'dark',
  root: node('n_root0001', 'Page', {
    type: 'page',
    children: [node('n_main0001', 'Main content', { children: [node('n_head0001', 'Header'), node('n_side0001', 'Sidebar')] })],
  }),
  integrations: [],
  tables: [],
  updatedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
});

/**
 * The layers panel is the studio's structural view: it has to mirror the tree
 * the canvas shows, report depth and selection to assistive technology, and
 * move a component to a new parent when one is dropped onto it.
 */
describe('LayerTree', () => {
  let api: FakeApiClient;

  const store = () => TestBed.inject(StudioStore);
  const render = (withDocument = true) => {
    if (withDocument) store().document.set(aDocument());
    const fixture = TestBed.createComponent(LayerTree);
    fixture.detectChanges();
    return fixture;
  };
  const rows = (fixture: { nativeElement: HTMLElement }) => [...fixture.nativeElement.querySelectorAll('[role=treeitem]')] as HTMLElement[];
  const row = (fixture: { nativeElement: HTMLElement }, name: string) => rows(fixture).find((r) => r.textContent?.includes(name))!;
  const buttonIn = (parent: HTMLElement, label: string) => parent.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
  const names = (fixture: { nativeElement: HTMLElement }) => rows(fixture).map((r) => r.textContent?.trim());
  const tabStops = (fixture: { nativeElement: HTMLElement }) => rows(fixture).map((r) => r.getAttribute('tabindex'));
  const press = (target: HTMLElement, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  /** jsdom implements neither DataTransfer nor layout, so both are supplied here. */
  const dragEventOnto = (target: HTMLElement, type: 'dragover' | 'drop', payload: string, fraction: number) => {
    target.getBoundingClientRect = () => ({ top: 100, bottom: 128, height: 28, left: 0, right: 200, width: 200, x: 0, y: 100, toJSON: () => ({}) });
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown; clientY: number };
    event.dataTransfer = { types: [DRAG_MIME], getData: (mime: string) => (mime === DRAG_MIME ? payload : '') };
    event.clientY = 100 + 28 * fraction;
    target.dispatchEvent(event);
  };

  beforeEach(() => {
    api = fakeApiClient();
    TestBed.configureTestingModule({ providers: [...studioProviders(api), RenderContext, StudioStore] });
  });

  describe('structure', () => {
    it('shows one row per node and reports its depth', () => {
      const fixture = render();
      expect(rows(fixture).map((r) => r.textContent?.trim())).toEqual(['Page', 'Main content', 'Header', 'Sidebar']);
      expect(rows(fixture).map((r) => r.getAttribute('aria-level'))).toEqual(['1', '2', '3', '3']);
      expect(fixture.nativeElement.textContent).toContain('4 nodes');
    });

    it('says the canvas is empty rather than showing an empty list', () => {
      const fixture = render(false);
      expect(rows(fixture)).toHaveLength(0);
      expect(fixture.nativeElement.textContent).toContain('Nothing on the canvas yet');
    });

    it('marks only the branches that can be collapsed as expandable', () => {
      const fixture = render();
      expect(row(fixture, 'Main content').getAttribute('aria-expanded')).toBe('true');
      expect(row(fixture, 'Header').hasAttribute('aria-expanded')).toBe(false);
    });

    it('hides descendants when a branch is collapsed', () => {
      const fixture = render();
      buttonIn(row(fixture, 'Main content'), 'Collapse').click();
      fixture.detectChanges();

      expect(rows(fixture).map((r) => r.textContent?.trim())).toEqual(['Page', 'Main content']);
      expect(row(fixture, 'Main content').getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('selection', () => {
    it('selects through the store, so the canvas and inspector follow', () => {
      const fixture = render();
      row(fixture, 'Header').click();
      fixture.detectChanges();

      expect(store().selectedId()).toBe('n_head0001');
      expect(row(fixture, 'Header').getAttribute('aria-selected')).toBe('true');
      expect(row(fixture, 'Sidebar').getAttribute('aria-selected')).toBe('false');
    });

    it('selects from the keyboard as well as the mouse', () => {
      const fixture = render();
      row(fixture, 'Sidebar').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(store().selectedId()).toBe('n_side0001');
    });
  });

  /**
   * A generated app is hundreds of nodes deep, so the panel has to behave like a
   * tree and not like hundreds of tab stops: one way in, then the arrows.
   */
  describe('keyboard navigation', () => {
    it('offers one way into the tree, and moves it to whatever is selected', () => {
      const fixture = render();
      expect(tabStops(fixture)).toEqual(['0', '-1', '-1', '-1']);

      row(fixture, 'Header').click();
      fixture.detectChanges();

      expect(tabStops(fixture)).toEqual(['-1', '-1', '0', '-1']);
    });

    it('falls back to the first row when the selection is collapsed out of sight', () => {
      const fixture = render();
      row(fixture, 'Header').click();
      buttonIn(row(fixture, 'Main content'), 'Collapse').click();
      fixture.detectChanges();

      expect(tabStops(fixture)).toEqual(['0', '-1']);
    });

    it('walks down and back up the visible rows, carrying focus with the selection', () => {
      const fixture = render();
      row(fixture, 'Page').focus();

      press(row(fixture, 'Page'), 'ArrowDown');
      fixture.detectChanges();

      expect(document.activeElement).toBe(row(fixture, 'Main content'));
      expect(store().selectedId()).toBe('n_main0001');
      expect(tabStops(fixture)).toEqual(['-1', '0', '-1', '-1']);

      press(row(fixture, 'Main content'), 'ArrowUp');
      fixture.detectChanges();

      expect(document.activeElement).toBe(row(fixture, 'Page'));
      expect(store().selectedId()).toBe('n_root0001');
    });

    it('stops at the ends of the list instead of wrapping', () => {
      const fixture = render();
      row(fixture, 'Page').focus();

      press(row(fixture, 'Page'), 'ArrowUp');
      press(row(fixture, 'Sidebar'), 'ArrowDown');
      fixture.detectChanges();

      expect(document.activeElement).toBe(row(fixture, 'Page'));
      expect(store().selectedId()).toBeNull();
    });

    it('jumps to the first and last visible row', () => {
      const fixture = render();
      row(fixture, 'Main content').focus();

      press(row(fixture, 'Main content'), 'End');
      fixture.detectChanges();

      expect(document.activeElement).toBe(row(fixture, 'Sidebar'));

      press(row(fixture, 'Sidebar'), 'Home');
      fixture.detectChanges();

      expect(document.activeElement).toBe(row(fixture, 'Page'));
      expect(store().selectedId()).toBe('n_root0001');
    });

    it('opens a closed branch with ArrowRight, then steps into it', () => {
      const fixture = render();
      buttonIn(row(fixture, 'Main content'), 'Collapse').click();
      fixture.detectChanges();
      row(fixture, 'Main content').focus();

      press(row(fixture, 'Main content'), 'ArrowRight');
      fixture.detectChanges();

      expect(names(fixture)).toEqual(['Page', 'Main content', 'Header', 'Sidebar']);
      expect(document.activeElement).toBe(row(fixture, 'Main content'));

      press(row(fixture, 'Main content'), 'ArrowRight');
      fixture.detectChanges();

      expect(document.activeElement).toBe(row(fixture, 'Header'));
      expect(store().selectedId()).toBe('n_head0001');
    });

    it('closes an open branch with ArrowLeft, then steps out to the parent', () => {
      const fixture = render();
      row(fixture, 'Main content').focus();

      press(row(fixture, 'Main content'), 'ArrowLeft');
      fixture.detectChanges();

      expect(names(fixture)).toEqual(['Page', 'Main content']);
      expect(row(fixture, 'Main content').getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(row(fixture, 'Main content'));

      press(row(fixture, 'Main content'), 'ArrowLeft');
      fixture.detectChanges();

      expect(document.activeElement).toBe(row(fixture, 'Page'));
      expect(store().selectedId()).toBe('n_root0001');
    });

    it('steps out of a leaf to its parent, since a leaf has nothing to close', () => {
      const fixture = render();
      row(fixture, 'Header').focus();

      press(row(fixture, 'Header'), 'ArrowLeft');
      fixture.detectChanges();

      expect(names(fixture)).toEqual(['Page', 'Main content', 'Header', 'Sidebar']);
      expect(document.activeElement).toBe(row(fixture, 'Main content'));
    });

    it('keeps the arrows it handles away from the studio-wide shortcuts', () => {
      const fixture = render();
      const escaped: string[] = [];
      const listener = (event: Event) => escaped.push((event as KeyboardEvent).key);
      window.addEventListener('keydown', listener);
      try {
        row(fixture, 'Page').focus();
        press(row(fixture, 'Page'), 'ArrowDown');
        press(row(fixture, 'Main content'), 'x');
      } finally {
        window.removeEventListener('keydown', listener);
      }

      expect(escaped).toEqual(['x']);
    });
  });

  it('toggles visibility without changing what is selected', () => {
    const fixture = render();
    store().select('n_head0001');
    fixture.detectChanges();

    buttonIn(row(fixture, 'Sidebar'), 'Hide').click();
    fixture.detectChanges();

    const sidebar = store().root()?.children[0]?.children[1];
    expect(sidebar?.style.hidden).toBe(true);
    expect(store().selectedId()).toBe('n_head0001');
    expect(buttonIn(row(fixture, 'Sidebar'), 'Show')).not.toBeNull();
  });

  describe('reparenting by drag', () => {
    const payload = JSON.stringify({ kind: 'node', id: 'n_head0001' });

    it('moves a component into a container dropped on its middle', () => {
      const fixture = render();
      const target = row(fixture, 'Sidebar');
      dragEventOnto(target, 'dragover', payload, 0.5);
      dragEventOnto(target, 'drop', payload, 0.5);
      fixture.detectChanges();

      const main = store().root()?.children[0];
      expect(main?.children.map((c) => c.name)).toEqual(['Sidebar']);
      expect(main?.children[0]?.children.map((c) => c.name)).toEqual(['Header']);
      expect(store().canUndo()).toBe(true);
    });

    it('reorders alongside a component dropped on its edge', () => {
      const fixture = render();
      const target = row(fixture, 'Sidebar');
      dragEventOnto(target, 'dragover', payload, 0.95);
      dragEventOnto(target, 'drop', payload, 0.95);
      fixture.detectChanges();

      expect(store().root()?.children[0]?.children.map((c) => c.name)).toEqual(['Sidebar', 'Header']);
    });

    it('ignores a drop that was never dragged over a target', () => {
      const fixture = render();
      dragEventOnto(row(fixture, 'Sidebar'), 'drop', payload, 0.5);
      expect(store().root()?.children[0]?.children.map((c) => c.name)).toEqual(['Header', 'Sidebar']);
    });
  });
});
