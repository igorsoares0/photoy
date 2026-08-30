import { useEditor } from '../store/editor';
import { Button } from './Button';
import { IconButton } from './IconButton';

/** Room reserved on the right for the Windows caption buttons Electron draws. */
const CAPTION_INSET = 148;

export function TitleBar({ onExport }: { onExport: () => void }): React.JSX.Element {
  const document = useEditor((state) => state.document);
  const busy = useEditor((state) => state.busy);
  const openDialog = useEditor((state) => state.openDialog);
  const canUndo = useEditor((state) => state.history?.canUndo ?? false);
  const canRedo = useEditor((state) => state.history?.canRedo ?? false);
  const hasEdits = useEditor((state) => (state.history?.entries.length ?? 0) > 0);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const resetEdits = useEditor((state) => state.resetEdits);

  return (
    <header
      className="flex shrink-0 items-center gap-3"
      style={{
        height: 'var(--h-titlebar)',
        background: 'var(--surface-chrome)',
        borderBottom: '1px solid var(--border-hairline)',
        paddingLeft: 14,
        paddingRight: CAPTION_INSET,
        // The bar is the window drag handle; controls opt back out below.
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <span
        style={{
          fontSize: 'var(--text-title)',
          fontWeight: 'var(--weight-medium)' as unknown as number,
          color: 'var(--fg-primary)',
          letterSpacing: '-0.01em',
        }}
      >
        Photoy
      </span>

      <span
        className="truncate"
        style={{ fontSize: 'var(--text-emphasis)', color: 'var(--fg-muted)' }}
      >
        {document?.image.fileName ?? ''}
      </span>

      <div
        className="ml-auto flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* History sits next to the file it belongs to, not in the tool rail:
            these act on the document, not on the pixels under the cursor. */}
        <IconButton icon="undo" title="Desfazer" disabled={!canUndo} onClick={() => void undo()} />
        <IconButton icon="redo" title="Refazer" disabled={!canRedo} onClick={() => void redo()} />
        <IconButton
          icon="reset"
          title="Descartar todas as edições"
          disabled={!hasEdits}
          onClick={() => void resetEdits()}
        />
        <span style={{ width: 1, height: 18, background: 'var(--border-quiet)' }} />
        <Button height={30} onClick={() => void openDialog()} disabled={busy === 'opening'}>
          Abrir
        </Button>
        <Button
          height={30}
          variant="primary"
          onClick={onExport}
          disabled={document === null || busy !== null}
        >
          Exportar
        </Button>
      </div>
    </header>
  );
}
