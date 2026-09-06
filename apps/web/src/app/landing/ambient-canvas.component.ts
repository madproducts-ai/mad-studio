import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, viewChild } from '@angular/core';
import { prefersReducedMotion } from '../core/motion/motion';

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hue: 'line' | 'ember' | 'signal';
  phase: number;
}

/**
 * Ambient physics field: drifting "component" rectangles that link to their
 * neighbours, lean toward the pointer, and settle back. Canvas 2D, DPR-aware,
 * pauses when off-screen or the tab is hidden, and renders a single static
 * frame under prefers-reduced-motion.
 */
@Component({
  selector: 'mad-ambient-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'pointer-events-none absolute inset-0 overflow-hidden', 'aria-hidden': 'true' },
  template: `<canvas #canvas class="block size-full"></canvas>`,
})
export class AmbientCanvas {
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  private bodies: Body[] = [];
  private pointer = { x: -9999, y: -9999, active: false };
  private raf = 0;
  private running = false;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private last = 0;

  constructor() {
    afterNextRender(() => this.setup());
  }

  private setup(): void {
    const canvas = this.canvasRef().nativeElement;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const resize = () => {
      const rect = this.host.nativeElement.getBoundingClientRect();
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(this.width * this.dpr);
      canvas.height = Math.round(this.height * this.dpr);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.seed();
      if (prefersReducedMotion()) this.draw(ctx, 0);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(this.host.nativeElement);

    const onMove = (e: PointerEvent) => {
      const rect = this.host.nativeElement.getBoundingClientRect();
      this.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top, active: true };
    };
    const onLeave = () => (this.pointer.active = false);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave, { passive: true });

    const io = new IntersectionObserver(([entry]) => {
      const visible = (entry?.isIntersecting ?? false) && !document.hidden;
      this.toggle(visible, ctx);
    });
    io.observe(this.host.nativeElement);
    const onVisibility = () => this.toggle(!document.hidden, ctx);
    document.addEventListener('visibilitychange', onVisibility);

    this.destroyRef.onDestroy(() => {
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(this.raf);
    });
  }

  private toggle(on: boolean, ctx: CanvasRenderingContext2D): void {
    if (prefersReducedMotion()) return;
    if (on && !this.running) {
      this.running = true;
      this.last = performance.now();
      const loop = (t: number) => {
        if (!this.running) return;
        const dt = Math.min(0.05, (t - this.last) / 1000);
        this.last = t;
        this.step(dt);
        this.draw(ctx, t);
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    } else if (!on && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  private seed(): void {
    const count = Math.round(Math.min(46, Math.max(16, (this.width * this.height) / 42000)));
    const hues: Body['hue'][] = ['line', 'line', 'line', 'line', 'ember', 'signal'];
    this.bodies = Array.from({ length: count }, (_, i) => {
      const w = 22 + Math.random() * 64;
      return {
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 12,
        w,
        h: 8 + Math.random() * (w > 60 ? 30 : 16),
        hue: hues[i % hues.length] as Body['hue'],
        phase: Math.random() * Math.PI * 2,
      };
    });
  }

  private step(dt: number): void {
    const { x: px, y: py, active } = this.pointer;
    for (const b of this.bodies) {
      // Gentle drift with a slow sinusoidal breathing.
      b.phase += dt * 0.6;
      b.vx += Math.sin(b.phase) * 0.8 * dt;
      b.vy += Math.cos(b.phase * 0.9) * 0.8 * dt;

      if (active) {
        const dx = px - b.x;
        const dy = py - b.y;
        const d2 = dx * dx + dy * dy;
        const radius = 260;
        if (d2 < radius * radius) {
          const d = Math.sqrt(d2) || 1;
          const force = (1 - d / radius) * 38;
          b.vx += (dx / d) * force * dt;
          b.vy += (dy / d) * force * dt;
        }
      }

      // Soft repulsion between neighbours keeps the field from clumping.
      for (const o of this.bodies) {
        if (o === b) continue;
        const dx = b.x - o.x;
        const dy = b.y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 120 * 120 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = ((120 - d) / 120) * 9;
          b.vx += (dx / d) * push * dt;
          b.vy += (dy / d) * push * dt;
        }
      }

      // Damping and integration.
      b.vx *= 1 - 0.9 * dt;
      b.vy *= 1 - 0.9 * dt;
      b.x += b.vx * dt * 6;
      b.y += b.vy * dt * 6;

      // Wrap around edges so the field never empties.
      if (b.x < -b.w) b.x = this.width + b.w;
      if (b.x > this.width + b.w) b.x = -b.w;
      if (b.y < -b.h) b.y = this.height + b.h;
      if (b.y > this.height + b.h) b.y = -b.h;
    }
  }

  private draw(ctx: CanvasRenderingContext2D, t: number): void {
    ctx.clearRect(0, 0, this.width, this.height);
    const style = getComputedStyle(this.host.nativeElement);
    const line = style.getPropertyValue('--mad-line-strong').trim() || '#3a4257';
    const ember = style.getPropertyValue('--mad-ember').trim() || '#f5a524';
    const signal = style.getPropertyValue('--mad-signal').trim() || '#5fd3ff';
    const ink = style.getPropertyValue('--mad-ink').trim() || '#e7eaf0';

    // Links between near neighbours.
    ctx.lineWidth = 1;
    for (let i = 0; i < this.bodies.length; i += 1) {
      const a = this.bodies[i] as Body;
      for (let j = i + 1; j < this.bodies.length; j += 1) {
        const b = this.bodies[j] as Body;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d < 170) {
          ctx.globalAlpha = (1 - d / 170) * 0.35;
          ctx.strokeStyle = line;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    // Bodies.
    for (const b of this.bodies) {
      const pulse = 0.55 + 0.45 * Math.sin(t / 1400 + b.phase);
      const color = b.hue === 'ember' ? ember : b.hue === 'signal' ? signal : line;
      ctx.globalAlpha = b.hue === 'line' ? 0.38 : 0.22 + pulse * 0.28;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      this.roundRect(ctx, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, 4);
      ctx.stroke();
      if (b.hue !== 'line') {
        ctx.globalAlpha = 0.06 + pulse * 0.08;
        ctx.fillStyle = color;
        ctx.fill();
      }
      // A tiny "text line" inside larger blocks hints at UI.
      if (b.w > 56 && b.h > 20) {
        ctx.globalAlpha = 0.18;
        ctx.strokeStyle = ink;
        ctx.beginPath();
        ctx.moveTo(b.x - b.w / 2 + 8, b.y - b.h / 2 + 9);
        ctx.lineTo(b.x - b.w / 2 + 8 + b.w * 0.45, b.y - b.h / 2 + 9);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
