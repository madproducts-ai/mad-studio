import { animate, type AnimationOptions, type DOMKeyframesDefinition } from 'motion';

/**
 * Motion presets (Motion & Physics Engineer). Every interactive transition in
 * the app goes through one of these so timing feels like one instrument.
 */
export const SPRING = {
  /** Buttons, toggles, chips. */
  ui: { type: 'spring', stiffness: 420, damping: 34, mass: 1 } satisfies AnimationOptions,
  /** Panels, drawers, cards. */
  panel: { type: 'spring', stiffness: 260, damping: 30, mass: 1 } satisfies AnimationOptions,
  /** Magnetic cursor follow. */
  magnetic: { type: 'spring', stiffness: 180, damping: 18, mass: 0.6 } satisfies AnimationOptions,
  /** Snap back after release. */
  release: { type: 'spring', stiffness: 320, damping: 22, mass: 0.8 } satisfies AnimationOptions,
  /** Canvas node entrance. */
  enter: { type: 'spring', stiffness: 300, damping: 28, mass: 0.9 } satisfies AnimationOptions,
} as const;

export const EASE = {
  outExpo: [0.16, 1, 0.3, 1] as [number, number, number, number],
  inExpo: [0.7, 0, 0.84, 0] as [number, number, number, number],
};

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Animate with automatic reduced-motion fallback (collapses to a short opacity fade). */
export const motion = (el: Element, keyframes: DOMKeyframesDefinition, options: AnimationOptions = SPRING.ui) => {
  if (prefersReducedMotion()) {
    const reduced: DOMKeyframesDefinition = 'opacity' in keyframes ? { opacity: keyframes.opacity } : {};
    return animate(el, reduced, { duration: 0.12 });
  }
  return animate(el, keyframes, options);
};

export const staggerMs = (index: number, base = 40, cap = 480): number => Math.min(index * base, cap);
