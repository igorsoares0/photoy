import { useCallback, useEffect, useRef, useState } from 'react';
import { isMaskStale } from '@photoy/types';
import { renderedSize, selectedLayer, useEditor } from '../store/editor';
import { brushMaskSize, brushRadius, coverageFromRgba } from '../lib/brush';
import { placeDocument, toDocument } from '../lib/viewport';

/** The violet the style guide reserves for masks. */
const PAINT = 'rgba(167, 139, 250, 1)';

/**
 * Paints a raster mask onto the selected layer.
 *
 * The canvas it paints into is the mask: violet at full alpha where the brush
 * has been, nothing where it has not, so the same buffer is both what is shown
 * on screen and, read through its alpha channel, what is sent to the engine.
 * That is why the brush is hard - overlapping opaque strokes are idempotent,
 * where a soft one accumulates a darker seam everywhere a stroke crosses
 * itself.
 *
 * One stroke is one undo step: the mask goes to the engine when the hand comes
 * off, not on every pointer event.
 */
export function BrushOverlay({
  container,
}: {
  container: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element | null {
  const brush = useEditor((state) => state.brush);
  const layer = useEditor(selectedLayer);
  const viewport = useEditor((state) => state.viewport);
  const documentWidth = useEditor((state) => renderedSize(state)?.width ?? 0);
  const documentHeight = useEditor((state) => renderedSize(state)?.height ?? 0);
  const naturalWidth = useEditor((state) => state.history?.naturalWidth ?? 0);
  const naturalHeight = useEditor((state) => state.history?.naturalHeight ?? 0);
  const documentId = useEditor((state) => state.document?.id ?? null);
  const applyPaintedMask = useEditor((state) => state.applyPaintedMask);

  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const layerId = layer?.id ?? null;
  const mask = layer?.mask;
  const size = brushMaskSize(documentWidth, documentHeight);

  // The buffer is rebuilt whenever the layer or the document under it changes,
  // and seeded from the mask already on the layer so a brush can correct a
  // segmentation instead of starting from nothing.
  useEffect(() => {
    if (documentId === null || layerId === null || size.width === 0) {
      maskRef.current = null;
      return;
    }
    const canvas = window.document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    maskRef.current = canvas;

    let cancelled = false;
    const seed = async () => {
      if (mask === undefined || mask.kind !== 'raster' || mask.raster === 0) return;
      if (isMaskStale(mask, naturalWidth, naturalHeight)) return;
      const stored = await window.photoy.fetchMask(documentId, mask.raster);
      if (cancelled || !stored.ok || maskRef.current !== canvas) return;

      // The stored mask is coverage; painting it back means turning that into
      // the alpha of the violet the overlay draws.
      const source = window.document.createElement('canvas');
      source.width = stored.value.width;
      source.height = stored.value.height;
      const sourceContext = source.getContext('2d');
      if (sourceContext === null) return;
      const image = sourceContext.createImageData(stored.value.width, stored.value.height);
      for (let i = 0; i < stored.value.coverage.length; i += 1) {
        image.data[i * 4 + 0] = 167;
        image.data[i * 4 + 1] = 139;
        image.data[i * 4 + 2] = 250;
        image.data[i * 4 + 3] = stored.value.coverage[i] ?? 0;
      }
      sourceContext.putImageData(image, 0, 0);

      const context = canvas.getContext('2d');
      context?.drawImage(source, 0, 0, canvas.width, canvas.height);
      redraw();
    };
    void seed();
    return () => {
      cancelled = true;
    };
    // The mask object identity changes on every history adoption; keying on the
    // raster id is what stops the buffer being thrown away mid-stroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, layerId, size.width, size.height, mask?.raster]);

  const placement = (() => {
    const box = container.current?.getBoundingClientRect();
    if (box === undefined || documentWidth === 0) return null;
    return placeDocument(
      { width: box.width, height: box.height },
      { width: documentWidth, height: documentHeight },
      viewport.scale,
      viewport.offsetX,
      viewport.offsetY,
    );
  })();

  const redraw = useCallback(() => {
    const view = viewRef.current;
    const source = maskRef.current;
    const context = view?.getContext('2d');
    if (view === null || context === null || context === undefined || source === null) return;

    const dpr = window.devicePixelRatio || 1;
    const box = container.current?.getBoundingClientRect();
    if (box === undefined) return;
    const deviceWidth = Math.round(box.width * dpr);
    const deviceHeight = Math.round(box.height * dpr);
    if (view.width !== deviceWidth || view.height !== deviceHeight) {
      view.width = deviceWidth;
      view.height = deviceHeight;
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, box.width, box.height);

    const place = placement;
    if (place === null) return;
    context.globalAlpha = 0.55;
    context.imageSmoothingEnabled = true;
    context.drawImage(
      source,
      place.left,
      place.top,
      documentWidth * place.scale,
      documentHeight * place.scale,
    );
    context.globalAlpha = 1;
  }, [container, documentWidth, documentHeight, placement]);

  useEffect(() => {
    redraw();
  }, [redraw, viewport]);

  if (brush === null || placement === null || layerId === null) return null;
  const maskable = layer !== null && layer.kind !== 'background';

  const radius = brushRadius(brush.size, size.width, size.height);
  /** Mask pixels to screen pixels: the mask is capped, the document is not. */
  const toScreenScale = (documentWidth * placement.scale) / Math.max(1, size.width);

  const atMask = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = container.current?.getBoundingClientRect();
    if (box === undefined) return null;
    const point = toDocument(placement, event.clientX - box.left, event.clientY - box.top);
    return {
      x: (point.x / Math.max(1, documentWidth)) * size.width,
      y: (point.y / Math.max(1, documentHeight)) * size.height,
    };
  };

  const stamp = (from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const context = maskRef.current?.getContext('2d');
    if (context === undefined || context === null) return;
    // Erasing takes alpha away rather than painting a colour over it, which is
    // what keeps the buffer readable as coverage either way.
    context.globalCompositeOperation = brush.mode === 'erase' ? 'destination-out' : 'source-over';
    context.strokeStyle = PAINT;
    context.fillStyle = PAINT;
    context.lineWidth = radius * 2;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (from === null) {
      context.beginPath();
      context.arc(to.x, to.y, radius, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    context.globalCompositeOperation = 'source-over';
    redraw();
  };

  const commit = async () => {
    const canvas = maskRef.current;
    const context = canvas?.getContext('2d', { willReadFrequently: true });
    if (canvas === null || context === null || context === undefined) return;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    await applyPaintedMask(
      layerId,
      canvas.width,
      canvas.height,
      coverageFromRgba(image.data, canvas.width * canvas.height),
    );
  };

  return (
    <div
      className="absolute inset-0"
      style={{ cursor: maskable ? 'none' : 'not-allowed' }}
      onPointerDown={(event) => {
        if (!maskable || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = atMask(event);
        if (point === null) return;
        paintingRef.current = true;
        lastRef.current = point;
        stamp(null, point);
      }}
      onPointerMove={(event) => {
        const box = container.current?.getBoundingClientRect();
        if (box !== undefined) {
          setCursor({ x: event.clientX - box.left, y: event.clientY - box.top });
        }
        if (!paintingRef.current) return;
        const point = atMask(event);
        if (point === null) return;
        stamp(lastRef.current, point);
        lastRef.current = point;
      }}
      onPointerUp={(event) => {
        if (!paintingRef.current) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        paintingRef.current = false;
        lastRef.current = null;
        // One stroke, one undo step: the engine hears about it on release.
        void commit();
      }}
      onPointerLeave={() => setCursor(null)}
    >
      <canvas ref={viewRef} className="absolute inset-0 h-full w-full" />
      {cursor !== null && maskable ? (
        <div
          className="pointer-events-none absolute rounded-full"
          style={{
            left: cursor.x - radius * toScreenScale,
            top: cursor.y - radius * toScreenScale,
            width: radius * 2 * toScreenScale,
            height: radius * 2 * toScreenScale,
            border: `1px solid ${brush.mode === 'erase' ? 'var(--fg-primary)' : 'var(--accent-border)'}`,
            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.35)',
          }}
        />
      ) : null}
    </div>
  );
}
