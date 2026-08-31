import type { Layer } from '@photoy/types';
import { NO_LAYERS, selectedLayer, useEditor } from '../store/editor';
import { formatInteger } from '../lib/format';
import { PanelSection } from './PanelSection';

/**
 * Typographic glyphs, not icons.
 *
 * The style guide allows exactly this: Unicode marks for layer type, because
 * the shape carries the meaning. There is no icon font and no emoji anywhere.
 */
const GLYPH: Record<string, string> = {
  background: '\u25A3',
  adjustment: '\u2600',
  matte: '\u25E8',
  patch: '\u2726',
};

function Row({ layer, selected }: { layer: Layer; selected: boolean }): React.JSX.Element {
  const selectLayer = useEditor((state) => state.selectLayer);
  const setLayerVisible = useEditor((state) => state.setLayerVisible);
  const background = layer.kind === 'background';

  return (
    // A row rather than one big button: the visibility toggle is its own
    // control, and nesting it inside another button would not be valid markup.
    <div
      className="photoy-layer-row flex w-full items-center gap-2"
      style={{
        height: 30,
        padding: '0 8px',
        borderRadius: 'var(--radius-row)',
        // Selection is a surface plus a ring. Violet is reserved for what a
        // model touched, so an adjustment layer does not get to use it.
        background: selected ? 'var(--surface-active)' : 'transparent',
        boxShadow: selected ? 'inset 0 0 0 1px var(--border-hover)' : 'none',
        transition: 'var(--transition-control)',
      }}
    >
      <button
        type="button"
        aria-label={`Visibilidade de ${layer.name || (background ? 'Original' : 'Ajuste')}`}
        aria-pressed={layer.visible}
        disabled={background}
        onClick={() => void setLayerVisible(layer.id, !layer.visible)}
        style={{
          width: 14,
          fontSize: 'var(--text-chip)',
          color: layer.visible ? 'var(--fg-muted)' : 'var(--fg-numeric-idle)',
          opacity: background ? 0.3 : 1,
        }}
      >
        {layer.visible ? '\u25CF' : '\u25CB'}
      </button>

      <span style={{ fontSize: 'var(--text-control)', color: 'var(--fg-faint)', width: 12 }}>
        {GLYPH[layer.kind]}
      </span>

      <button
        type="button"
        onClick={() => selectLayer(layer.id)}
        className="flex-1 truncate text-left"
        style={{
          fontSize: 'var(--text-control)',
          color: selected ? 'var(--fg-primary)' : 'var(--fg-secondary)',
        }}
      >
        {background ? 'Original' : layer.name || 'Ajuste'}
      </button>

      {!background && layer.opacity < 1 ? (
        <span className="numeric" style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-ghost)' }}>
          {formatInteger(layer.opacity * 100)} %
        </span>
      ) : null}
    </div>
  );
}

export function LayersPanel(): React.JSX.Element {
  // The fallback has to be a shared constant: a fresh [] here would compare
  // unequal on every call and loop the renderer.
  const layers = useEditor((state) => state.history?.layers ?? NO_LAYERS);
  const current = useEditor(selectedLayer);
  const addLayer = useEditor((state) => state.addLayer);
  const removeLayer = useEditor((state) => state.removeLayer);
  const moveLayer = useEditor((state) => state.moveLayer);

  const editable = current !== null && current.kind === 'adjustment';
  const index = layers.findIndex((layer) => layer.id === current?.id);

  return (
    <PanelSection
      label="Camadas"
      hint={
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Mover camada para cima"
            disabled={!editable || index >= layers.length - 1}
            onClick={() => current && void moveLayer(current.id, 1)}
            className="photoy-mini"
          >
            ↑
          </button>
          <button
            type="button"
            aria-label="Mover camada para baixo"
            disabled={!editable || index <= 1}
            onClick={() => current && void moveLayer(current.id, -1)}
            className="photoy-mini"
          >
            ↓
          </button>
          <button
            type="button"
            aria-label="Remover camada"
            disabled={!editable}
            onClick={() => current && void removeLayer(current.id)}
            className="photoy-mini"
          >
            −
          </button>
          <button type="button" aria-label="Nova camada de ajuste" onClick={() => void addLayer()} className="photoy-mini">
            +
          </button>
        </span>
      }
    >
      {/* Top of the stack reads first, so the list is shown in reverse. The
          bottom row is always the untouched original. */}
      <div className="flex flex-col" style={{ gap: 2 }}>
        {layers.map((_, i) => layers[layers.length - 1 - i]!).map((layer) => (
          <Row key={layer.id} layer={layer} selected={layer.id === current?.id} />
        ))}
      </div>

    </PanelSection>
  );
}
