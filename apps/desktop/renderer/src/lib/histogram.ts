/**
 * The distribution of the picture on screen.
 *
 * Measured in the renderer, from the preview it already has, rather than asked
 * of the engine. That is not a departure from "the engine measures" - the
 * engine measured these pixels when it produced them, and this counts what is
 * being looked at. Asking for it would mean a job, a round trip and a second
 * copy of the frame, per frame of a drag, to count bytes already in hand.
 */

/** One bin per level of the 8-bit output, which is what is being shown. */
export const HISTOGRAM_BINS = 256;

export interface Histogram {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  /** Perceived brightness, which is the curve people read a histogram by. */
  luma: Uint32Array;
  /** How many pixels were counted, which turns the bins into fractions. */
  counted: number;
  /** The tallest bin of any channel, so the drawing has a scale. */
  peak: number;
  /** Fraction of pixels sitting at 0 and at 255, where detail is already lost. */
  clippedShadows: number;
  clippedHighlights: number;
}

/**
 * How much of the preview is looked at, on each axis.
 *
 * Every fourth pixel is a sixteenth of the work and, on any real photograph, an
 * indistinguishable histogram: the shape of a distribution does not change when
 * a hundred thousand samples become six thousand. This runs on every frame of a
 * slider drag, so the sixteenth matters.
 */
const STEP = 4;

/**
 * Rec.709 luma weights, applied to the encoded values rather than to light.
 *
 * Deliberately not the working space's own weights, and deliberately not linear:
 * a histogram is a statement about the picture as displayed, and the axis it is
 * read against is the one the screen shows.
 */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

const EMPTY = (): Histogram => ({
  red: new Uint32Array(HISTOGRAM_BINS),
  green: new Uint32Array(HISTOGRAM_BINS),
  blue: new Uint32Array(HISTOGRAM_BINS),
  luma: new Uint32Array(HISTOGRAM_BINS),
  counted: 0,
  peak: 0,
  clippedShadows: 0,
  clippedHighlights: 0,
});

/**
 * Counts an RGBA frame.
 *
 * `stride` is bytes per row, which is not always four times the width: the
 * engine pads rows, and reading them as if it did not would shear the picture
 * and skew the count with it.
 */
export function measure(
  pixels: Uint8Array,
  width: number,
  height: number,
  stride: number,
): Histogram {
  const result = EMPTY();
  if (width <= 0 || height <= 0 || pixels.length === 0) return result;

  const { red, green, blue, luma } = result;
  let counted = 0;
  let shadows = 0;
  let highlights = 0;

  for (let y = 0; y < height; y += STEP) {
    const row = y * stride;
    for (let x = 0; x < width; x += STEP) {
      const at = row + x * 4;
      // A transparent pixel is not part of the picture: after a background
      // removal the whole cut-out area would otherwise pile onto black.
      if ((pixels[at + 3] ?? 0) < 128) continue;

      // The `?? 0` on every read is the type checker's price for indexing, not
      // a real case: the loop stays inside the buffer and the values are bytes.
      const r = pixels[at] ?? 0;
      const g = pixels[at + 1] ?? 0;
      const b = pixels[at + 2] ?? 0;
      red[r] = (red[r] ?? 0) + 1;
      green[g] = (green[g] ?? 0) + 1;
      blue[b] = (blue[b] ?? 0) + 1;

      const level = Math.round(LUMA[0] * r + LUMA[1] * g + LUMA[2] * b);
      luma[level] = (luma[level] ?? 0) + 1;
      counted += 1;

      // Clipping is per channel, not per pixel: a blown red in a sunset is lost
      // detail even where the other two still have room.
      if (r === 0 && g === 0 && b === 0) shadows += 1;
      if (r === 255 || g === 255 || b === 255) highlights += 1;
    }
  }

  let peak = 0;
  for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
    if (red[bin]! > peak) peak = red[bin]!;
    if (green[bin]! > peak) peak = green[bin]!;
    if (blue[bin]! > peak) peak = blue[bin]!;
  }

  result.counted = counted;
  result.peak = peak;
  result.clippedShadows = counted === 0 ? 0 : shadows / counted;
  result.clippedHighlights = counted === 0 ? 0 : highlights / counted;
  return result;
}

/**
 * One channel as a path through the unit square, with y measured downwards.
 *
 * The height is the square root of the count, not the count: a photograph of a
 * wall puts nearly every pixel in three bins, and against a linear scale
 * everything else in the frame becomes a flat line. The square root is what
 * makes a histogram legible on real pictures, and it is what every editor that
 * draws one uses.
 */
export function channelPath(bins: Uint32Array, peak: number): string {
  if (peak <= 0) return '';
  const scale = 1 / Math.sqrt(peak);
  const parts: string[] = [`M 0 1`];
  for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
    const x = bin / (HISTOGRAM_BINS - 1);
    const y = 1 - Math.min(1, Math.sqrt(bins[bin] ?? 0) * scale);
    parts.push(`L ${x.toFixed(4)} ${y.toFixed(4)}`);
  }
  parts.push('L 1 1 Z');
  return parts.join(' ');
}
