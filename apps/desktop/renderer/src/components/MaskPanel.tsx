import type { Layer, Mask, MaskKind } from '@photoy/types';
import { NO_MASK, isMaskStale } from '@photoy/types';
import { useEditor } from '../store/editor';
import { formatDecimal, formatInteger } from '../lib/format';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

/** Raster is not offered here: it is produced, not chosen. */
const KINDS: Array<{ value: MaskKind; label: string }> = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
];

/**
 * Mask controls for the selected layer.
 *
 * Violet appears here and nowhere else in the panel: the style guide reserves
 * it for masks and for what a model touched, and this is the first of the two
 * to exist.
 */
export function MaskPanel({ layer }: { layer: Layer }): React.JSX.Element {
  const setLayerMask = useEditor((state) => state.setLayerMask);
  const segmentIntoMask = useEditor((state) => state.segmentIntoMask);
  const segmenting = useEditor((state) => state.busy === 'segmenting');
  // The natural size, not the rendered one: a resize must not make a mask look
  // stale, because it scales every pixel under the mask together.
  const documentWidth = useEditor((state) => state.history?.naturalWidth ?? 0);
  const documentHeight = useEditor((state) => state.history?.naturalHeight ?? 0);
  const mask = layer.mask;
  const stale = isMaskStale(mask, documentWidth, documentHeight);

  const update = (patch: Partial<Mask>, continuing = false) =>
    void setLayerMask(layer.id, { ...mask, ...patch }, continuing);

  return (
    <PanelSection
      label="Máscara"
      hint={
        mask.kind === 'none' ? null : (
          <button
            type="button"
            onClick={() => update({ invert: !mask.invert })}
            className="photoy-mini"
            style={{ width: 'auto', padding: '0 6px', color: mask.invert ? 'var(--accent-text)' : undefined }}
            aria-label="Inverter máscara"
          >
            inverter
          </button>
        )
      }
    >
      <div className="flex flex-wrap" style={{ gap: 'var(--gap-inline)' }}>
        {KINDS.map((kind) => {
          const selected = mask.kind === kind.value;
          return (
            <button
              key={kind.value}
              type="button"
              onClick={() => update(kind.value === 'none' ? NO_MASK : { ...NO_MASK, kind: kind.value })}
              className="photoy-chip"
              style={{
                height: 26,
                padding: '0 11px',
                borderRadius: 'var(--radius-chip)',
                fontSize: 'var(--text-chip)',
                // Violet marks the mask, which is exactly what it is for.
                border: `1px solid ${selected && kind.value !== 'none' ? 'var(--accent-border)' : selected ? 'var(--border-hover)' : 'var(--border-quiet)'}`,
                background: selected ? 'var(--surface-active)' : 'transparent',
                color: selected
                  ? kind.value === 'none'
                    ? 'var(--fg-primary)'
                    : 'var(--accent-text)'
                  : 'var(--fg-muted)',
                transition: 'var(--transition-control)',
              }}
            >
              {kind.label}
            </button>
          );
        })}
      </div>

      {/* The only violet-filled control in the product: this is where a model
          touches the picture, which is exactly what the colour is reserved for. */}
      <button
        type="button"
        onClick={() => void segmentIntoMask(layer.id)}
        disabled={segmenting}
        className="photoy-chip"
        style={{
          height: 30,
          borderRadius: 'var(--radius-control)',
          fontSize: 'var(--text-control)',
          border: '1px solid var(--accent-border)',
          background: mask.kind === 'raster' ? 'var(--accent-surface)' : 'transparent',
          color: 'var(--accent-text)',
          opacity: segmenting ? 0.6 : 1,
          transition: 'var(--transition-control)',
        }}
      >
        {segmenting ? 'Selecionando…' : 'Selecionar sujeito'}
      </button>

      {mask.kind === 'raster' ? (
        <span
          className="numeric"
          style={{ fontSize: 'var(--text-micro)', color: stale ? 'var(--danger)' : 'var(--fg-numeric-idle)' }}
        >
          {stale
            ? 'a foto mudou de forma — refaça a seleção'
            : `seg · ${mask.rasterWidth} × ${mask.rasterHeight}`}
        </span>
      ) : null}

      {/* A model returns confidence, not a selection. These two are the black
          and the white point of that confidence: raising the first throws away
          what it never believed, lowering the second firms up what it did. */}
      {mask.kind === 'raster' && !stale ? (
        <>
          <Slider
            label="Corte"
            value={Math.round(mask.low * 100)}
            min={0}
            max={95}
            display={`${formatInteger(mask.low * 100)} %`}
            origin={0}
            idle={mask.low <= 0}
            onChange={(next, continuing) =>
              update({ low: Math.min(next, mask.high * 100 - 5) / 100 }, continuing)
            }
            onReset={() => update({ low: 0 })}
          />
          <Slider
            label="Sólido"
            value={Math.round(mask.high * 100)}
            min={5}
            max={100}
            display={`${formatInteger(mask.high * 100)} %`}
            origin={100}
            idle={mask.high >= 1}
            onChange={(next, continuing) =>
              update({ high: Math.max(next, mask.low * 100 + 5) / 100 }, continuing)
            }
            onReset={() => update({ high: 1 })}
          />
        </>
      ) : null}

      {mask.kind === 'none' || mask.kind === 'raster' ? null : (
        <>
          {mask.kind === 'radial' ? (
            <Slider
              label="Tamanho"
              value={Math.round(mask.radius * 100)}
              min={2}
              max={150}
              display={`${formatInteger(mask.radius * 100)} %`}
              origin={2}
              onChange={(next, continuing) => update({ radius: next / 100 }, continuing)}
            />
          ) : (
            <Slider
              label="Ângulo"
              value={Math.round((mask.angle * 180) / Math.PI)}
              min={-180}
              max={180}
              display={`${formatInteger((mask.angle * 180) / Math.PI)}°`}
              onChange={(next, continuing) =>
                update({ angle: (next * Math.PI) / 180 }, continuing)
              }
              onReset={() => update({ angle: 0 })}
            />
          )}
          <Slider
            label="Suavidade"
            value={Math.round(mask.feather * 100)}
            min={0}
            max={200}
            display={`${formatDecimal(mask.feather * 100, 0)} %`}
            origin={0}
            onChange={(next, continuing) => update({ feather: next / 100 }, continuing)}
          />
        </>
      )}
    </PanelSection>
  );
}
