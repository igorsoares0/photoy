/**
 * Geometry for the mask brush.
 *
 * Kept apart from the overlay because it is arithmetic with edges - a stroke
 * that must not depend on how fast the pointer moved, a resolution that must
 * not depend on how large the photograph is - and arithmetic is far cheaper to
 * test than a pointer gesture.
 */

/**
 * Longest side a painted mask is stored at.
 *
 * A mask is one byte a pixel and travels to the engine whole on every stroke,
 * so painting at the full size of a 24 MP photograph would send 24 MB per
 * stroke to describe an edge that is soft anyway. The engine resamples the mask
 * to whatever it is rendering at, so the resolution the brush paints in only
 * has to be fine enough to hold the shape.
 */
export const MAX_BRUSH_SIDE = 2048;

/** The resolution a mask is painted and stored at for a document this size. */
export function brushMaskSize(
  documentWidth: number,
  documentHeight: number,
): { width: number; height: number } {
  const longest = Math.max(documentWidth, documentHeight);
  if (longest <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, MAX_BRUSH_SIDE / longest);
  return {
    width: Math.max(1, Math.round(documentWidth * scale)),
    height: Math.max(1, Math.round(documentHeight * scale)),
  };
}

/**
 * Brush radius in mask pixels.
 *
 * The size is a percentage of the shorter side, the unit every other mask in
 * this product uses, so a brush means the same thing on a phone snapshot and on
 * a medium-format scan.
 */
export function brushRadius(
  sizePercent: number,
  maskWidth: number,
  maskHeight: number,
): number {
  const unit = Math.min(maskWidth, maskHeight);
  return Math.max(0.5, (sizePercent / 100) * unit * 0.5);
}

/**
 * Points to stamp along a stroke segment.
 *
 * A pointer reports where it is, not where it went, so a fast drag arrives as a
 * handful of distant points. Stamping only those would leave a dotted line, so
 * the gap is filled at a spacing fine enough that consecutive stamps overlap.
 */
export function strokePoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  radius: number,
): Array<{ x: number; y: number }> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const spacing = Math.max(0.5, radius * 0.25);
  const steps = Math.min(2000, Math.ceil(distance / spacing));
  if (steps <= 1) return [to];

  const points: Array<{ x: number; y: number }> = [];
  for (let step = 1; step <= steps; step += 1) {
    points.push({ x: from.x + (dx * step) / steps, y: from.y + (dy * step) / steps });
  }
  return points;
}

/**
 * Pulls one channel out of an RGBA buffer as the coverage the engine wants.
 *
 * The brush paints white on black in the alpha channel, so alpha is the
 * coverage; taking it rather than the colour is what lets the same canvas be
 * both what is drawn on screen and what is sent.
 */
export function coverageFromRgba(rgba: Uint8ClampedArray, pixels: number): Uint8Array {
  const coverage = new Uint8Array(pixels);
  for (let i = 0; i < pixels; i += 1) coverage[i] = rgba[i * 4 + 3] ?? 0;
  return coverage;
}
