import type { Rect } from '@photoy/types';

export interface ViewportBox {
  width: number;
  height: number;
}

export interface Placement {
  /** Where the document's top-left corner sits, in viewport CSS pixels. */
  left: number;
  top: number;
  /** Displayed size divided by document size. */
  scale: number;
}

/**
 * Where the document sits inside the viewport.
 *
 * The canvas and the crop overlay have to agree on this to the pixel, so the
 * arithmetic lives here rather than being written twice.
 */
export function placeDocument(
  viewport: ViewportBox,
  document: { width: number; height: number },
  scale: number,
  offsetX: number,
  offsetY: number,
): Placement {
  const displayWidth = document.width * scale;
  const displayHeight = document.height * scale;
  return {
    left: Math.round((viewport.width - displayWidth) / 2 + offsetX),
    top: Math.round((viewport.height - displayHeight) / 2 + offsetY),
    scale,
  };
}

export function toScreen(placement: Placement, x: number, y: number): { x: number; y: number } {
  return { x: placement.left + x * placement.scale, y: placement.top + y * placement.scale };
}

export function toDocument(placement: Placement, x: number, y: number): { x: number; y: number } {
  return { x: (x - placement.left) / placement.scale, y: (y - placement.top) / placement.scale };
}

/** Keeps a rectangle inside the document, preserving its size where it can. */
export function clampRect(rect: Rect, bounds: { width: number; height: number }): Rect {
  const width = Math.min(Math.max(1, Math.round(rect.width)), bounds.width);
  const height = Math.min(Math.max(1, Math.round(rect.height)), bounds.height);
  return {
    width,
    height,
    x: Math.min(Math.max(0, Math.round(rect.x)), bounds.width - width),
    y: Math.min(Math.max(0, Math.round(rect.y)), bounds.height - height),
  };
}

/**
 * Reshapes a rectangle to an aspect ratio, keeping the anchor corner still.
 *
 * The result is the largest rectangle of that ratio that fits *inside* the one
 * given. Growing to the larger of the two candidates instead would immediately
 * be undone by the clamp to the document bounds, which is how a locked ratio
 * ends up silently not being honoured.
 */
export function applyAspect(rect: Rect, aspect: number, anchorX: number, anchorY: number): Rect {
  const height = rect.width / aspect;
  const chosen =
    height <= rect.height
      ? { width: rect.width, height }
      : { width: rect.height * aspect, height: rect.height };
  return {
    width: chosen.width,
    height: chosen.height,
    x: anchorX === rect.x ? rect.x : rect.x + rect.width - chosen.width,
    y: anchorY === rect.y ? rect.y : rect.y + rect.height - chosen.height,
  };
}
