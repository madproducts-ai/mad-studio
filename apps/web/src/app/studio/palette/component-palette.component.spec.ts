import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { RenderContext } from '../../core/render/render-context';
import { StudioStore } from '../state/studio.store';
import { ComponentPalette } from './component-palette.component';
import { fakeApiClient, studioProviders, type FakeApiClient } from '../../testing/studio-harness';

/**
 * The palette lists every preset for the current design system. That is far too
 * many controls to be tab stops, so it behaves like a grid: one way in, then the
 * arrows. The filter chips above it are a radio group for the same reason.
 */
describe('ComponentPalette', () => {
  let api: FakeApiClient;

  const render = () => {
    const fixture = TestBed.createComponent(ComponentPalette);
    fixture.detectChanges();
    return fixture;
  };
  const presets = (fixture: { nativeElement: HTMLElement }) => [...fixture.nativeElement.querySelectorAll('.preset')] as HTMLButtonElement[];
  const chips = (fixture: { nativeElement: HTMLElement }) => [...fixture.nativeElement.querySelectorAll('.cat')] as HTMLButtonElement[];
  const tabStops = (els: HTMLElement[]) => els.filter((e) => e.getAttribute('tabindex') === '0');
  const nameOf = (el: HTMLElement | null) => el?.querySelector('.preset-name')?.textContent?.trim() ?? el?.textContent?.trim() ?? '';
  const press = (target: HTMLElement, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const search = (fixture: { nativeElement: HTMLElement }, text: string) => {
    const input = fixture.nativeElement.querySelector('input[type=search]') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    api = fakeApiClient();
    TestBed.configureTestingModule({ providers: [...studioProviders(api), RenderContext, StudioStore] });
  });

  describe('the preset grid', () => {
    it('offers one way in, however many presets it is showing', () => {
      const fixture = render();
      expect(presets(fixture).length).toBeGreaterThan(10);
      expect(tabStops(presets(fixture))).toHaveLength(1);
      expect(tabStops(presets(fixture))[0]).toBe(presets(fixture)[0]);
    });

    it('walks left and right by one preset, carrying the tab stop', () => {
      const fixture = render();
      presets(fixture)[0]!.focus();
      press(presets(fixture)[0]!, 'ArrowRight');
      fixture.detectChanges();

      expect(document.activeElement).toBe(presets(fixture)[1]);
      expect(tabStops(presets(fixture))[0]).toBe(presets(fixture)[1]);

      press(presets(fixture)[1]!, 'ArrowLeft');
      fixture.detectChanges();
      expect(document.activeElement).toBe(presets(fixture)[0]);
    });

    it('walks up and down by a whole row, not by one preset', () => {
      const fixture = render();
      presets(fixture)[0]!.focus();
      press(presets(fixture)[0]!, 'ArrowDown');
      fixture.detectChanges();

      // Two columns, so a row down from the first item is the third.
      expect(document.activeElement).toBe(presets(fixture)[2]);

      press(presets(fixture)[2]!, 'ArrowUp');
      fixture.detectChanges();
      expect(document.activeElement).toBe(presets(fixture)[0]);
    });

    it('stops at the edges instead of wrapping to the other end', () => {
      const fixture = render();
      const first = presets(fixture)[0]!;
      first.focus();
      press(first, 'ArrowLeft');
      press(first, 'ArrowUp');
      fixture.detectChanges();
      expect(document.activeElement).toBe(first);
    });

    it('jumps to the first and last preset', () => {
      const fixture = render();
      presets(fixture)[0]!.focus();
      press(presets(fixture)[0]!, 'End');
      fixture.detectChanges();
      const all = presets(fixture);
      expect(document.activeElement).toBe(all[all.length - 1]);

      press(all[all.length - 1]!, 'Home');
      fixture.detectChanges();
      expect(document.activeElement).toBe(presets(fixture)[0]);
    });

    it('keeps the arrows it handles away from the studio-wide shortcuts', () => {
      const fixture = render();
      const first = presets(fixture)[0]!;
      first.focus();
      const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      first.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);

      // Enter must reach the button, or the preset can never be inserted by keyboard.
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      first.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBe(false);
    });

    it('hands the tab stop back to the first preset when a search hides the remembered one', () => {
      const fixture = render();
      presets(fixture)[0]!.focus();
      press(presets(fixture)[0]!, 'End');
      fixture.detectChanges();
      expect(tabStops(presets(fixture))[0]).toBe(presets(fixture)[presets(fixture).length - 1]);

      search(fixture, 'chart');
      fixture.detectChanges();

      const shown = presets(fixture);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.length).toBeLessThan(23);
      expect(tabStops(shown)).toHaveLength(1);
      expect(tabStops(shown)[0]).toBe(shown[0]);
    });

    it('says so rather than showing an empty grid when nothing matches', () => {
      const fixture = render();
      search(fixture, 'zzzznothing');
      fixture.detectChanges();
      expect(presets(fixture)).toHaveLength(0);
      expect(fixture.nativeElement.textContent).toContain('No presets match');
    });
  });

  describe('the category filter', () => {
    it('reports which filter is active, not just which one looks active', () => {
      const fixture = render();
      const [all, layout] = chips(fixture);
      expect(all?.getAttribute('aria-checked')).toBe('true');
      expect(layout?.getAttribute('aria-checked')).toBe('false');
      expect(fixture.nativeElement.querySelector('[role=radiogroup]')?.getAttribute('aria-label')).toBeTruthy();
    });

    it('puts its one tab stop on the active filter', () => {
      const fixture = render();
      expect(tabStops(chips(fixture))).toHaveLength(1);
      expect(tabStops(chips(fixture))[0]).toBe(chips(fixture)[0]);

      chips(fixture)[2]!.click();
      fixture.detectChanges();
      expect(tabStops(chips(fixture))[0]).toBe(chips(fixture)[2]);
    });

    it('both moves and chooses on an arrow, the way a radio group does', () => {
      const fixture = render();
      const before = presets(fixture).length;
      chips(fixture)[0]!.focus();
      press(chips(fixture)[0]!, 'ArrowRight');
      fixture.detectChanges();

      expect(document.activeElement).toBe(chips(fixture)[1]);
      expect(chips(fixture)[1]?.getAttribute('aria-checked')).toBe('true');
      expect(presets(fixture).length).toBeLessThan(before);
    });

    it('stops at the ends of the filter row', () => {
      const fixture = render();
      const first = chips(fixture)[0]!;
      first.focus();
      press(first, 'ArrowLeft');
      fixture.detectChanges();
      expect(document.activeElement).toBe(first);
      expect(nameOf(chips(fixture)[0]!)).toBe('All');
    });
  });
});
