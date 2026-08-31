import { useCallback, useEffect, useRef } from 'react';
import { renderedSize, useEditor } from '../store/editor';
import { previewTarget } from '../lib/preview';

/**
 * Above this zoom the canvas stops smoothing, so what is on screen is the
 * actual pixel grid rather than an interpolation of it.
 */
const NEAREST_NEIGHBOUR_ABOVE = 2;

const PREVIEW_DEBOUNCE_MS = 180;

export function Canvas(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const debounceRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const forceRef = useRef(false);

  const document = useEditor((state) => state.document);
  const documentWidth = useEditor((state) => renderedSize(state)?.width ?? 0);
  const documentHeight = useEditor((state) => renderedSize(state)?.height ?? 0);
  const fitRequest = useEditor((state) => state.fitRequest);
  const fitOnRequest = useEditor((state) => state.fitOnRequest);
  const preview = useEditor((state) => state.preview);
  const baseline = useEditor((state) => state.baseline);
  const comparing = useEditor((state) => state.comparing);
  const setComparing = useEditor((state) => state.setComparing);
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

    // While comparing, the before is drawn in place of the after. It is only
    // ever shown once it has arrived: showing an empty canvas for the fraction
    // of a second it takes would read as the picture flickering.
    const shown = comparing && baseline !== null ? baseline : preview;
    if (documentWidth === 0 || shown === null) return;

    const displayWidth = documentWidth * viewport.scale;
    const displayHeight = documentHeight * viewport.scale;
    const left = Math.round((width - displayWidth) / 2 + viewport.offsetX);
    const top = Math.round((height - displayHeight) / 2 + viewport.offsetY);

    // Nearest-neighbour exists to show the photograph's own pixel grid, so it
    // only applies when the preview actually carries those pixels one for one.
    // A draft - or any preview below document resolution - is an interpolation
    // already, and drawing it as hard blocks would show a grid that is not the
    // photograph's.
    const oneToOne = shown.width >= documentWidth;
    context.imageSmoothingEnabled = !(oneToOne && viewport.scale >= NEAREST_NEIGHBOUR_ABOVE);
    context.imageSmoothingQuality = 'high';
    context.drawImage(shown.bitmap, left, top, displayWidth, displayHeight);

    // The photo gets a 1px hairline, never a shadow or a fake paper frame.
    context.imageSmoothingEnabled = false;
    context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--border-hairline').trim();
    context.lineWidth = 1;
    context.strokeRect(left - 0.5, top - 0.5, displayWidth + 1, displayHeight + 1);
  }, [documentWidth, documentHeight, preview, baseline, comparing, viewport]);

  useEffect(() => {
    draw();
  }, [draw]);

  /**
   * Renders, and renders again if the picture moved while it was rendering.
   *
   * A drag produces a change per pointer event, far more often than a render
   * completes. Firing one each would queue work the engine only has to cancel;
   * absorbing the ones that arrive mid-render into a single catch-up afterwards
   * keeps the loop at whatever rate the machine can actually hold. Whether that
   * catch-up is forced is tracked apart from whether one is owed, so a zoom
   * nudge arriving mid-render is still considered rather than dropped.
   */
  const runPreview = useCallback(async (force: boolean) => {
    pendingRef.current = true;
    if (force) forceRef.current = true;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    try {
      while (pendingRef.current) {
        pendingRef.current = false;
        const forced = forceRef.current;
        forceRef.current = false;

        const state = useEditor.getState();
        if (state.document === null) break;
        const current = renderedSize(state);
        if (current === null) break;

        const target = previewTarget({
          documentWidth: current.width,
          documentHeight: current.height,
          scale: state.viewport.scale,
          devicePixelRatio: window.devicePixelRatio || 1,
          interacting: state.interacting,
          rendered: state.preview?.width ?? 0,
          forced,
        });
        if (target === null) continue;
        await state.requestPreview(target.width, target.height);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const schedulePreview = useCallback((force = false) => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    // Mid-gesture there is nothing to wait for: the debounce exists to stop a
    // wheel or a window resize queueing a render per event, and a drag already
    // has the in-flight guard for that. Leaving it in place is what made a
    // slider update only once the hand stopped moving.
    const delay = useEditor.getState().interacting ? 0 : PREVIEW_DEBOUNCE_MS;
    debounceRef.current = window.setTimeout(() => void runPreview(force), delay);
  }, [runPreview]);

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

  // Held rather than toggled, and released on blur as well: a key that is still
  // down when the window loses focus never reports coming back up.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key !== '\\' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      void setComparing(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.key === '\\') void setComparing(false);
    };
    const blur = () => void setComparing(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [setComparing]);

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
