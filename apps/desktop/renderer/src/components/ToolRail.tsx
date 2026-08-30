import { useEditor } from '../store/editor';
import { IconButton } from './IconButton';

/**
 * The tool rail: fixed to the left, always present.
 *
 * These are actions rather than modes, so nothing here takes a selected state.
 * The selected-tool treatment arrives with the tools that have one.
 */
export function ToolRail(): React.JSX.Element {
  const document = useEditor((state) => state.document);
  const applyEdit = useEditor((state) => state.applyEdit);
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
