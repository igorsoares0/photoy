import type { FillKind, Layer } from '@photoy/types';
import { useEditor } from '../store/editor';
import { MaskPanel } from './MaskPanel';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

const FILLS: Array<{ value: FillKind; label: string }> = [
  { value: 'transparent', label: 'Transparente' },
  { value: 'color', label: 'Cor' },
];

/** Enough to reach for without opening a picker; the picker covers the rest. */
const PRESETS = [
  { label: 'Branco', rgb: [1, 1, 1] },
  { label: 'Preto', rgb: [0, 0, 0] },
  { label: 'Cinza', rgb: [0.5, 0.5, 0.5] },
] as const;

/** sRGB 0-1 to the `#rrggbb` an <input type="color"> speaks, and back. */
function hexOf(color: { r: number; g: number; b: number }): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`;
}

function colorOf(hex: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: ((value >> 16) & 0xff) / 255,
    g: ((value >> 8) & 0xff) / 255,
    b: (value & 0xff) / 255,
  };
}

/**
 * Controls for a matte layer: what the mask keeps, and what takes the place of
 * everything else.
 *
 * The photograph is never modified. Removing the background is a layer, so it
 * can be softened, inverted, hidden or thrown away, and the pixels underneath
 * are still there.
 */
export function MattePanel({ layer }: { layer: Layer }): React.JSX.Element {
  const setLayerFill = useEditor((state) => state.setLayerFill);
  const setLayerOpacity = useEditor((state) => state.setLayerOpacity);
  const filled = layer.fill === 'color';

  return (
    <>
      <PanelSection label="Fundo">
        <div className="flex flex-wrap" style={{ gap: 'var(--gap-inline)' }}>
          {FILLS.map((fill) => {
            const selected = layer.fill === fill.value;
            return (
              <button
                key={fill.value}
                type="button"
                onClick={() => void setLayerFill(layer.id, fill.value, layer.color)}
                className="photoy-chip"
                style={{
                  border: `1px solid ${selected ? 'var(--border-hover)' : 'var(--border-quiet)'}`,
                  background: selected ? 'var(--surface-active)' : 'transparent',
                  color: selected ? 'var(--fg-primary)' : 'var(--fg-secondary)',
                }}
              >
                {fill.label}
              </button>
            );
          })}
        </div>

        {filled ? (
          <div className="flex items-center" style={{ gap: 'var(--gap-inline)' }}>
            {PRESETS.map((preset) => {
              const color = { r: preset.rgb[0], g: preset.rgb[1], b: preset.rgb[2] };
              const selected = hexOf(layer.color) === hexOf(color);
              return (
                <button
                  key={preset.label}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  onClick={() => void setLayerFill(layer.id, 'color', color)}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 'var(--radius-icon)',
                    background: hexOf(color),
                    boxShadow: `inset 0 0 0 1px var(--border-quiet)${
                      selected ? ', 0 0 0 2px var(--surface-chrome), 0 0 0 3px var(--border-hover)' : ''
                    }`,
                    transition: 'var(--transition-control)',
                  }}
                />
              );
            })}
            {/* The system picker: a colour wheel is a solved problem, and this
                one already matches the platform the user is on. */}
            <label
              className="flex flex-1 items-center justify-end"
              style={{ gap: 6, fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}
            >
              <span className="numeric">{hexOf(layer.color)}</span>
              <input
                type="color"
                value={hexOf(layer.color)}
                onChange={(event) => void setLayerFill(layer.id, 'color', colorOf(event.target.value))}
                aria-label="Escolher cor do fundo"
                style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'transparent' }}
              />
            </label>
          </div>
        ) : null}

        <Slider
          label="Intensidade"
          value={Math.round(layer.opacity * 100)}
          min={0}
          max={100}
          display={`${Math.round(layer.opacity * 100)} %`}
          origin={100}
          idle={layer.opacity >= 1}
          onChange={(next, continuing) => void setLayerOpacity(layer.id, next / 100, continuing)}
          onReset={() => void setLayerOpacity(layer.id, 1, false)}
        />
      </PanelSection>

      <MaskPanel layer={layer} />
    </>
  );
}
