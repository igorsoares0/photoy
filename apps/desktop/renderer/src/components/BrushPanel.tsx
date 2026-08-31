import { selectedLayer, useEditor } from '../store/editor';
import { formatInteger } from '../lib/format';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

const MODES: Array<{ value: 'add' | 'erase'; label: string }> = [
  { value: 'add', label: 'Pintar' },
  { value: 'erase', label: 'Apagar' },
];

/**
 * Controls for the mask brush.
 *
 * The size is a percentage of the shorter side rather than a pixel count,
 * which is the unit every other mask here uses: it means the same thing on a
 * phone snapshot and on a scan, and it survives a resize.
 */
export function BrushPanel(): React.JSX.Element {
  const brush = useEditor((state) => state.brush);
  const setBrush = useEditor((state) => state.setBrush);
  const layer = useEditor(selectedLayer);
  const maskable = layer !== null && layer.kind !== 'background';

  if (brush === null) return <></>;

  return (
    <PanelSection label="Pincel">
      {maskable ? null : (
        <span style={{ fontSize: 'var(--text-chip)', color: 'var(--danger)' }}>
          O original não recebe máscara. Selecione uma camada acima dele, ou crie uma.
        </span>
      )}

      <div className="flex flex-wrap" style={{ gap: 'var(--gap-inline)' }}>
        {MODES.map((mode) => {
          const selected = brush.mode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => setBrush({ mode: mode.value })}
              className="photoy-chip"
              style={{
                border: `1px solid ${selected ? 'var(--accent-border)' : 'var(--border-quiet)'}`,
                background: selected ? 'var(--accent-surface)' : 'transparent',
                color: selected ? 'var(--accent-text)' : 'var(--fg-secondary)',
              }}
            >
              {mode.label}
            </button>
          );
        })}
      </div>

      <Slider
        label="Tamanho"
        value={brush.size}
        min={1}
        max={50}
        display={`${formatInteger(brush.size)} %`}
        origin={6}
        onChange={(next) => setBrush({ size: next })}
        onReset={() => setBrush({ size: 6 })}
      />

      <span style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
        Cada traço é um passo do histórico.
      </span>
    </PanelSection>
  );
}
