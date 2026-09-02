import type { LibraryEntry } from '@photoy/types';
import { useEffect, useRef } from 'react';
import { useLibrary } from '../store/library';
import { Icon } from './Icon';

/**
 * One photograph in the grid.
 *
 * The thumbnail is asked for when the tile first comes into view, not when the
 * folder is listed: a folder of two thousand would otherwise decode two
 * thousand files to show the twenty that fit on screen.
 */
export function LibraryTile({
  entry,
  selected,
  onOpen,
  onSelect,
}: {
  entry: LibraryEntry;
  selected: boolean;
  onOpen(): void;
  onSelect(extend: boolean): void;
}): React.JSX.Element {
  const tile = useRef<HTMLDivElement>(null);
  const source = useLibrary((state) => state.thumbnails[entry.path]);
  const failed = useLibrary((state) => state.unreadable[entry.path] === true);
  const request = useLibrary((state) => state.requestThumbnail);
  const toggleFavourite = useLibrary((state) => state.toggleFavourite);

  useEffect(() => {
    const element = tile.current;
    if (element === null || source !== undefined || failed) return;
    // A generous margin, so scrolling at speed still lands on tiles that have
    // already asked rather than on empty frames.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((seen) => seen.isIntersecting)) {
          request(entry.path);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [entry.path, request, source, failed]);

  return (
    <div ref={tile} className="flex flex-col" style={{ gap: 4 }}>
      <button
        type="button"
        onDoubleClick={onOpen}
        onClick={(event) => onSelect(event.ctrlKey || event.metaKey || event.shiftKey)}
        title={`${entry.name}\nDuplo clique para abrir`}
        className="relative flex items-center justify-center overflow-hidden"
        style={{
          aspectRatio: '1 / 1',
          background: 'var(--surface-canvas-matte)',
          border: `1px solid ${selected ? 'var(--border-hover)' : 'var(--border-hairline)'}`,
          borderRadius: 'var(--radius-control)',
          // Selection is a surface plus a ring, never a solid fill: the same
          // rule the layer rows follow, and the picture has to stay readable.
          boxShadow: selected ? 'inset 0 0 0 1px var(--border-hover)' : 'none',
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
            {failed ? 'ilegível' : '…'}
          </span>
        )}

        <span
          role="button"
          tabIndex={-1}
          title={entry.favourite ? 'Desmarcar' : 'Marcar como favorita'}
          onClick={(event) => {
            event.stopPropagation();
            void toggleFavourite(entry.path);
          }}
          className="absolute flex items-center justify-center"
          style={{
            top: 4,
            right: 4,
            width: 22,
            height: 22,
            borderRadius: 'var(--radius-control)',
            background: 'color-mix(in srgb, var(--surface-app) 70%, transparent)',
            // Marked is said in colour, not in a filled shape: the icon set is
            // stroke-only and a filled star would be the one exception in it.
            color: entry.favourite ? 'var(--accent-text)' : 'var(--fg-ghost)',
          }}
        >
          <Icon name="star" size={13} />
        </span>
      </button>

      <span
        className="truncate"
        style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-muted)' }}
        title={entry.name}
      >
        {entry.name}
      </span>
    </div>
  );
}
