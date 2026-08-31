interface TabBarProps<T extends string> {
  tabs: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange(value: T): void;
}

/**
 * One-word tabs with a 1.5px underline. No pill, no background.
 *
 * The style guide asks for three or four; there are two here because there are
 * two things to show. A third will arrive with the tools that need one.
 */
export function TabBar<T extends string>({ tabs, value, onChange }: TabBarProps<T>): React.JSX.Element {
  return (
    <div
      className="flex shrink-0 items-stretch"
      style={{
        height: 'var(--h-tabbar)',
        borderBottom: '1px solid var(--border-hairline)',
        paddingLeft: 'var(--pad-panel)',
        gap: 18,
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className="photoy-tab relative"
            style={{
              fontSize: 'var(--text-control)',
              color: selected ? 'var(--fg-primary)' : 'var(--fg-muted)',
              transition: 'color var(--dur-fast) var(--ease-standard)',
            }}
          >
            {tab.label}
            {selected ? (
              <span
                className="absolute inset-x-0"
                style={{ bottom: -1, height: 1.5, background: 'var(--fg-primary)' }}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
