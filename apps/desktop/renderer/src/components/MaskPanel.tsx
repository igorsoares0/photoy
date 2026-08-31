import type { Layer, Mask, MaskKind } from '@photoy/types';
import { NO_MASK } from '@photoy/types';
import { useEditor } from '../store/editor';
import { formatDecimal, formatInteger } from '../lib/format';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

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
  const mask = layer.mask;

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

      {mask.kind === 'none' ? null : (
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
