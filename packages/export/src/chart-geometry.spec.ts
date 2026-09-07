import { describe, expect, it } from 'vitest';
import { CHART_H, CHART_W, chartBars, chartDonut, chartLayers, sparklinePoints } from './chart-geometry';

/** Geometry is shared by the studio canvas and the static export, so both draw the same chart. */
describe('chartBars', () => {
  it('draws one bar per series per period, so the legend and the drawing agree', () => {
    for (const series of [1, 2, 3, 4]) {
      const bars = chartBars('n_seed1234', 12, series);
      expect(bars.length % series, `${series} series`).toBe(0);
      const groups = bars.length / series;
      expect(groups, `${series} series`).toBeGreaterThanOrEqual(3);
      // Every series gets its own colour, matching the legend order.
      expect(new Set(bars.map((b) => b.color)).size, `${series} series`).toBe(series);
      // Bars stay inside the viewbox and never overlap or invert.
      for (const b of bars) {
        expect(b.w).toBeGreaterThan(0);
        expect(b.h).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.w).toBeLessThanOrEqual(CHART_W + 0.01);
        expect(b.y).toBeGreaterThanOrEqual(-0.01);
        expect(b.y + b.h).toBeLessThanOrEqual(CHART_H + 0.01);
      }
    }
  });

  it('keeps bars wide enough to read as more series are added', () => {
    expect(chartBars('n_seed1234', 12, 4).every((b) => b.w >= 4)).toBe(true);
  });

  it('does not collapse every bar onto the floor', () => {
    const heights = chartBars('n_seed1234', 12, 1).map((b) => Math.round(b.h));
    expect(new Set(heights).size).toBeGreaterThan(2);
    expect(Math.max(...heights)).toBeGreaterThan(CHART_H * 0.4);
  });

  it('is deterministic per node id', () => {
    expect(chartBars('n_abc12345', 8, 2)).toEqual(chartBars('n_abc12345', 8, 2));
    expect(chartBars('n_abc12345', 8, 2)).not.toEqual(chartBars('n_abc12346', 8, 2));
  });
});

describe('other chart geometry', () => {
  it('produces one layer per labelled series and a full donut', () => {
    expect(chartLayers('n_seed1234', ['A', 'B', 'C'], 12)).toHaveLength(3);
    const donut = chartDonut('n_seed1234', ['A', 'B', 'C']);
    expect(donut).toHaveLength(3);
    expect(donut.reduce((sum, s) => sum + s.pct, 0)).toBeGreaterThanOrEqual(99);
    expect(sparklinePoints('n_seed1234', 'up').split(' ')).toHaveLength(14);
  });
});
