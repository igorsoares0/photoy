import { useEditor } from '../store/editor';
import { IconButton } from './IconButton';

/**
 * The tool rail: fixed to the left, always present.
 *
 * Rotating and flipping are actions - they happen and they are done. Cropping is
 * a mode, and it is the only thing here that carries a selected state.
 */
export function ToolRail(): React.JSX.Element {
  const document = useEditor((state) => state.document);
  const applyEdit = useEditor((state) => state.applyEdit);
  const cropping = useEditor((state) => state.cropRect !== null);
  const beginCrop = useEditor((state) => state.beginCrop);
  const cancelCrop = useEditor((state) => state.cancelCrop);
  const disabled = document === null;

  return (
    <aside
      className="flex shrink-0 flex-col items-center gap-1 pt-2"
      style={{
        width: 'var(--w-tool-rail)',
        background: 'var(--surface-chrome)',
        borderRight: '1px solid var(--border-hairline)',
      }}
    >
      <IconButton
        icon="crop"
        title="Recortar"
        size={36}
        selected={cropping}
        disabled={disabled}
        onClick={() => (cropping ? cancelCrop() : beginCrop())}
      />
      <span style={{ width: 22, height: 1, background: 'var(--border-hairline)', margin: '5px 0' }} />
      <IconButton
        icon="rotateCcw"
        title="Girar à esquerda"
        size={36}
        disabled={disabled}
        onClick={() => void applyEdit({ kind: 'rotate', quarters: 3 })}
      />
      <IconButton
        icon="rotateCw"
        title="Girar à direita"
        size={36}
        disabled={disabled}
        onClick={() => void applyEdit({ kind: 'rotate', quarters: 1 })}
      />
      <IconButton
        icon="flipHorizontal"
        title="Espelhar na horizontal"
        size={36}
        disabled={disabled}
        onClick={() => void applyEdit({ kind: 'flipHorizontal' })}
      />
      <IconButton
        icon="flipVertical"
        title="Espelhar na vertical"
        size={36}
        disabled={disabled}
        onClick={() => void applyEdit({ kind: 'flipVertical' })}
      />
    </aside>
  );
}
