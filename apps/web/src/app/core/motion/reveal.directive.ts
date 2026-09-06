import { DestroyRef, Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

/**
 * Staggered entrance on scroll. Adds `.reveal` immediately and `.is-in` when
 * the element enters the viewport; the CSS in styles.css owns the curve.
 * `madReveal` is the stagger index (delay = index × 60ms).
 */
@Directive({
  selector: '[madReveal]',
  host: { class: 'reveal', '[style.--reveal-delay]': 'delay()' },
})
export class Reveal {
  readonly madReveal = input<number | ''>(0);
  readonly revealOnce = input<boolean>(true);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  protected delay(): string {
    const i = this.madReveal();
    return `${(typeof i === 'number' ? i : 0) * 60}ms`;
  }

  constructor() {
    afterNextRender(() => {
      const el = this.host.nativeElement;
      if (!('IntersectionObserver' in window)) {
        el.classList.add('is-in');
        return;
      }
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              el.classList.add('is-in');
              if (this.revealOnce()) io.unobserve(el);
            } else if (!this.revealOnce()) {
              el.classList.remove('is-in');
            }
          }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
      );
      io.observe(el);
      this.destroyRef.onDestroy(() => io.disconnect());
    });
  }
}
