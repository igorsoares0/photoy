import type { BlendMode, SliderKey } from '@photoy/types';
import { NO_LAYERS, currentAdjustments, selectedLayer, useEditor } from '../store/editor';
import { formatInteger, formatSigned } from '../lib/format';
import { useState } from 'react';
import { CropPanel } from './CropPanel';
import { CurvePanel } from './CurvePanel';
import { HistoryPanel } from './HistoryPanel';
import { LayersPanel } from './LayersPanel';
import { TabBar } from './TabBar';
import { MaskPanel } from './MaskPanel';
import { MattePanel } from './MattePanel';
import { BrushPanel } from './BrushPanel';
import { PatchPanel } from './PatchPanel';
import { PresetsPanel } from './PresetsPanel';
import { EnhancePanel } from './EnhancePanel';
import { ResizePanel } from './ResizePanel';
import { PanelSection } from './PanelSection';
import { PortraitPanel } from './PortraitPanel';
import { RawPanel } from './RawPanel';
import { Slider } from './Slider';

interface Control {
  key: SliderKey;
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

/** Kept in English: these are the photographer's working terms. */
const BLEND_MODES: Array<{ value: BlendMode; label: string }> = [
  { value: 'normal', label: 'normal' },
  { value: 'multiply', label: 'multiply' },
  { value: 'screen', label: 'screen' },
  { value: 'overlay', label: 'overlay' },
  { value: 'soft-light', label: 'soft light' },
];

type Tab = 'edit' | 'history';

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'edit', label: 'Ajustes' },
  { value: 'history', label: 'Histórico' },
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
  {
    key: 'hue',
    label: 'Matiz',
    min: -180,
    max: 180,
    step: 1,
    format: (v) => `${formatSigned(v)}°`,
  },
  { key: 'saturation', label: 'Saturação', min: -100, max: 100, step: 1, format: (v) => formatSigned(v) },
  { key: 'vibrance', label: 'Vibração', min: -100, max: 100, step: 1, format: (v) => formatSigned(v) },
];

/** Local contrast: the two that look at a pixel's neighbours. */
const DETAIL: Control[] = [
  { key: 'denoise', label: 'Reduzir ruído', min: 0, max: 100, step: 1, format: (v) => formatInteger(v) },
  {
    key: 'denoiseDetail',
    label: 'Preservar detalhe',
    min: 0,
    max: 100,
    step: 1,
    format: (v) => formatInteger(v),
  },
  { key: 'sharpen', label: 'Nitidez', min: 0, max: 100, step: 1, format: (v) => formatInteger(v) },
  { key: 'clarity', label: 'Clareza', min: -100, max: 100, step: 1, format: (v) => formatSigned(v) },
];

