import type { ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** 32 is the default control height; 34 is the full-width confirmation. */
  height?: 30 | 32 | 34;
  fullWidth?: boolean;
  title?: string;
}

/**
 * One filled button per surface, and it is white.
 *
 * Violet fill is reserved for applying AI output, so it has no variant here:
 * nothing in milestone 1 produces any.
 */
export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  height = 32,
  fullWidth = false,
  title,
}: ButtonProps): React.JSX.Element {
  const base: React.CSSProperties = {
    height,
    padding: '0 14px',
    borderRadius: 'var(--radius-control)',
    fontSize: 'var(--text-control)',
    border: '1px solid transparent',
    transition: 'var(--transition-control)',
    width: fullWidth ? '100%' : undefined,
    opacity: disabled ? 0.42 : 1,
  };

  const byVariant: Record<ButtonVariant, React.CSSProperties> = {
    primary: {
      background: 'var(--fg-primary)',
      color: 'var(--fg-on-solid)',
      fontWeight: 'var(--weight-semibold)' as unknown as number,
    },
    secondary: { borderColor: 'var(--border-quiet)', color: 'var(--fg-muted)' },
    ghost: { color: 'var(--fg-muted)' },
    danger: { borderColor: 'var(--danger-border)', color: 'var(--danger)' },
  };

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`photoy-button photoy-button--${variant} inline-flex items-center justify-center gap-2`}
      style={{ ...base, ...byVariant[variant] }}
    >
      {children}
    </button>
  );
}
