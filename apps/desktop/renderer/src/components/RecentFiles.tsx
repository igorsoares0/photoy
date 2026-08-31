import { useEffect } from 'react';
import { useEditor } from '../store/editor';

/** The file name, and enough of the folder above it to tell two apart. */
function describe(fullPath: string): { name: string; folder: string } {
  const parts = fullPath.split(/[\\/]/).filter((part) => part !== '');
  const name = parts.at(-1) ?? fullPath;
  const folder = parts.at(-2) ?? '';
  return { name, folder };
}

/**
 * What was opened before.
 *
 * Beside the drop well rather than inside it: the well is one target for one
 * gesture, and putting a list of buttons inside a button is neither valid
 * markup nor a thing anyone can aim at.
 */
export function RecentFiles(): React.JSX.Element | null {
  const recent = useEditor((state) => state.recent);
  const loadRecent = useEditor((state) => state.loadRecent);
  const openPath = useEditor((state) => state.openPath);

  useEffect(() => {
    void loadRecent();
  }, [loadRecent]);

  if (recent.length === 0) return null;

  return (
    <div className="flex w-full flex-col" style={{ gap: 'var(--gap-inline)' }}>
      <span className="eyebrow">Recentes</span>
      {recent.slice(0, 6).map((fullPath) => {
        const { name, folder } = describe(fullPath);
        return (
          <button
            key={fullPath}
            type="button"
            title={fullPath}
            onClick={() => void openPath(fullPath)}
            className="photoy-layer-row flex w-full items-baseline gap-2"
            style={{
              height: 26,
              padding: '0 8px',
              borderRadius: 'var(--radius-row)',
              textAlign: 'left',
            }}
          >
            <span
              className="flex-1 truncate"
              style={{ fontSize: 'var(--text-control)', color: 'var(--fg-primary)' }}
            >
              {name}
            </span>
            <span
              className="truncate"
              style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)', maxWidth: '45%' }}
            >
              {folder}
            </span>
          </button>
        );
      })}
    </div>
  );
}
