import { Icon, type IconName } from './Icon';

interface IconButtonProps {
  icon: IconName;
  /** Shown as the tooltip; the button itself carries no label. */
  title: string;
  onClick(): void;
  disabled?: boolean;
  /** 30 in chrome, 36 in the tool rail. */
  size?: 30 | 36;
  /** A selected tool is a surface plus a ring, never a solid fill. */
  selected?: boolean;
  /** Violet: this button puts a model to work. Reserved for exactly that. */
  accent?: boolean;
}

export function IconButton({
  icon,
  title,
  onClick,
  disabled = false,
  size = 30,
  selected = false,
  accent = false,
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="photoy-icon-button inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--radius-icon)',
        background: selected ? 'var(--surface-active)' : 'transparent',
        boxShadow: selected
          ? `inset 0 0 0 1px ${accent ? 'var(--accent-border)' : 'var(--border-hover)'}`
          : 'none',
        color: accent ? 'var(--accent-text)' : selected ? 'var(--fg-primary)' : 'var(--fg-muted)',
        opacity: disabled ? 0.32 : 1,
        transition: 'var(--transition-control)',
      }}
    >
      <Icon name={icon} size={size === 36 ? 17 : 15} />
    </button>
  );
}
