import { useCallback, useRef } from 'react';
import type { Rect } from '@photoy/types';
import { renderedSize, useEditor } from '../store/editor';
import { applyAspect, clampRect, placeDocument, toDocument } from '../lib/viewport';

/** Smallest crop the tool will let you make, in document pixels. */
const MIN_SIZE = 16;

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: Array<{ id: HandleId; x: number; y: number; cursor: string }> = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

const MOVES: Record<HandleId, { left: boolean; right: boolean; top: boolean; bottom: boolean }> = {
  nw: { left: true, right: false, top: true, bottom: false },
  n: { left: false, right: false, top: true, bottom: false },
  ne: { left: false, right: true, top: true, bottom: false },
  e: { left: false, right: true, top: false, bottom: false },
  se: { left: false, right: true, top: false, bottom: true },
  s: { left: false, right: false, top: false, bottom: true },
  sw: { left: true, right: false, top: false, bottom: true },
  w: { left: true, right: false, top: false, bottom: false },
};

/**
 * The crop frame drawn over the canvas.
 *
 * Built from DOM rather than painted into the canvas: hit-testing eight handles
 * is something the browser already does well, and the frame is chrome, not
 * photograph.
 */
export function CropOverlay({
  container,
}: {
  container: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element | null {
  const cropRect = useEditor((state) => state.cropRect);
  const cropAspect = useEditor((state) => state.cropAspect);
  const setCropRect = useEditor((state) => state.setCropRect);
  const panBy = useEditor((state) => state.panBy);
  const viewport = useEditor((state) => state.viewport);
  const documentWidth = useEditor((state) => renderedSize(state)?.width ?? 0);
  const documentHeight = useEditor((state) => renderedSize(state)?.height ?? 0);

  const gesture = useRef<{ startRect: Rect; startX: number; startY: number } | null>(null);

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

  /** Pointer position in document coordinates. */
  const pointerAt = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const box = container.current?.getBoundingClientRect();
      if (box === undefined || placement === null) return null;
      return toDocument(placement, event.clientX - box.left, event.clientY - box.top);
    },
    [container, placement],
  );

  const startGesture = useCallback(
    (
      event: React.PointerEvent,
      update: (start: Rect, dx: number, dy: number, point: { x: number; y: number }) => Rect,
    ) => {
      if (cropRect === null) return;
      event.stopPropagation();
      const target = event.currentTarget as HTMLElement;
      target.setPointerCapture(event.pointerId);
      gesture.current = { startRect: cropRect, startX: event.clientX, startY: event.clientY };

      const onMove = (move: PointerEvent) => {
        const state = gesture.current;
        const point = pointerAt(move);
        if (state === null || point === null || placement === null) return;
        const next = update(
          state.startRect,
          (move.clientX - state.startX) / placement.scale,
          (move.clientY - state.startY) / placement.scale,
          point,
        );
        setCropRect(clampRect(next, { width: documentWidth, height: documentHeight }));
      };
      const onUp = () => {
        gesture.current = null;
        target.releasePointerCapture(event.pointerId);
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
      };
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
    },
    [cropRect, documentHeight, documentWidth, placement, pointerAt, setCropRect],
  );

  if (cropRect === null || placement === null) return null;

  const frame = {
    left: placement.left + cropRect.x * placement.scale,
    top: placement.top + cropRect.y * placement.scale,
    width: cropRect.width * placement.scale,
    height: cropRect.height * placement.scale,
  };

  const resize = (id: HandleId) => (event: React.PointerEvent) =>
    startGesture(event, (start, _dx, _dy, point) => {
      const moves = MOVES[id];
      let left = start.x;
      let top = start.y;
      let right = start.x + start.width;
      let bottom = start.y + start.height;

      if (moves.left) left = Math.min(point.x, right - MIN_SIZE);
      if (moves.right) right = Math.max(point.x, left + MIN_SIZE);
      if (moves.top) top = Math.min(point.y, bottom - MIN_SIZE);
      if (moves.bottom) bottom = Math.max(point.y, top + MIN_SIZE);

      const next: Rect = { x: left, y: top, width: right - left, height: bottom - top };
      if (cropAspect === null) return next;
      // The corner opposite the one being dragged stays where it is.
      return applyAspect(next, cropAspect, moves.left ? -1 : next.x, moves.top ? -1 : next.y);
    });

  return (
    <div
      className="absolute inset-0 z-10"
      // A drag on the matte pans, so the picture can still be moved under the
      // frame while the crop is being composed.
      onPointerDown={(event) => {
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
        };
        target.addEventListener('pointermove', onMove);
        target.addEventListener('pointerup', onUp);
      }}
    >
      <div
        className="absolute"
        style={{
          left: frame.left,
          top: frame.top,
          width: frame.width,
          height: frame.height,
          cursor: 'move',
          // One element draws the whole scrim: everything outside the frame is
          // this box-shadow, which is the same idiom the mask surfaces use.
          boxShadow: '0 0 0 9999px rgba(10, 10, 11, 0.55)',
          outline: '1px solid rgba(237, 237, 239, 0.9)',
        }}
        onPointerDown={(event) =>
          startGesture(event, (start, dx, dy) => ({ ...start, x: start.x + dx, y: start.y + dy }))
        }
      >
        {/* Thirds, drawn faintly: a guide for the eye, not a thing to look at. */}
        {[1, 2].map((n) => (
          <span
            key={`v${n}`}
            className="pointer-events-none absolute top-0 bottom-0"
            style={{ left: `${(n * 100) / 3}%`, width: 1, background: 'rgba(237,237,239,0.22)' }}
          />
        ))}
        {[1, 2].map((n) => (
          <span
            key={`h${n}`}
            className="pointer-events-none absolute right-0 left-0"
            style={{ top: `${(n * 100) / 3}%`, height: 1, background: 'rgba(237,237,239,0.22)' }}
          />
        ))}

        {HANDLES.map((handle) => (
          <span
            key={handle.id}
            onPointerDown={resize(handle.id)}
            style={{
              position: 'absolute',
              left: `${handle.x * 100}%`,
              top: `${handle.y * 100}%`,
              width: 12,
              height: 12,
              marginLeft: -6,
              marginTop: -6,
              cursor: handle.cursor,
              background: 'var(--fg-primary)',
              borderRadius: 2,
              boxShadow: 'var(--shadow-knob)',
            }}
          />
        ))}
      </div>
    </div>
  );
}
