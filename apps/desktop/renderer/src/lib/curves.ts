import type { Curve, CurvePoint } from '@photoy/types';

/**
 * The curve maths, mirrored from the engine.
 *
 * The engine owns the response - it is what renders the photograph - but the
 * panel has to draw the same shape, and drawing it by asking the engine for a
 * few hundred samples on every mouse move is not a trade anyone would make. So
 * the interpolation exists twice, and a test renders a neutral ramp through the
 * engine and checks it against this file rather than trusting the pair to stay
 * in step. `apps/native/src/edit/curve.cpp` is the other half.
 */

/** Ends included, and two of them are held back for the ends. */
export const MAX_CURVE_POINTS = 16;

/** Two points closer than this in x would be a step no interpolation can express. */
export const MIN_CURVE_SPACING = 1 / 255;

/** How far off the diagonal a point may sit and still count as being on it. */
const IDENTITY_TOLERANCE = 1e-3;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const finite = (point: CurvePoint): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

/**
 * Puts a curve into the form the engine will put it in anyway.
 *
 * Doing it here as well is not belt and braces: the panel draws what it holds,
 * so if the cleaning only happened on the way into the engine the curve on
 * screen would be a different shape from the curve in the photograph.
 */
export function sanitise(curve: Curve): Curve {
  const clamped = curve
    .filter(finite)
    .map((point) => ({ x: clamp01(point.x), y: clamp01(point.y) }))
    .sort((a, b) => a.x - b.x);

  const thinned: CurvePoint[] = [];
  for (const point of clamped) {
    const previous = thinned[thinned.length - 1];
    if (previous !== undefined && point.x - previous.x < MIN_CURVE_SPACING) continue;
    thinned.push(point);
    if (thinned.length === MAX_CURVE_POINTS - 2) break;
  }

  const first = thinned[0];
  const last = thinned[thinned.length - 1];
  if (first === undefined || last === undefined) return thinned;
  // Filled with the identity rather than with a copy of the nearest point: an
  // untouched end should stay untouched, not be flattened to whatever the first
  // point someone dragged happens to say.
  if (first.x > 0) thinned.unshift({ x: 0, y: 0 });
  if (last.x < 1) thinned.push({ x: 1, y: 1 });
  return thinned;
}

/** True when the curve returns every tone unchanged. */
export function isIdentity(curve: Curve): boolean {
  return curve.every((point) => !finite(point) || Math.abs(point.y - point.x) <= IDENTITY_TOLERANCE);
}

/**
 * Slopes at each control point, limited so the cubic cannot turn back on itself.
 *
 * Fritsch-Carlson. A plain cubic spline through the same points overshoots
 * between them, which on a photograph means a curve drawn to lift the shadows
 * also darkens something just above them - a reversal nobody asked for.
 */
function tangents(points: Curve): number[] {
  const secants: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 1) {
    const low = points[i];
    const high = points[i + 1];
    if (low === undefined || high === undefined) continue;
    secants.push((high.y - low.y) / (high.x - low.x));
  }

  const at = (list: number[], index: number): number => list[index] ?? 0;
  const slopes = points.map((_, i) => {
    if (i === 0) return at(secants, 0);
    if (i === points.length - 1) return at(secants, secants.length - 1);
    return 0.5 * (at(secants, i - 1) + at(secants, i));
  });

  for (let i = 0; i + 1 < points.length; i += 1) {
    const secant = at(secants, i);
    if (secant === 0) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const alpha = at(slopes, i) / secant;
    const beta = at(slopes, i + 1) / secant;
    const squared = alpha * alpha + beta * beta;
    if (squared > 9) {
      const scale = 3 / Math.sqrt(squared);
      slopes[i] = scale * alpha * secant;
      slopes[i + 1] = scale * beta * secant;
    }
  }
  return slopes;
}

/** A curve ready to be sampled, with its tangents worked out once. */
export interface CurveSpline {
  identity: boolean;
  at(x: number): number;
}

