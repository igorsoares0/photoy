import type { AdjustmentKey } from '@photoy/types';
import { currentAdjustments, useEditor } from '../store/editor';
import { formatSigned } from '../lib/format';
import { CropPanel } from './CropPanel';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

interface Control {
  key: AdjustmentKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Formats the value, including its unit. */
  format(value: number): string;
}

/** Exposure is the one control with a real unit; the rest are dimensionless. */
const LIGHT: Control[] = [
  {
    key: 'exposure',
    label: 'Exposição',
    min: -5,
    max: 5,
    step: 0.05,
    format: (v) => `${formatSigned(v, 2)} EV`,
  },
  { key: 'brightness', label: 'Brilho', min: -100, max: 100, step: 1, format: (v) => formatSigned(v) },
  { key: 'contrast', label: 'Contraste', min: -100, max: 100, step: 1, format: (v) => formatSigned(v) },
  { key: 'highlights', label: 'Realces', min: -100, max: 100, step: 1, format: (v) => formatSigned(v) },
  { key: 'shadows', label: 'Sombras', min: -100, max: 100, step: 1, format: (v) => formatSigned(v) },
];

const COLOUR: Control[] = [
  {
    key: 'temperature',
    label: 'Temperatura',
    min: -100,
    max: 100,
    step: 1,
    format: (v) => formatSigned(v),
  },
  { key: 'saturation', label: 'Saturação', min: -100, max: 100, step: 1, format: (v) => formatSigned(v) },
];

function Group({ label, controls }: { label: string; controls: Control[] }): React.JSX.Element {
  const values = useEditor(currentAdjustments);
  const setAdjustment = useEditor((state) => state.setAdjustment);

  return (
    <PanelSection label={label}>
      {controls.map((control) => {
        const value = values[control.key];
        return (
          <Slider
            key={control.key}
            label={control.label}
            value={value}
            min={control.min}
            max={control.max}
            step={control.step}
            display={control.format(value)}
            idle={value === 0}
            onChange={(next, continuing) => void setAdjustment(control.key, next, continuing)}
            onReset={() => void setAdjustment(control.key, 0, false)}
          />
        );
      })}
    </PanelSection>
  );
}

/**
 * The side panel.
 *
 * The crop tool takes the panel over while it is active: a mode with its own
 * decisions to make deserves the space, and leaving the sliders visible would
 * invite changes that the pending crop is not yet committed to.
 */
export function AdjustmentsPanel(): React.JSX.Element {
  const document = useEditor((state) => state.document);
  const cropping = useEditor((state) => state.cropRect !== null);
  const values = useEditor(currentAdjustments);
  const resetAdjustments = useEditor((state) => state.resetAdjustments);
  const touched = Object.values(values).some((value) => value !== 0);

  return (
    <aside
      className="flex shrink-0 flex-col"
      style={{
        width: 'var(--w-side-panel)',
        background: 'var(--surface-chrome)',
        borderLeft: '1px solid var(--border-hairline)',
      }}
    >
      {cropping ? (
        <CropPanel />
      ) : document === null ? (
        <div className="flex flex-1 items-center justify-center" style={{ padding: 'var(--pad-panel)' }}>
          <span style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-numeric-idle)' }}>
            Abra uma foto para ajustar
          </span>
        </div>
      ) : (
        <>
          {/* Only the panel body scrolls; the chrome around it stays put. */}
          <div
            className="flex flex-1 flex-col overflow-y-auto"
            style={{ padding: 'var(--pad-panel)', gap: 'var(--gap-group)' }}
          >
            <Group label="Luz" controls={LIGHT} />
            <Group label="Cor" controls={COLOUR} />
          </div>
          <button
            type="button"
            onClick={() => void resetAdjustments()}
            disabled={!touched}
            className="photoy-panel-reset"
            style={{
              height: 30,
              fontSize: 'var(--text-chip)',
              color: 'var(--fg-muted)',
              borderTop: '1px solid var(--border-hairline)',
              opacity: touched ? 1 : 0.32,
              transition: 'var(--transition-control)',
            }}
          >
            Zerar ajustes
          </button>
        </>
      )}
    </aside>
  );
}
