// Adapted from Ischys a776472aa72f902eabdcd5ae9e4adaff6897742a frontend/src/domain/chartRange.ts
// Copyright (c) 2026 Ischys. MIT; see public/licenses/ischys.txt.
// Extracted trend only; independent of React Native and formatting helpers.
const DAY = 86400000;
const MIN_POINTS_FOR_TREND = 4;
const MIN_SPAN_DAYS_FOR_TREND = 21;

/**
 * Least-squares slope over the points in range, in units per 30 days.
 *
 * Null when there isn't enough to say: fewer than four sessions, or sessions
 * squeezed into under three weeks, where a couple of good days reads as a
 * trend. The caller says "not enough sessions for a trend" rather than drawing
 * a confident line through noise.
 */
export function trendPerMonth(points: { t: number; value: number }[]): number | null {
  if (points.length < MIN_POINTS_FOR_TREND) return null;
  const times = points.map((p) => p.t);
  const span = Math.max(...times) - Math.min(...times);
  if (span < MIN_SPAN_DAYS_FOR_TREND * DAY) return null;

  // Work in days from the first point: raw epoch ms squared overflows the useful
  // precision of a double and the slope comes back as noise.
  const t0 = Math.min(...times);
  const xs = points.map((p) => (p.t - t0) / DAY);
  const ys = points.map((p) => p.value);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  return (num / den) * 30;
}


