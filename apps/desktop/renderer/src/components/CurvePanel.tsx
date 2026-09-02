import type { Curve, CurveChannel } from '@photoy/types';
import { useRef, useState } from 'react';
import { currentAdjustments, useEditor } from '../store/editor';
import { addPoint, isIdentity, movePoint, nearestPoint, removePoint, sample } from '../lib/curves';
import { PanelSection } from './PanelSection';

/**
 * How near a click has to land to grab a point rather than make one, measured
 * in the unit square so it does not change when the panel is resized.
 */
const REACH = 0.055;

/** Samples along the drawn path. Enough that the curve reads as a curve. */
const RESOLUTION = 96;

const CHANNELS: ReadonlyArray<{ value: CurveChannel; label: string }> = [
  { value: 'rgb', label: 'RGB' },
  { value: 'red', label: 'R' },
  { value: 'green', label: 'G' },
  { value: 'blue', label: 'B' },
];

/**
 * The colour each channel is drawn in.
 *
 * Not tokens, and deliberately: these say which channel a line belongs to,
 * which is information about the photograph rather than a state of the
 * interface. The violet accent stays out of it - the style guide reserves that
 * for masks and for what a model touched.
 */
const CHANNEL_COLOURS: Record<CurveChannel, string> = {
  rgb: 'var(--fg-primary)',
  red: '#e08b7d',
  green: '#7dbd90',
  blue: '#7da2e0',
};

/** Turns samples into a path, in the square's own coordinates with y up. */
function pathFor(curve: Curve): string {
  return sample(curve, RESOLUTION)
    .map((y, i) => `${i === 0 ? 'M' : 'L'} ${(i / (RESOLUTION - 1)).toFixed(4)} ${(1 - y).toFixed(4)}`)
    .join(' ');
}

/**
 * The point curves.
 *
 * The whole control is one square: the tone that arrives runs left to right,
 * the tone that leaves runs bottom to top, and the diagonal is what the
 * photograph looks like now. Click to place a point, drag to move it,
 * double-click to take it away.
 */
export function CurvePanel(): React.JSX.Element {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const curves = useEditor(currentAdjustments).curves;
  const setCurve = useEditor((state) => state.setCurve);
  const square = useRef<SVGSVGElement>(null);
  // Which point the pointer is holding, and whether it has moved yet. Together
  // they are what makes a drag one history entry instead of one per frame.
  const held = useRef<number | null>(null);
  const dragged = useRef(false);
  const [active, setActive] = useState<number | null>(null);

  const curve = curves[channel];
  const bent = !isIdentity(curve);
  /**
   * The curve as something to grab.
   *
   * An untouched curve carries no points at all, which is what keeps a document
   * that never opened this panel neutral. It still has to be draggable though -
   * the two ends are the black and white points, and setting those is half of
   * what a curve tool is for - so the identity is shown as the two points it
   * would be if it had any.
   */
  const shape: Curve = curve.length > 0 ? curve : [{ x: 0, y: 0 }, { x: 1, y: 1 }];

  /** Pointer position in the square, with y already flipped to mean tone. */
  const positionOf = (event: React.PointerEvent | React.MouseEvent) => {
    const box = square.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height)),
    };
  };

  const commit = (next: Curve, continuing: boolean) => void setCurve(channel, next, continuing);

  const onPointerDown = (event: React.PointerEvent) => {
    const at = positionOf(event);
    const found = nearestPoint(shape, at, REACH);
    if (found >= 0) {
      // Grabbing an existing point starts no edit of its own: nothing has moved
      // yet, and a history entry for a point that was only touched is noise.
      held.current = found;
      setActive(found);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const next = addPoint(shape, at);
    const placed = nearestPoint(next, at, REACH);
    held.current = placed;
    dragged.current = true;
    setActive(placed);
    commit(next, false);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (held.current === null) return;
    const index = held.current;
    const moved = movePoint(shape, index, positionOf(event));
    // The gesture is one undo step: the first change of a drag opens it and
    // every frame after replaces it, the same bargain the sliders make.
    commit(moved, dragged.current);
    dragged.current = true;
  };

  const onPointerUp = () => {
    held.current = null;
    dragged.current = false;
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const found = nearestPoint(shape, positionOf(event), REACH);
    if (found < 0) return;
    setActive(null);
    commit(removePoint(shape, found), false);
  };

  return (
    <PanelSection
      label="Curvas"
      hint={
        bent ? (
          <button
            type="button"
            onClick={() => commit([], false)}
            className="photoy-mini"
            style={{ width: 'auto', padding: '0 6px' }}
          >
            zerar
          </button>
        ) : null
      }
    >
      <div className="flex" style={{ gap: 'var(--gap-inline)' }}>
        {CHANNELS.map((option) => {
          const selected = option.value === channel;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setChannel(option.value);
                setActive(null);
              }}
              className="photoy-segment flex-1"
              style={{
                height: 24,
                borderRadius: 5,
                fontSize: 'var(--text-chip)',
                background: selected ? 'var(--surface-active)' : 'transparent',
                boxShadow: selected ? 'inset 0 0 0 1px var(--border-hover)' : 'none',
                // A channel that is already bent says so from its tab, so the
                // grade is legible without visiting all four.
                color: isIdentity(curves[option.value])
                  ? selected
                    ? 'var(--fg-primary)'
                    : 'var(--fg-muted)'
                  : CHANNEL_COLOURS[option.value],
                transition: 'var(--transition-control)',
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <svg
        ref={square}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="w-full touch-none"
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-quiet)',
          borderRadius: 'var(--radius-control)',
          cursor: 'crosshair',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {/* Quarters, which is where anyone reading a curve looks first. */}
        {[0.25, 0.5, 0.75].map((at) => (
          <g key={at} stroke="var(--border-hairline)" strokeWidth={0.004}>
            <line x1={at} y1={0} x2={at} y2={1} />
            <line x1={0} y1={at} x2={1} y2={at} />
          </g>
        ))}
        <line
          x1={0}
          y1={1}
          x2={1}
          y2={0}
          stroke="var(--border-subtle)"
          strokeWidth={0.004}
          strokeDasharray="0.02 0.02"
        />

        {/* The channels not being edited, faint, so a grade stays visible while
            another part of it is being worked on. */}
        {CHANNELS.filter((other) => other.value !== channel && !isIdentity(curves[other.value])).map(
          (other) => (
            <path
              key={other.value}
              d={pathFor(curves[other.value])}
              fill="none"
              stroke={CHANNEL_COLOURS[other.value]}
              strokeWidth={0.006}
              opacity={0.3}
            />
          ),
        )}

        <path
          d={pathFor(curve)}
          fill="none"
          stroke={CHANNEL_COLOURS[channel]}
          strokeWidth={0.008}
        />

        {shape.map((point, index) => (
          <circle
            key={`${point.x}-${index}`}
            cx={point.x}
            cy={1 - point.y}
            r={index === active ? 0.026 : 0.02}
            fill={index === active ? CHANNEL_COLOURS[channel] : 'var(--surface-app)'}
            stroke={CHANNEL_COLOURS[channel]}
            strokeWidth={0.006}
          />
        ))}
      </svg>
    </PanelSection>
  );
}
