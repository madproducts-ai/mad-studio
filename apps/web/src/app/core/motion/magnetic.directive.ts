import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';
import { animate } from 'motion';
import { SPRING, prefersReducedMotion } from './motion';

/**
 * Magnetic hover: the element leans toward the cursor while it is within
 * `radius` px and springs back on leave. Transform-only, pointer-driven, and
 * disabled for touch and reduced-motion users.
 */
@Directive({
  selector: '[madMagnetic]',
  host: { style: 'will-change: transform; display: inline-flex;' },
})
export class Magnetic {
  /** Strength 0–1: how far the element travels relative to cursor offset. */
  readonly madMagnetic = input<number | ''>(0.35);
  readonly magneticRadius = input<number>(90);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private controls: { stop(): void } | null = null;

  constructor() {
    afterNextRender(() => {
      if (prefersReducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
      const el = this.host.nativeElement;
      const onMove = (e: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy);
        const radius = this.magneticRadius() + Math.max(rect.width, rect.height) / 2;
        const strengthRaw = this.madMagnetic();
        const strength = typeof strengthRaw === 'number' ? strengthRaw : 0.35;
        if (dist > radius) {
          this.reset(el);
          return;
        }
        const falloff = 1 - dist / radius;
        this.controls?.stop();
        this.controls = animate(el, { x: dx * strength * falloff, y: dy * strength * falloff }, SPRING.magnetic);
      };
      const onLeave = () => this.reset(el);
      const parent = el.parentElement ?? el;
      parent.addEventListener('pointermove', onMove, { passive: true });
      parent.addEventListener('pointerleave', onLeave, { passive: true });
      this.destroyRef.onDestroy(() => {
        parent.removeEventListener('pointermove', onMove);
        parent.removeEventListener('pointerleave', onLeave);
        this.controls?.stop();
      });
    });
  }

  private reset(el: HTMLElement): void {
    this.controls?.stop();
    this.controls = animate(el, { x: 0, y: 0 }, SPRING.release);
  }
}
