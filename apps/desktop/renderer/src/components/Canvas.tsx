import { useCallback, useEffect, useRef } from 'react';
import { renderedSize, useEditor } from '../store/editor';

/**
 * Above this zoom the canvas stops smoothing, so what is on screen is the
 * actual pixel grid rather than an interpolation of it.
 */
const NEAREST_NEIGHBOUR_ABOVE = 2;

/**
 * Ceiling on preview resolution, in megapixels.
 *
 * One preview is rendered for the whole image, so zooming in past this budget
 * shows a slightly soft picture instead of allocating a buffer scaled to the
 * zoom. The ceiling is low because a working-space pixel is 8 bytes: at 24 MP
 * the engine is already holding the document and building a preview beside it.
 * The tiled pipeline in milestone 4 removes the trade-off.
 */
const PREVIEW_BUDGET_MP = 24;

const PREVIEW_DEBOUNCE_MS = 180;

export function Canvas(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const debounceRef = useRef<number | null>(null);

  const document = useEditor((state) => state.document);
  const documentWidth = useEditor((state) => renderedSize(state)?.width ?? 0);
  const documentHeight = useEditor((state) => renderedSize(state)?.height ?? 0);
  const fitRequest = useEditor((state) => state.fitRequest);
  const fitOnRequest = useEditor((state) => state.fitOnRequest);
  const preview = useEditor((state) => state.preview);
  const viewport = useEditor((state) => state.viewport);
  const fitToViewport = useEditor((state) => state.fitToViewport);
  const requestPreview = useEditor((state) => state.requestPreview);
  const zoomAt = useEditor((state) => state.zoomAt);
  const panBy = useEditor((state) => state.panBy);

  /** Redraws the whole canvas. Cheap enough to do on every viewport change. */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas === null || context === null || context === undefined) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = sizeRef.current;
    if (width === 0 || height === 0) return;

    const deviceWidth = Math.round(width * dpr);
    const deviceHeight = Math.round(height * dpr);
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = getComputedStyle(canvas).getPropertyValue('--surface-canvas-matte').trim();
    context.fillRect(0, 0, width, height);

    if (documentWidth === 0 || preview === null) return;

    const displayWidth = documentWidth * viewport.scale;
    const displayHeight = documentHeight * viewport.scale;
    const left = Math.round((width - displayWidth) / 2 + viewport.offsetX);
    const top = Math.round((height - displayHeight) / 2 + viewport.offsetY);

    context.imageSmoothingEnabled = viewport.scale < NEAREST_NEIGHBOUR_ABOVE;
    context.imageSmoothingQuality = 'high';
    context.drawImage(preview.bitmap, left, top, displayWidth, displayHeight);

    // The photo gets a 1px hairline, never a shadow or a fake paper frame.
    context.imageSmoothingEnabled = false;
    context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--border-hairline').trim();
    context.lineWidth = 1;
    context.strokeRect(left - 0.5, top - 0.5, displayWidth + 1, displayHeight + 1);
  }, [documentWidth, documentHeight, preview, viewport]);

  useEffect(() => {
    draw();
  }, [draw]);

  /** Asks the engine for a preview matching the resolution now on screen. */
  const schedulePreview = useCallback((force = false) => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const state = useEditor.getState();
      if (state.document === null) return;

      const current = renderedSize(state);
      if (current === null) return;

      const dpr = window.devicePixelRatio || 1;
      const budget = Math.sqrt(
        (PREVIEW_BUDGET_MP * 1_000_000 * current.width) / current.height,
      );
      const wanted = Math.min(
        current.width,
        Math.ceil(current.width * state.viewport.scale * dpr),
        Math.round(budget),
      );

      const rendered = state.preview?.width ?? 0;
      // Re-render only on a real change, so a nudge of the zoom does not queue
      // a render behind every wheel tick. An edit always forces one, because
      // the pixels changed even when the size did not.
      if (!force && rendered > 0 && Math.abs(wanted - rendered) / Math.max(rendered, 1) < 0.1) {
        return;
      }

      const ratio = current.height / current.width;
      void state.requestPreview(wanted, Math.ceil(wanted * ratio));
    }, PREVIEW_DEBOUNCE_MS);
  }, []);

  // Track the viewport box and refit whenever the window or the image changes.
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      const first = sizeRef.current.width === 0;
      sizeRef.current = { width, height };
      if (first && document !== null) fitToViewport(width, height);
      draw();
      schedulePreview();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [document, draw, fitToViewport, schedulePreview]);

  // A newly opened image always starts fitted.
  useEffect(() => {
    if (document === null) return;
    const { width, height } = sizeRef.current;
    if (width > 0 && height > 0) fitToViewport(width, height);
    schedulePreview(true);
  }, [document, fitToViewport, schedulePreview]);

  // Every stack change needs a new render. Only the ones that move the rendered
  // size need a refit as well - refitting on a slider would yank the zoom out
  // from under the user mid-gesture.
  useEffect(() => {
    if (document === null || fitRequest === 0) return;
    const { width, height } = sizeRef.current;
    if (fitOnRequest && width > 0 && height > 0) fitToViewport(width, height);
    schedulePreview(true);
    // fitOnRequest is read, not watched: it accompanies a fitRequest rather
    // than changing on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  useEffect(() => {
    schedulePreview();
  }, [viewport.scale, schedulePreview]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (document === null) return;
      const container = containerRef.current;
      if (container === null) return;

      const bounds = container.getBoundingClientRect();
      // Anchor in viewport-centre coordinates, matching how offsets are stored.
      const anchorX = event.clientX - bounds.left - bounds.width / 2;
      const anchorY = event.clientY - bounds.top - bounds.height / 2;
      const factor = Math.exp(-event.deltaY * 0.0015);
      zoomAt(factor, anchorX, anchorY);
    },
    [document, zoomAt],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (document === null || event.button !== 0) return;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      let lastX = event.clientX;
      let lastY = event.clientY;

      const onMove = (move: PointerEvent) => {
        panBy(move.clientX - lastX, move.clientY - lastY);
        lastX = move.clientX;
        lastY = move.clientY;
      };
      const onUp = () => {
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.style.cursor = '';
      };

      target.style.cursor = 'grabbing';
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
    },
    [document, panBy],
  );

  const onDoubleClick = useCallback(() => {
    const { width, height } = sizeRef.current;
    fitToViewport(width, height);
  }, [fitToViewport]);

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
      style={{ background: 'var(--surface-canvas-matte)', cursor: document ? 'grab' : 'default' }}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
