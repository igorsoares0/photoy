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
  const projectPath = useEditor((state) => state.projectPath);
  const dirty = useEditor((state) => state.dirty);
  const saveProject = useEditor((state) => state.saveProject);

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

      {/* The project's name when there is one, the photograph's when there is
          not — and a dot for work the saved file does not yet contain. */}
      <span
        className="flex min-w-0 items-center gap-2"
        style={{ fontSize: 'var(--text-emphasis)', color: 'var(--fg-muted)' }}
      >
        <span className="truncate">
          {projectPath !== null
            ? (projectPath.split(/[\\/]/).pop() ?? '')
            : (document?.image.fileName ?? '')}
        </span>
        {dirty && document !== null ? (
          <span
            title="Há alterações não salvas"
            style={{
              width: 5,
              height: 5,
              borderRadius: 'var(--radius-round)',
              background: 'var(--fg-faint)',
              flex: 'none',
            }}
          />
        ) : null}
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
          onClick={() => void saveProject()}
          disabled={document === null || busy !== null}
        >
          Salvar
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
