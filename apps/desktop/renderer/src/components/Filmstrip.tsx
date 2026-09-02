import { useEffect, useRef } from 'react';
import { useEditor } from '../store/editor';
import { useLibrary, useVisibleEntries } from '../store/library';

/**
 * The rest of the folder, under the photograph being edited.
 *
 * The reason it exists is the reason the library does: editing one photograph
 * and then going back to a folder to find the next one is the difference
 * between a tool and a program. Here the next one is a click away.
 */
export function Filmstrip(): React.JSX.Element | null {
  const entries = useVisibleEntries();
  const thumbnails = useLibrary((state) => state.thumbnails);
  const request = useLibrary((state) => state.requestThumbnail);
  const openPath = useEditor((state) => state.openPath);
  const current = useEditor((state) => state.document?.image.path ?? null);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // The strip is short, so everything in it is asked for at once rather than
    // watched into view: a folder's worth of tiles is the grid's problem, and
    // this is the row the person is already looking along.
    for (const entry of entries.slice(0, 200)) request(entry.path);
  }, [entries, request]);

  useEffect(() => {
    // The open photograph is brought into view, which is what makes the strip
    // usable after arriving from a search or from the recent list.
    strip.current?.querySelector('[data-current="true"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'center',
    });
  }, [current]);

  if (entries.length === 0) return null;

  return (
    <div
      ref={strip}
      className="flex shrink-0 items-center overflow-x-auto"
      style={{
        height: 'var(--h-filmstrip)',
        gap: 'var(--gap-inline)',
        padding: '0 var(--gap-control)',
        background: 'var(--surface-chrome)',
        borderTop: '1px solid var(--border-hairline)',
      }}
    >
      {entries.map((entry) => {
        const source = thumbnails[entry.path];
        const open = entry.path === current;
        return (
          <button
            key={entry.path}
            type="button"
            data-current={open}
            title={entry.name}
            onClick={() => void openPath(entry.path)}
            className="flex shrink-0 items-center justify-center overflow-hidden"
            style={{
              width: 62,
              height: 52,
              background: 'var(--surface-canvas-matte)',
              border: `1px solid ${open ? 'var(--border-hover)' : 'transparent'}`,
              borderRadius: 'var(--radius-control)',
              boxShadow: open ? 'inset 0 0 0 1px var(--border-hover)' : 'none',
              opacity: open ? 1 : 0.72,
              transition: 'var(--transition-control)',
            }}
          >
            {source !== undefined ? (
              <img
                src={source}
                alt=""
                className="max-h-full max-w-full"
                style={{ objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <span
                className="numeric"
                style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}
              >
                ·
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
