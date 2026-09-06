import { hashSeed, rng, series } from './fake-data';

/**
 * Chart geometry shared by the studio canvas (Angular) and the static export.
 * Everything is derived from the node id, so the deployed page draws exactly
 * the chart the user saw on the canvas.
 */

export type ChartKind = 'line' | 'bar' | 'area' | 'donut';

export interface ChartLayer {
  path: string;
  area: string;
  color: string;
  last: number;
}

export interface ChartBar {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface DonutSegment {
  label: string;
  color: string;
  dash: string;
  offset: string;
  pct: number;
}

export const CHART_W = 320;
export const CHART_H = 120;
export const CHART_PALETTE = ['var(--r-accent)', 'var(--r-live)', 'var(--r-ink-3)', 'var(--r-success)'] as const;

export const chartLayers = (seed: string, labels: readonly string[], points: number): ChartLayer[] => {
  const r = rng(hashSeed(seed));
  const n = Math.max(2, points);
  return labels.slice(0, 4).map((_, i) => {
    const data = series(r, n, i === 0 ? 0.6 : 0.2 - i * 0.15);
    const step = CHART_W / (n - 1);
    const pts = data.map((v, j) => [j * step, CHART_H - v * (CHART_H - 8) - 2] as const);
    const path = pts.map(([x, y], j) => `${j === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const area = `${path} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z`;
    return { path, area, color: CHART_PALETTE[i % CHART_PALETTE.length] as string, last: data[n - 1] ?? 0 };
  });
};

export const chartBars = (seed: string, points: number): ChartBar[] => {
  const r = rng(hashSeed(seed));
  const n = Math.max(2, Math.min(points, 16));
  const values = series(r, n, -0.7);
  const gap = 6;
  const w = (CHART_W - gap * (n - 1)) / n;
  return values.map((v, i) => {
    const h = v * (CHART_H - 6);
    return { x: i * (w + gap), y: CHART_H - h, w, h, color: i === 0 ? 'var(--r-accent)' : 'var(--r-bar)' };
  });
};

export const chartDonut = (seed: string, labels: readonly string[]): DonutSegment[] => {
  const r = rng(hashSeed(seed));
  const used = labels.slice(0, 4);
  const raw = used.map(() => 0.2 + r());
  const total = raw.reduce((a, b) => a + b, 0);
  const circ = 2 * Math.PI * 46;
  let offset = 0;
  return used.map((label, i) => {
    const frac = (raw[i] ?? 0) / total;
    const len = frac * circ;
    const seg: DonutSegment = { label, color: CHART_PALETTE[i % CHART_PALETTE.length] as string, dash: `${len.toFixed(2)} ${(circ - len).toFixed(2)}`, offset: (-offset).toFixed(2), pct: Math.round(frac * 100) };
    offset += len;
    return seg;
  });
};

/** Sparkline points for a stat card, in a 72×22 box. */
export const sparklinePoints = (seed: string, trend: string): string => {
  const r = rng(hashSeed(seed));
  const data = series(r, 14, trend === 'up' ? 0.8 : trend === 'down' ? -0.8 : 0);
  const w = 72;
  const h = 22;
  return data.map((v, i) => `${((i / 13) * w).toFixed(1)},${(h - v * (h - 3) - 1).toFixed(1)}`).join(' ');
};
