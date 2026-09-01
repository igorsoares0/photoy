import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store/editor';
import { formatInteger, formatSigned } from '../lib/format';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

/** What the engine clamps to. Stated here so the control cannot ask for more. */
const MIN_KELVIN = 2000;
const MAX_KELVIN = 25000;
const MAX_TINT = 150;

/**
 * White balance, on a raw file.
 *
 * The one panel whose controls reach behind the decode. Every other slider in
 * the product changes what happens to the decoded pixels; these change what the
 * decoder produces, because white balance multiplies the sensor's own readings
 * before the colour mosaic is interpolated and there is no way back to those
 * readings afterwards.
 *
 * That costs a decode - close to a second on a full frame - which is why the
 * sliders follow the finger locally and only reach the engine when it lifts.
 * The alternative is a control that stutters a second behind the hand.
 */
export function RawPanel(): React.JSX.Element | null {
  const adjustable = useEditor((state) => state.document?.image.raw?.adjustable ?? false);
  const asShotTemperature = useEditor((state) => state.document?.image.raw?.asShotTemperature ?? 0);
  const asShotTint = useEditor((state) => state.document?.image.raw?.asShotTint ?? 0);
  const custom = useEditor((state) => state.history?.raw.custom ?? false);
  const temperature = useEditor((state) => state.history?.raw.temperature ?? 0);
  const tint = useEditor((state) => state.history?.raw.tint ?? 0);
  const applyEdit = useEditor((state) => state.applyEdit);

  // What the knob shows while it is being dragged. Null the rest of the time,
  // so undo and a preset move the control rather than fighting it.
  const [dragged, setDragged] = useState<{ temperature: number; tint: number } | null>(null);
  const latest = useRef({ temperature, tint });
  useEffect(() => {
    latest.current = { temperature, tint };
    setDragged(null);
  }, [temperature, tint, custom]);

  if (!adjustable) return null;

  const shown = dragged ?? { temperature, tint };
  const commit = (next: { temperature: number; tint: number }) => {
    void applyEdit({
      kind: 'developRaw',
      custom: true,
      temperature: next.temperature,
      tint: next.tint,
    });
  };

  const drag = (key: 'temperature' | 'tint') => (value: number) => {
    setDragged((current) => ({ ...(current ?? latest.current), [key]: value }));
  };

  return (
    <PanelSection
      label="Balanço de branco"
      hint={
        custom ? (
          <button
            type="button"
            className="photoy-mini"
            style={{ width: 'auto', padding: '0 6px' }}
            onClick={() => void applyEdit({ kind: 'developRaw', custom: false })}
          >
            como na câmera
          </button>
        ) : (
          <span style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
            como na câmera
          </span>
        )
      }
    >
      <Slider
        label="Temperatura"
        value={shown.temperature}
        min={MIN_KELVIN}
        max={MAX_KELVIN}
        step={10}
        display={`${formatInteger(Math.round(shown.temperature))} K`}
        // The track fills from where the camera left it, so how far a
        // photograph has been pushed is readable without reading the number.
        origin={asShotTemperature}
        idle={!custom}
        onChange={drag('temperature')}
        onCommit={() => commit(dragged ?? { temperature, tint })}
        onReset={() => commit({ temperature: asShotTemperature, tint: shown.tint })}
      />
      <Slider
        label="Matiz"
        value={shown.tint}
        min={-MAX_TINT}
        max={MAX_TINT}
        step={1}
        display={formatSigned(shown.tint, 0)}
        origin={asShotTint}
        idle={!custom}
        onChange={drag('tint')}
        onCommit={() => commit(dragged ?? { temperature, tint })}
        onReset={() => commit({ temperature: shown.temperature, tint: asShotTint })}
      />
    </PanelSection>
  );
}
