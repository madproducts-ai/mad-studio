import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Icon, ICONS } from './icon.component';

/**
 * Smoke test for the component harness itself, and for the icon contract the
 * rest of the studio relies on: icons are decorative by default, so every
 * meaningful control has to carry its own accessible name.
 */
describe('Icon', () => {
  const render = (name: keyof typeof ICONS, size?: number) => {
    const fixture = TestBed.createComponent(Icon);
    fixture.componentRef.setInput('name', name);
    if (size !== undefined) fixture.componentRef.setInput('size', size);
    fixture.detectChanges();
    return fixture;
  };

  it('draws the path registered for the name', () => {
    const fixture = render('rocket');
    const path = fixture.nativeElement.querySelector('path') as SVGPathElement;
    expect(path.getAttribute('d')).toBe(ICONS['rocket']);
  });

  it('is hidden from assistive technology, since controls carry their own name', () => {
    const fixture = render('rocket');
    expect(fixture.nativeElement.getAttribute('aria-hidden')).toBe('true');
  });

  it('sizes the box and the drawing together', () => {
    const fixture = render('rocket', 24);
    const host = fixture.nativeElement as HTMLElement;
    const svg = host.querySelector('svg') as SVGSVGElement;
    expect(host.style.width).toBe('24px');
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  });
});
