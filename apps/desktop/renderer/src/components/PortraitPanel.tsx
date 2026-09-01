import { useEditor } from '../store/editor';
import { AUTO_STRENGTHS, type PortraitToolId } from '../lib/portrait';
import { formatInteger } from '../lib/format';
import { Button } from './Button';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

const TOOLS: ReadonlyArray<{ id: PortraitToolId; label: string; hint: string }> = [
  { id: 'skin', label: 'Pele', hint: 'suaviza a pele sem tocar em olhos e boca' },
  { id: 'light', label: 'Luz do rosto', hint: 'clareia o rosto sem clarear o fundo' },
  { id: 'eyes', label: 'Olhos', hint: 'dá definição ao olhar' },
  { id: 'teeth', label: 'Dentes', hint: 'só onde a boca é clara e sem cor' },
];

/**
 * Portrait tools.
 *
 * Each one is a layer with a generated mask and the same adjustments the panel
 * below offers - nothing here touches a pixel that the rest of the product
 * could not already touch. That is what makes them undoable, stackable, and
 * present in a saved project without any of those having to be arranged.
 *
 * Nothing is offered until a face is found, because every region here is built
 * from where the eyes and the mouth are. A photograph with no face in it gets
 * the button and not the sliders.
 */
export function PortraitPanel(): React.JSX.Element | null {
  const hasDocument = useEditor((state) => state.document !== null);
  const faces = useEditor((state) => state.portrait?.faces.length ?? 0);
  const detected = useEditor((state) => state.portrait !== null);
  const busy = useEditor((state) => state.busy);
  const detectFaces = useEditor((state) => state.detectFaces);
  const setPortraitTool = useEditor((state) => state.setPortraitTool);
  const applyPortraitAuto = useEditor((state) => state.applyPortraitAuto);
  const tools = useEditor((state) => state.portrait?.tools);

  if (!hasDocument) return null;
  const working = busy === 'detecting';

  return (
    <PanelSection
      label="Retrato"
      hint={
        detected && faces > 0 ? (
          <button
            type="button"
            className="photoy-mini"
            style={{ width: 'auto', padding: '0 6px' }}
            onClick={() => void applyPortraitAuto()}
          >
            auto
          </button>
        ) : null
      }
    >
      {!detected ? (
        <Button fullWidth disabled={working} onClick={() => void detectFaces()}>
          {working ? 'Procurando rosto…' : 'Procurar rosto'}
        </Button>
      ) : faces === 0 ? (
        <p style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
          Nenhum rosto encontrado nesta foto.
        </p>
      ) : (
        <>
          {faces > 1 ? (
            <p style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
              {formatInteger(faces)} rostos — os ajustes valem para todos.
            </p>
          ) : null}
          {TOOLS.map((tool) => {
            const strength = tools?.[tool.id]?.strength ?? 0;
            return (
              <Slider
                key={tool.id}
                label={tool.label}
                value={strength}
                min={0}
                max={100}
                display={formatInteger(strength)}
                idle={strength === 0}
                onChange={(next, continuing) =>
                  void setPortraitTool(tool.id, next, continuing)
                }
                onReset={() => void setPortraitTool(tool.id, 0, false)}
              />
            );
          })}
          <p style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
            {TOOLS.find((tool) => (tools?.[tool.id]?.strength ?? 0) > 0)?.hint ??
              `Auto usa ${formatInteger(AUTO_STRENGTHS.skin)} de pele.`}
          </p>
        </>
      )}
    </PanelSection>
  );
}
