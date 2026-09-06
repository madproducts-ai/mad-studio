import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';
import { animate } from 'motion';
import { SPRING, prefersReducedMotion } from './motion';

/** Subtle 3D tilt toward the cursor for cards. Max tilt in degrees via `madTilt`. */
@Directive({
  selector: '[madTilt]',
  host: { style: 'transform-style: preserve-3d; will-change: transform;' },
})
export class Tilt {
  readonly madTilt = input<number | ''>(5);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private controls: { stop(): void } | null = null;

  constructor() {
    afterNextRender(() => {
      if (prefersReducedMotion() || !window.matchMedia('(pointer: fine)').matches) return;
      const el = this.host.nativeElement;
      const max = typeof this.madTilt() === 'number' ? (this.madTilt() as number) : 5;
      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        this.controls?.stop();
        this.controls = animate(el, { rotateX: -py * max, rotateY: px * max, scale: 1.01 }, SPRING.magnetic);
      };
      const onLeave = () => {
        this.controls?.stop();
        this.controls = animate(el, { rotateX: 0, rotateY: 0, scale: 1 }, SPRING.release);
      };
      el.addEventListener('pointermove', onMove, { passive: true });
      el.addEventListener('pointerleave', onLeave, { passive: true });
      this.destroyRef.onDestroy(() => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerleave', onLeave);
        this.controls?.stop();
      });
    });
  }
}
