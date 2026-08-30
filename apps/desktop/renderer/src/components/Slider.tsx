import { useCallback, useId, useRef } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Rendered to the right of the label, monospace, already formatted. */
  display: string;
  /** Value the track is drawn from. Bipolar controls fill outwards from zero. */
  origin?: number;
  /** True when the value sits at its neutral point, which greys the control. */
  idle?: boolean;
  /** `continuing` is false on the first change of a gesture, true after. */
  onChange(value: number, continuing: boolean): void;
  /** Double-click returns the control to neutral. */
  onReset?(): void;
}

/**
 * The central control of the product.
 *
 * Label left, measured value right in monospace, a 2px track and an 11px knob.
 * Bipolar by default: the fill runs from zero outwards, so which way a value
 * has been pushed is readable without reading the number.
 *
 * The fill is neutral grey on purpose - violet marks a mask or an AI parameter,
 * and none of these are either.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  origin = 0,
  idle = false,
  onChange,
  onReset,
}: SliderProps): React.JSX.Element {
  const id = useId();
  const dragging = useRef(false);

  const ratio = (input: number) => (input - min) / (max - min);
  const position = ratio(value);
  const zero = ratio(origin);
  const fillLeft = Math.min(position, zero);
  const fillWidth = Math.abs(position - zero);

  const handleChange = useCallback(
    (next: number) => {
      onChange(next, dragging.current);
      dragging.current = true;
    },
    [onChange],
  );

  return (
    <div className="flex flex-col" style={{ gap: 'var(--gap-inline)' }}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} style={{ fontSize: 'var(--text-control)', color: 'var(--fg-secondary)' }}>
          {label}
        </label>
        <span
          className="numeric"
          style={{
            fontSize: 'var(--text-label)',
            // An untouched control reads as untouched at a glance, which is the
            // most frequent reading anyone makes of a panel of twenty sliders.
            color: idle ? 'var(--fg-numeric-idle)' : 'var(--fg-primary)',
          }}
        >
          {display}
        </span>
      </div>

      <div className="relative flex h-3.5 items-center" onDoubleClick={onReset}>
        <span
          className="absolute inset-x-0"
          style={{ height: 2, background: 'var(--border-subtle)', borderRadius: 'var(--radius-hairline)' }}
        />
        {origin > min && origin < max ? (
          <span
            className="absolute"
            style={{ left: `${zero * 100}%`, width: 1, height: 6, background: 'var(--border-hover)' }}
          />
        ) : null}
        <span
          className="absolute"
          style={{
            left: `${fillLeft * 100}%`,
            width: `${fillWidth * 100}%`,
            height: 2,
            background: 'var(--fg-numeric-idle)',
            borderRadius: 'var(--radius-hairline)',
          }}
        />
        <span
          className="pointer-events-none absolute"
          style={{
            left: `${position * 100}%`,
            width: 11,
            height: 11,
            marginLeft: -5.5,
            borderRadius: 'var(--radius-round)',
            background: idle ? 'var(--fg-numeric-idle)' : 'var(--fg-primary)',
            boxShadow: 'var(--shadow-knob)',
          }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => handleChange(Number(event.target.value))}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onBlur={() => {
            dragging.current = false;
          }}
          className="photoy-range absolute inset-x-0 h-3.5 w-full"
        />
      </div>
    </div>
  );
}
