import type { ReactNode } from 'react';

/**
 * A group of controls under an eyebrow.
 *
 * No border and no background: grouping comes from space, which is why the gap
 * between sections is the only separator the panel uses.
 */
export function PanelSection({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col" style={{ gap: 'var(--gap-control)' }}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        {hint}
      </div>
      <div className="flex flex-col" style={{ gap: 'var(--gap-control)' }}>{children}</div>
    </section>
  );
}
