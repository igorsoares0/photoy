import { useEditor } from '../store/editor';
import { formatZoom } from '../lib/format';

function HudButton({
  label,
  title,
  onClick,
  wide = false,
}: {
  label: string;
  title: string;
  onClick: () => void;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="photoy-hud-button"
      style={{
        height: 24,
        minWidth: wide ? 'auto' : 24,
        padding: wide ? '0 9px' : 0,
        borderRadius: 'var(--radius-icon)',
        fontSize: 'var(--text-chip)',
        color: 'var(--fg-muted)',
        transition: 'var(--transition-control)',
      }}
    >
      {label}
    </button>
  );
}

/** One of the three surfaces allowed to be translucent: .92 with a 12px blur. */
export function ZoomHud({ viewportRef }: { viewportRef: React.RefObject<HTMLElement | null> }): React.JSX.Element {
  const viewport = useEditor((state) => state.viewport);
  const zoomAt = useEditor((state) => state.zoomAt);
  const setViewport = useEditor((state) => state.setViewport);
  const fitToViewport = useEditor((state) => state.fitToViewport);

  const fit = () => {
    const box = viewportRef.current?.getBoundingClientRect();
    if (box !== undefined) fitToViewport(box.width, box.height);
  };

  return (
    <div
      className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 px-1.5 py-1"
      style={{
        background: 'color-mix(in srgb, var(--surface-raised) 92%, transparent)',
        backdropFilter: 'blur(12px)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-hud)',
        boxShadow: 'var(--shadow-hud)',
      }}
    >
      <HudButton label="−" title="Reduzir" onClick={() => zoomAt(1 / 1.25, 0, 0)} />
      <span
        className="numeric px-1 text-center"
        style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-primary)', minWidth: 54 }}
      >
        {formatZoom(viewport.scale)}
      </span>
      <HudButton label="+" title="Ampliar" onClick={() => zoomAt(1.25, 0, 0)} />
      <span style={{ width: 1, height: 14, background: 'var(--border-quiet)' }} />
      <HudButton label="Ajustar" title="Ajustar à janela" wide onClick={fit} />
      <HudButton
        label="100 %"
        title="Tamanho real"
        wide
        onClick={() => setViewport({ scale: 1, offsetX: 0, offsetY: 0 })}
      />
    </div>
  );
}
