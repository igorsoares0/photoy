import { useEditor } from '../store/editor';
import { useLibrary } from '../store/library';
import { RecentFiles } from './RecentFiles';

/**
 * The empty canvas is a dashed well with an instruction and a monospace hint.
 * No stock photography, no illustration, no drawn scene: the only image in this
 * product is the user's own.
 */
export function EmptyState({ dragging }: { dragging: boolean }): React.JSX.Element {
  const openDialog = useEditor((state) => state.openDialog);
  const chooseFolder = useLibrary((state) => state.chooseFolder);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 p-10">
      <button
        type="button"
        onClick={() => void openDialog()}
        className="flex flex-col items-center justify-center gap-2"
        style={{
          width: 'min(520px, 78%)',
          height: 'min(300px, 62%)',
          border: `1px dashed ${dragging ? 'var(--accent-border)' : 'var(--border-subtle)'}`,
          borderRadius: 'var(--radius-panel)',
          background: dragging ? 'var(--surface-hover)' : 'transparent',
          transition: 'var(--transition-control)',
        }}
      >
        <span style={{ fontSize: 'var(--text-control)', color: 'var(--fg-secondary)' }}>
          {dragging ? 'Solte para abrir' : 'Arraste uma foto ou clique para abrir'}
        </span>
        <span
          className="numeric"
          style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-numeric-idle)' }}
        >
          jpg · png · tiff · webp · raw · heic
        </span>
      </button>

      {/* A folder is what most people have before they have a photograph, so
          the other door is offered beside this one rather than behind a menu. */}
      <button
        type="button"
        onClick={() => void chooseFolder()}
        className="photoy-mini"
        style={{ width: 'auto', padding: '0 10px', height: 26 }}
      >
        ou abra uma pasta inteira
      </button>

      <div style={{ width: 'min(520px, 78%)' }}>
        <RecentFiles />
      </div>
    </div>
  );
}
