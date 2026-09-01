import type { Adjustments, ImageAnalysis } from '@photoy/types';

/**
 * Turning a measurement into a proposal.
 *
 * Every rule below is a threshold and a proportion: a picture is called dark
 * because its median sits below a number, and the correction is sized by how
 * far below. That makes each one arguable, which is the point - they are
 * judgements, and a judgement that cannot be pointed at cannot be improved.
 *
 * Nothing here applies anything. The spec is explicit that the application must
 * never change a photograph silently, so this produces a list to be reviewed
 * and the panel applies only what is still ticked.
 */
export type SuggestionId = 'light' | 'shadows' | 'highlights' | 'contrast' | 'cast' | 'colour' | 'detail';

export interface Suggestion {
  id: SuggestionId;
  /** What ticking it would add to the adjustments already in effect. */
  delta: Partial<Adjustments>;
  /** The measurement that produced it, for the panel to show. */
  measure: number;
}

/** The luminance level below which a given fraction of the picture falls. */
export function percentile(histogram: readonly number[], pixels: number, fraction: number): number {
  if (pixels <= 0) return 0;
  const target = pixels * fraction;
  let seen = 0;
  for (let level = 0; level < histogram.length; level += 1) {
    seen += histogram[level] ?? 0;
    if (seen >= target) return level;
  }
  return histogram.length - 1;
}

/** The share of the picture between two levels, inclusive. */
export function share(
  histogram: readonly number[],
  pixels: number,
  from: number,
  to: number,
): number {
  if (pixels <= 0) return 0;
  let sum = 0;
  for (let level = from; level <= to && level < histogram.length; level += 1) {
    sum += histogram[level] ?? 0;
  }
  return sum / pixels;
}

const decode = (level: number): number => {
  const e = level / 255;
  return e <= 0.04045 ? e / 12.92 : ((e + 0.055) / 1.055) ** 2.4;
};

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/** Middle grey, which is where a correctly exposed midtone sits. */
const TARGET_MEDIAN = 0.18;

/**
 * How much denser than the midtones an end has to be before it is called heavy.
 *
 * Chosen against the two cases that have to come out differently: a picture
 * spread evenly over the whole range measures exactly 1.0 and wants nothing
 * done to it, while a fifth of a picture piled up near white measures about
 * 1.45 and plainly does.
 */
const END_HEAVY = 1.3;

export function proposeEnhancements(analysis: ImageAnalysis): Suggestion[] {
  const { histogram, pixels } = analysis;
  if (pixels <= 0 || histogram.length === 0) return [];

  const suggestions: Suggestion[] = [];

  // Exposure, computed in linear light because that is where it is a ratio.
  // A quarter of a stop is inside the noise of this measurement and is not
  // worth offering as a change.
  const median = decode(percentile(histogram, pixels, 0.5));
  const stops = median > 0 ? Math.log2(TARGET_MEDIAN / median) : 0;
  if (Math.abs(stops) > 0.25) {
    suggestions.push({
      id: 'light',
      delta: { exposure: Number(clamp(stops, -1.5, 1.5).toFixed(2)) },
      measure: stops,
    });
  }

  // Density rather than share, for both ends.
  //
  // A fixed fraction is the wrong test: a picture spread evenly across the
  // whole range has a sixth of itself in the darkest sixth, and there is
  // nothing wrong with it. What says a photograph is bottom-heavy is that the
  // dark end holds more per level than the middle does.
  const midDensity = share(histogram, pixels, 41, 214) / 174;

  // Dark detail that is present rather than crushed: lifting what is already
  // black would only turn the blacks grey.
  const dark = share(histogram, pixels, 1, 40);
  const crushed = share(histogram, pixels, 0, 0);
  if (dark > 0.1 && dark / 40 > midDensity * END_HEAVY && crushed < 0.1) {
    suggestions.push({
      id: 'shadows',
      delta: { shadows: Math.round(clamp(dark * 160, 15, 65)) },
      measure: dark,
    });
  }

  // Bright detail that is not yet blown. Once it is blown there is nothing in
  // it to bring back, and pulling it down only greys the whites.
  const bright = share(histogram, pixels, 225, 254);
  const blown = share(histogram, pixels, 255, 255);
  if (bright > 0.04 && bright / 30 > midDensity * END_HEAVY && blown < 0.05) {
    suggestions.push({
      id: 'highlights',
      delta: { highlights: -Math.round(clamp(bright * 320, 15, 60)) },
      measure: bright,
    });
  }

  // A picture that never reaches either end is flat, and the gap is how flat.
  const low = percentile(histogram, pixels, 0.005);
  const high = percentile(histogram, pixels, 0.995);
  const range = high - low;
  if (range < 205) {
    suggestions.push({
      id: 'contrast',
      delta: { contrast: Math.round(clamp((235 - range) * 0.45, 8, 45)) },
      measure: range / 255,
    });
  }

  // A colour cast is the channels disagreeing about the average. The threshold
  // is deliberately high: a warm evening is not a fault to be corrected, and
  // this cannot tell one from the other.
  const [red, green, blue] = analysis.channelMean;
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
  if (spread > 0.06) {
    const warmth = red - blue;
    suggestions.push({
      id: 'cast',
      delta: { temperature: -Math.round(clamp(warmth * 120, -35, 35)) },
      measure: warmth,
    });
  }

  // Vibrance rather than saturation, so what is already vivid is left alone.
  if (analysis.chromaMean < 0.14) {
    suggestions.push({
      id: 'colour',
      delta: { vibrance: Math.round(clamp((0.14 - analysis.chromaMean) * 320, 10, 40)) },
      measure: analysis.chromaMean,
    });
  }

  // Little difference between neighbouring pixels means little fine detail.
  // It cannot tell a soft photograph from a smooth subject, which is why this
  // is offered rather than done.
  if (analysis.detail < 0.02) {
    suggestions.push({
      id: 'detail',
      delta: { sharpen: Math.round(clamp((0.02 - analysis.detail) * 2400, 15, 50)) },
      measure: analysis.detail,
    });
  }

  return suggestions;
}

/** Folds the chosen proposals onto the adjustments already in effect. */
export function applySuggestions(
  current: Adjustments,
  suggestions: readonly Suggestion[],
  chosen: ReadonlySet<SuggestionId>,
): Adjustments {
  const result = { ...current };
  for (const suggestion of suggestions) {
    if (!chosen.has(suggestion.id)) continue;
    for (const [key, value] of Object.entries(suggestion.delta)) {
      const field = key as keyof Adjustments;
      // Added to what is there rather than replacing it: the proposal is an
      // improvement on the picture as it stands, not a verdict on it.
      result[field] = result[field] + (value ?? 0);
    }
  }
  return result;
}
