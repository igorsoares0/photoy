import type { Layer } from '@photoy/types';
import { useEditor } from '../store/editor';
import { MaskPanel } from './MaskPanel';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

/**
 * Controls for an object removal.
 *
 * The layer's mask is both what marks the object and what blends the fill, so
 * the mark can be trimmed after the fact without the model running again. Until
 * it is filled the layer draws nothing, which is why the picture does not
 * change while you are still deciding what to paint over.
 */
export function PatchPanel({ layer }: { layer: Layer }): React.JSX.Element {
  const fillMarked = useEditor((state) => state.fillMarked);
  const setLayerOpacity = useEditor((state) => state.setLayerOpacity);
  const filling = useEditor((state) => state.busy === 'filling');
  const marked = layer.mask.kind === 'raster' && layer.mask.raster !== 0;
  const filled = layer.patch !== 0;

  return (
    <>
      <PanelSection label="Remoção">
        <span style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
          {marked
            ? 'Pinte sobre o objeto e preencha. Dá para corrigir a marca depois.'
            : 'Use o pincel para marcar o objeto.'}
        </span>

        {/* Violet, like every other control a model is behind. */}
        <button
          type="button"
          onClick={() => void fillMarked(layer.id)}
          disabled={!marked || filling}
          className="photoy-chip"
          style={{
            height: 30,
            borderRadius: 'var(--radius-control)',
            fontSize: 'var(--text-control)',
            border: '1px solid var(--accent-border)',
            background: filled ? 'var(--accent-surface)' : 'transparent',
            color: 'var(--accent-text)',
            opacity: !marked || filling ? 0.5 : 1,
            transition: 'var(--transition-control)',
          }}
        >
          {filling ? 'Preenchendo…' : filled ? 'Preencher de novo' : 'Preencher'}
        </button>

        {filled ? (
          <Slider
            label="Intensidade"
            value={Math.round(layer.opacity * 100)}
            min={0}
            max={100}
            display={`${Math.round(layer.opacity * 100)} %`}
            origin={100}
            idle={layer.opacity >= 1}
            onChange={(next, continuing) =>
              void setLayerOpacity(layer.id, next / 100, continuing)
            }
            onReset={() => void setLayerOpacity(layer.id, 1, false)}
          />
        ) : null}
      </PanelSection>

      <MaskPanel layer={layer} />
    </>
  );
}
