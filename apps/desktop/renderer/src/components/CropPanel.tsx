import { renderedSize, useEditor } from '../store/editor';
import { formatDimensions } from '../lib/format';
import { applyAspect, clampRect } from '../lib/viewport';
import { Button } from './Button';
import { PanelSection } from './PanelSection';

/** Ratios are written landscape; the tool matches them to the crop's own shape. */
const RATIOS: Array<{ label: string; value: number | null }> = [
  { label: 'Livre', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: '5:4', value: 5 / 4 },
];

export function CropPanel(): React.JSX.Element {
  const cropRect = useEditor((state) => state.cropRect);
  const cropAspect = useEditor((state) => state.cropAspect);
  const setCropRect = useEditor((state) => state.setCropRect);
  const setCropAspect = useEditor((state) => state.setCropAspect);
  const confirmCrop = useEditor((state) => state.confirmCrop);
  const cancelCrop = useEditor((state) => state.cancelCrop);
  const width = useEditor((state) => renderedSize(state)?.width ?? 0);
  const height = useEditor((state) => renderedSize(state)?.height ?? 0);

  if (cropRect === null || width === 0) return <></>;
  const size = { width, height };

  const choose = (ratio: number | null) => {
    if (ratio === null) {
      setCropAspect(null);
      return;
    }
    // Match the ratio to the shape the crop already has, so picking 3:2 on a
    // portrait frame gives 2:3 rather than turning it sideways.
    const aspect = cropRect.width >= cropRect.height ? ratio : 1 / ratio;
    setCropAspect(aspect);
    setCropRect(clampRect(applyAspect(cropRect, aspect, cropRect.x, cropRect.y), size));
  };

  const matches = (ratio: number | null) => {
    if (ratio === null) return cropAspect === null;
    if (cropAspect === null) return false;
    return Math.abs(cropAspect - ratio) < 1e-6 || Math.abs(cropAspect - 1 / ratio) < 1e-6;
  };

  return (
    <div className="flex flex-1 flex-col" style={{ padding: 'var(--pad-panel)', gap: 'var(--gap-group)' }}>
      <PanelSection
        label="Proporção"
        hint={
          <span className="numeric" style={{ fontSize: 'var(--text-meta)', color: 'var(--fg-ghost)' }}>
            {formatDimensions(Math.round(cropRect.width), Math.round(cropRect.height))}
          </span>
        }
      >
        <div className="flex flex-wrap" style={{ gap: 'var(--gap-inline)' }}>
          {RATIOS.map((ratio) => {
            const selected = matches(ratio.value);
            return (
              <button
                key={ratio.label}
                type="button"
                onClick={() => choose(ratio.value)}
                className="photoy-chip"
                style={{
                  height: 26,
                  padding: '0 11px',
                  borderRadius: 'var(--radius-chip)',
                  fontSize: 'var(--text-chip)',
                  border: `1px solid ${selected ? 'var(--border-hover)' : 'var(--border-quiet)'}`,
                  background: selected ? 'var(--surface-active)' : 'transparent',
                  color: selected ? 'var(--fg-primary)' : 'var(--fg-muted)',
                  transition: 'var(--transition-control)',
                }}
              >
                {ratio.label}
              </button>
            );
          })}
        </div>
      </PanelSection>

      <span style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-numeric-idle)' }}>
        Arraste as alças para enquadrar. O original permanece intacto — o recorte entra como
        uma etapa reversível.
      </span>

      <div className="mt-auto flex flex-col" style={{ gap: 'var(--gap-inline)' }}>
        <Button variant="primary" height={34} fullWidth onClick={() => void confirmCrop()}>
          Aplicar recorte
        </Button>
        <Button variant="ghost" height={30} fullWidth onClick={cancelCrop}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