export function compile(curve: Curve): CurveSpline {
  const points = sanitise(curve);
  if (isIdentity(points) || points.length < 2) {
    return { identity: true, at: clamp01 };
  }
  const slopes = tangents(points);

  return {
    identity: false,
    at(x: number): number {
      const clamped = clamp01(x);
      let segment = 0;
      while (segment + 2 < points.length && clamped > (points[segment + 1]?.x ?? 1)) segment += 1;

      const low = points[segment];
      const high = points[segment + 1];
      if (low === undefined || high === undefined) return clamped;
      const span = high.x - low.x;
      const t = (clamped - low.x) / span;
      const t2 = t * t;
      const t3 = t2 * t;

      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;

      return clamp01(
        h00 * low.y +
          h10 * span * (slopes[segment] ?? 0) +
          h01 * high.y +
          h11 * span * (slopes[segment + 1] ?? 0),
      );
    },
  };
}

/** Samples the curve once, for a caller that has one tone to ask about. */
export function evaluate(curve: Curve, x: number): number {
  return compile(curve).at(x);
}

/**
 * Adds a point, or moves the one already at that tone.
 *
 * Dropping a point where one already sits is how a curve tool behaves: the
 * gesture reads as "put the curve here", not as "make a second point that the
 * spacing rule will throw away".
 */
export function addPoint(curve: Curve, point: CurvePoint): Curve {
  const clean = sanitise(curve);
  const x = clamp01(point.x);
  const existing = clean.findIndex((candidate) => Math.abs(candidate.x - x) < MIN_CURVE_SPACING);
  const placed = { x, y: clamp01(point.y) };
  if (existing >= 0) return clean.map((candidate, i) => (i === existing ? placed : candidate));
  if (clean.length >= MAX_CURVE_POINTS) return clean;
  return sanitise([...clean, placed]);
}

/**
 * Moves one point, without letting it through its neighbours.
 *
 * The clamp is what makes dragging feel solid: a point that could pass the one
 * next to it would reorder the curve underneath the hand holding it.
 */
export function movePoint(curve: Curve, index: number, point: CurvePoint): Curve {
  const clean = sanitise(curve);
  if (index < 0 || index >= clean.length) return clean;

  const lower = index === 0 ? 0 : (clean[index - 1]?.x ?? 0) + MIN_CURVE_SPACING;
  const upper = index === clean.length - 1 ? 1 : (clean[index + 1]?.x ?? 1) - MIN_CURVE_SPACING;
  // The ends stay on their own edge: they set the black and white points, which
  // is a vertical move, and letting them slide inwards would leave the curve
  // undefined outside them.
  const pinned = index === 0 ? 0 : index === clean.length - 1 ? 1 : clamp01(point.x);

  return clean.map((candidate, i) =>
    i === index
      ? { x: Math.min(Math.max(pinned, lower), Math.max(lower, upper)), y: clamp01(point.y) }
      : candidate,
  );
}

/** Removes a point. The two ends stay: without them there is no curve. */
export function removePoint(curve: Curve, index: number): Curve {
  const clean = sanitise(curve);
  if (index <= 0 || index >= clean.length - 1) return clean;
  const remaining = clean.filter((_, i) => i !== index);
  // Nothing but the ends left, and both on the diagonal, is no curve at all.
  return isIdentity(remaining) ? [] : remaining;
}

/**
 * The point nearest to a position, if one is within reach.
 *
 * Reach is measured in the square the curve is drawn in rather than in pixels,
 * so it does not change when the panel is resized.
 */
export function nearestPoint(curve: Curve, point: CurvePoint, reach: number): number {
  let best = -1;
  let closest = reach;
  sanitise(curve).forEach((candidate, index) => {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= closest) {
      closest = distance;
      best = index;
    }
  });
  return best;
}

/** The curve as `count` evenly spaced samples, for drawing it. */
export function sample(curve: Curve, count: number): number[] {
  const spline = compile(curve);
  return Array.from({ length: count }, (_, i) => spline.at(i / (count - 1)));
}
