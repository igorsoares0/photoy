import type { Preview } from '@photoy/types';

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