/** Effects that depend on where a pixel sits, not only on what colour it is. */
const EFFECTS: Control[] = [
  { key: 'vignette', label: 'Vinheta', min: -100, max: 100, step: 1, format: (v) => formatSigned(v) },
  { key: 'grain', label: 'Grão', min: 0, max: 100, step: 1, format: (v) => formatInteger(v) },
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
  const [tab, setTab] = useState<Tab>('edit');
  const document = useEditor((state) => state.document);
  const cropping = useEditor((state) => state.cropRect !== null);
  const layer = useEditor(selectedLayer);
  const setLayerOpacity = useEditor((state) => state.setLayerOpacity);
  const setLayerBlend = useEditor((state) => state.setLayerBlend);
  const values = useEditor(currentAdjustments);
  const resetAdjustments = useEditor((state) => state.resetAdjustments);
  const copyAdjustments = useEditor((state) => state.copyAdjustments);
  const pasteAdjustments = useEditor((state) => state.pasteAdjustments);
  const copied = useEditor((state) => state.copiedAdjustments);
  // Curves are the one adjustment that is not a number, so "anything moved" is
  // asked of the sliders and of the four curves separately rather than of every
  // value in the object - which an object would answer yes to unconditionally.
  const touched =
    Object.values(values).some((value) => typeof value === 'number' && value !== 0) ||
    Object.values(values.curves).some((curve) => curve.length > 0);
  const hasAdjustmentLayer = useEditor((state) =>
    (state.history?.layers ?? NO_LAYERS).some((entry) => entry.kind === 'adjustment'),
  );
  // The original is what everything else is measured against and takes no edits.
  // Before any layer exists the sliders are still live: moving one creates the
  // layer it needs, so layers stay something you opt into rather than a step
  // between you and a slider.
  const editable = layer?.kind === 'adjustment' || !hasAdjustmentLayer;
  const adjustmentLayer = layer?.kind === 'adjustment' ? layer : null;
  // A matte layer removes; it does not adjust. Its own controls take the panel.
  const matteLayer = layer?.kind === 'matte' ? layer : null;
  const patchLayer = layer?.kind === 'patch' ? layer : null;

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
          <TabBar<Tab> tabs={TABS} value={tab} onChange={setTab} />
          {tab === 'history' ? (
            <HistoryPanel />
          ) : (
            /* Only the panel body scrolls; the chrome around it stays put. */
          <div
            className="flex flex-1 flex-col overflow-y-auto"
            style={{ padding: 'var(--pad-panel)', gap: 'var(--gap-group)' }}
          >
            <ResizePanel />
            <LayersPanel />
            <BrushPanel />
            {patchLayer !== null ? (
              <PatchPanel layer={patchLayer} />
            ) : matteLayer !== null ? (
              <MattePanel layer={matteLayer} />
            ) : editable ? (
              <>
                {adjustmentLayer !== null ? (
                  <PanelSection label="Mistura">
                    <label className="flex items-center justify-between">
                      <span style={{ fontSize: 'var(--text-control)', color: 'var(--fg-secondary)' }}>
                        Modo
                      </span>
                      <select
                        value={adjustmentLayer.blend}
                        onChange={(event) =>
                          void setLayerBlend(adjustmentLayer.id, event.target.value as BlendMode)
                        }
                        className="photoy-select"
                      >
                        {BLEND_MODES.map((mode) => (
                          <option key={mode.value} value={mode.value}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Slider
                      label="Opacidade"
                      value={Math.round(adjustmentLayer.opacity * 100)}
                      min={0}
                      max={100}
                      display={`${Math.round(adjustmentLayer.opacity * 100)} %`}
                      origin={100}
                      idle={adjustmentLayer.opacity >= 1}
                      onChange={(next, continuing) =>
                        void setLayerOpacity(adjustmentLayer.id, next / 100, continuing)
                      }
                      onReset={() => void setLayerOpacity(adjustmentLayer.id, 1, false)}
                    />
                  </PanelSection>
                ) : null}
                {adjustmentLayer !== null ? <MaskPanel layer={adjustmentLayer} /> : null}
                <EnhancePanel />
                <PortraitPanel />
                <PresetsPanel />
                {/* Before the tone controls because that is the order the
                    processing happens in: a raw file is balanced first, and
                    everything below acts on what that produced. */}
                <RawPanel />
                <Group label="Luz" controls={LIGHT} />
                {/* After the tone sliders because that is the order the engine
                    applies them in: the sliders shape the tones and the curve
                    is drawn on top of what they produced. */}
                <CurvePanel />
                <Group label="Cor" controls={COLOUR} />
                <Group label="Detalhe" controls={DETAIL} />
                <Group label="Efeitos" controls={EFFECTS} />
              </>
            ) : (
              <span style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-numeric-idle)' }}>
                O original não recebe ajustes. Selecione uma camada acima dele, ou crie uma.
              </span>
            )}
          </div>
          )}
          {/* Copying a look onto the next photograph is the gesture a folder is
              edited with, so it sits where the hand already is rather than in a
              menu: the same row as the reset, at the foot of the panel. */}
          <div className="flex" style={{ borderTop: '1px solid var(--border-hairline)' }}>
            <button
              type="button"
              onClick={copyAdjustments}
              title="Copiar ajustes (Ctrl+Shift+C)"
              className="photoy-panel-reset flex-1"
              style={{ height: 30, fontSize: 'var(--text-chip)', color: 'var(--fg-muted)' }}
            >
              Copiar
            </button>
            <span style={{ width: 1, background: 'var(--border-hairline)' }} />
            <button
              type="button"
              onClick={() => void pasteAdjustments()}
              disabled={copied === null}
              title="Colar ajustes (Ctrl+Shift+V)"
              className="photoy-panel-reset flex-1"
              style={{
                height: 30,
                fontSize: 'var(--text-chip)',
                color: 'var(--fg-muted)',
                opacity: copied === null ? 0.32 : 1,
                transition: 'var(--transition-control)',
              }}
            >
              Colar
            </button>
            <span style={{ width: 1, background: 'var(--border-hairline)' }} />
            <button
              type="button"
              onClick={() => void resetAdjustments()}
              disabled={!touched}
              className="photoy-panel-reset flex-1"
              style={{
                height: 30,
                fontSize: 'var(--text-chip)',
                color: 'var(--fg-muted)',
                opacity: touched ? 1 : 0.32,
                transition: 'var(--transition-control)',
              }}
            >
              Zerar
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
