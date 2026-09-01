/** Bins in the luminance histogram: one per level of the encoded output. */
export const HISTOGRAM_BINS = 256;

/**
 * What the engine can measure about a photograph.
 *
 * Measuring is arithmetic; deciding what a measurement is worth is taste. Only
 * the first half is in here, and only the first half is in the engine.
 */
export interface ImageAnalysis {
  documentId: string;
  /** How many pixels were counted, which turns the bins into fractions. */
  pixels: number;
  /** Distribution of luminance, 0 to 255. */
  histogram: number[];
  /** Mean of each channel, 0 to 1. Their spread is what a colour cast is. */
  channelMean: [number, number, number];
  /** Mean distance from grey, 0 to 1. */
  chromaMean: number;
  /** Mean difference between neighbouring pixels: a stand-in for fine detail. */
  detail: number;
}
