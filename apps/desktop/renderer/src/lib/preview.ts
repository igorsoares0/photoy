import type { Preview } from '@photoy/types';

/**
 * Ceiling on preview resolution, in megapixels.
 *
 * One preview is rendered for the whole image, so zooming past this budget
 * shows a slightly soft picture instead of allocating a buffer scaled to the
 * zoom. The ceiling is low because a working-space pixel is eight bytes: at
 * 24 MP the engine is already holding the document and building a preview
 * beside it. The tiled pipeline in milestone 4 removes the trade-off.
 */
export const PREVIEW_BUDGET_MP = 24;

/**
 * Linear scale of the preview rendered while a slider is being dragged.
 *
 * Half the width and half the height is a quarter of the pixels, and roughly a
 * quarter of both costs that matter: the composite, and the trip back down the
 * pipe. Measured on a 2600 x 1800 photograph, one frame of a drag went from
 * 94 ms at 1800 px to 22 ms at 900 px. The picture is softer for as long as the
 * hand is on the control, and the frame that ends the gesture is full size.
 */
export const DRAFT_SCALE = 0.5;

/** Everything the size decision depends on. */
export interface PreviewRequest {
  /** Size the edit stack currently produces. */
  documentWidth: number;
  documentHeight: number;
  /** Document pixels to CSS pixels. */
  scale: number;
  devicePixelRatio: number;
  /** True between the first frame of a drag and its release. */
  interacting: boolean;
  /** Width of the preview already on screen, or 0 when there is none. */
  rendered: number;
  /** True when the pixels changed, as opposed to only the zoom. */
  forced: boolean;
}

/**
 * How large the next preview should be, or null to keep the one on screen.
 *
 * Split out from the canvas because it is the whole policy in one place and the
 * only part of the render loop with a decision in it: a zoom nudge that would
 * land within a tenth of what is already rendered is not worth a round trip,
 * while an edit always is, because the pixels moved even if the size did not.
 */
export function previewTarget(request: PreviewRequest): { width: number; height: number } | null {
  const { documentWidth, documentHeight } = request;
  if (documentWidth <= 0 || documentHeight <= 0) return null;

  const budget = Math.sqrt((PREVIEW_BUDGET_MP * 1_000_000 * documentWidth) / documentHeight);
  const full = Math.min(
    documentWidth,
    Math.ceil(documentWidth * request.scale * request.devicePixelRatio),
    // Floored, not rounded: a ceiling you can round your way over is not one.
    Math.floor(budget),
  );
  const width = request.interacting ? Math.max(1, Math.round(full * DRAFT_SCALE)) : full;

  if (!request.forced && request.rendered > 0 &&
      Math.abs(width - request.rendered) / request.rendered < 0.1) {
    return null;
  }
  return { width, height: Math.ceil((width * documentHeight) / documentWidth) };
}

/**
 * Turns an engine preview into a bitmap the canvas can blit.
 *
 * createImageBitmap decodes off the main thread, so a large preview does not
 * stall input the way putImageData would.
 */
export async function toBitmap(preview: Preview): Promise<ImageBitmap> {
  const expected = preview.width * 4;
  let pixels = new Uint8ClampedArray(preview.pixels);

  if (preview.stride !== expected) {
    // The engine packs rows tightly today, but a padded stride is legal on the
    // wire, and silently misreading it would shear the image.
    const packed = new Uint8ClampedArray(expected * preview.height);
    for (let y = 0; y < preview.height; y += 1) {
      packed.set(pixels.subarray(y * preview.stride, y * preview.stride + expected), y * expected);
    }
    pixels = packed;
  }

  return createImageBitmap(new ImageData(pixels, preview.width, preview.height));
}
