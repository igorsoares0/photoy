interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange(value: T): void;
}

/** For 2-4 exclusive options. Above that the style guide calls for a select. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>): React.JSX.Element {
  return (
    <div
      className="flex"
      style={{
        border: '1px solid var(--border-quiet)',
        borderRadius: 'var(--radius-control)',
        padding: 2,
        gap: 2,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className="photoy-segment flex-1"
            style={{
              height: 26,
              borderRadius: 5,
              fontSize: 'var(--text-control)',
              // Selection is a surface plus a ring, never a solid fill.
              background: selected ? 'var(--surface-active)' : 'transparent',
              boxShadow: selected ? 'inset 0 0 0 1px var(--border-hover)' : 'none',
              color: selected ? 'var(--fg-primary)' : 'var(--fg-muted)',
              transition: 'var(--transition-control)',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
