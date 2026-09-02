import { useEffect, useMemo } from 'react';
import { useEditor } from '../store/editor';
import { useLibrary, useVisibleEntries } from '../store/library';
import { formatInteger } from '../lib/format';
import { fileName, shorten } from '../lib/library';
import { Button } from './Button';
import { Icon } from './Icon';
import { LibraryTile } from './LibraryTile';

/**
 * The folder, as a contact sheet.
 *
 * This is the whole of the V1's organisation: a folder, its photographs, a
 * search box and a mark. Nothing is imported and nothing is indexed - the spec
 * rules out a catalogue, and what it asks for instead is exactly this.
 */
export function LibraryView({ onOpenBatch }: { onOpenBatch(): void }): React.JSX.Element {
  const folder = useLibrary((state) => state.folder);
  const loading = useLibrary((state) => state.loading);
  const error = useLibrary((state) => state.error);
  const query = useLibrary((state) => state.query);
  const onlyFavourites = useLibrary((state) => state.onlyFavourites);
  const selection = useLibrary((state) => state.selection);
  const recentFolders = useLibrary((state) => state.recentFolders);
  const entries = useVisibleEntries();

  const chooseFolder = useLibrary((state) => state.chooseFolder);
  const openFolder = useLibrary((state) => state.openFolder);
  const loadRecentFolders = useLibrary((state) => state.loadRecentFolders);
  const setQuery = useLibrary((state) => state.setQuery);
  const setOnlyFavourites = useLibrary((state) => state.setOnlyFavourites);
  const toggleSelected = useLibrary((state) => state.toggleSelected);
  const selectAll = useLibrary((state) => state.selectAll);
  const clearSelection = useLibrary((state) => state.clearSelection);
  const openPath = useEditor((state) => state.openPath);
  // A set, because a tile asking an array whether it is selected is a scan per
  // tile, and a folder may hold two thousand of them.
  const selected = useMemo(() => new Set(selection), [selection]);

  useEffect(() => {
    void loadRecentFolders();
  }, [loadRecentFolders]);

  const total = folder?.entries.length ?? 0;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--surface-app)' }}>
      <div
        className="flex shrink-0 items-center"
        style={{
          height: 44,
          padding: '0 var(--pad-panel)',
          gap: 'var(--gap-inline)',
          borderBottom: '1px solid var(--border-hairline)',
        }}
      >
        <Button onClick={() => void chooseFolder()}>Abrir pasta</Button>
        {folder !== null ? (
          <>
            <span
              className="truncate"
              title={folder.path}
              style={{ fontSize: 'var(--text-control)', color: 'var(--fg-secondary)', maxWidth: 260 }}
            >
              {shorten(folder.path)}
            </span>
            <span
              className="numeric"
              style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-numeric-idle)' }}
            >
              {entries.length === total
                ? `${formatInteger(total)} fotos`
                : `${formatInteger(entries.length)} de ${formatInteger(total)}`}
              {folder.skipped > 0 ? ` · ${formatInteger(folder.skipped)} ignorados` : ''}
            </span>
          </>
        ) : null}

        <div className="flex-1" />

        {folder !== null ? (
          <>
            <label
              className="flex items-center"
              style={{
                gap: 6,
                height: 28,
                padding: '0 8px',
                border: '1px solid var(--border-quiet)',
                borderRadius: 'var(--radius-control)',
              }}
            >
              <span style={{ color: 'var(--fg-ghost)' }}>
                <Icon name="search" size={13} />
              </span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome"
                className="bg-transparent outline-none"
                style={{ width: 150, fontSize: 'var(--text-control)', color: 'var(--fg-primary)' }}
              />
            </label>
            <button
              type="button"
              onClick={() => setOnlyFavourites(!onlyFavourites)}
              title="Só as favoritas"
              className="photoy-mini flex items-center justify-center"
              style={{
                width: 28,
                height: 28,
                color: onlyFavourites ? 'var(--accent-text)' : 'var(--fg-muted)',
              }}
            >
              <Icon name="star" size={14} />
            </button>
          </>
        ) : null}
      </div>

      {selection.length > 0 ? (
        <div
          className="flex shrink-0 items-center"
          style={{
            height: 36,
            padding: '0 var(--pad-panel)',
            gap: 'var(--gap-inline)',
            background: 'var(--surface-chrome)',
            borderBottom: '1px solid var(--border-hairline)',
          }}
        >
          <span className="numeric" style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-secondary)' }}>
            {formatInteger(selection.length)} selecionadas
          </span>
          <button type="button" className="photoy-mini" style={{ width: 'auto', padding: '0 8px' }} onClick={selectAll}>
            todas
          </button>
          <button type="button" className="photoy-mini" style={{ width: 'auto', padding: '0 8px' }} onClick={clearSelection}>
            nenhuma
          </button>
          <div className="flex-1" />
          <Button onClick={onOpenBatch}>
            <span className="flex items-center" style={{ gap: 6 }}>
              <Icon name="stack" size={14} />
              Exportar em lote
            </span>
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: 'var(--pad-panel)' }}>
        {error !== null ? (
          <p style={{ fontSize: 'var(--text-control)', color: 'var(--danger)' }}>{error}</p>
        ) : null}

        {folder === null ? (
          <div className="flex flex-col items-center justify-center gap-4" style={{ paddingTop: 80 }}>
            <span style={{ fontSize: 'var(--text-control)', color: 'var(--fg-secondary)' }}>
              {loading ? 'Abrindo…' : 'Abra uma pasta para ver as fotos dela'}
            </span>
            {recentFolders.length > 0 ? (
              <div className="flex flex-col" style={{ gap: 'var(--gap-inline)', width: 'min(420px, 70%)' }}>
                <span className="eyebrow">Pastas recentes</span>
                {recentFolders.slice(0, 6).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    title={candidate}
                    onClick={() => void openFolder(candidate)}
                    className="photoy-layer-row flex w-full items-baseline gap-2"
                    style={{ height: 26, padding: '0 8px', borderRadius: 'var(--radius-row)', textAlign: 'left' }}
                  >
                    <span style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-faint)', width: 12 }}>
                      {'▤'}
                    </span>
                    <span
                      className="flex-1 truncate"
                      style={{ fontSize: 'var(--text-control)', color: 'var(--fg-primary)' }}
                    >
                      {shorten(candidate)}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : entries.length === 0 ? (
          <p style={{ fontSize: 'var(--text-control)', color: 'var(--fg-numeric-idle)' }}>
            {total === 0
              ? 'Nenhuma foto que este programa saiba abrir nesta pasta.'
              : 'Nada com esse nome.'}
          </p>
        ) : (
          <div
            className="grid"
            style={{
              gap: 'var(--gap-control)',
              gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
            }}
          >
            {entries.map((entry) => (
              <LibraryTile
                key={entry.path}
                entry={entry}
                selected={selected.has(entry.path)}
                onOpen={() => void openPath(entry.path)}
                onSelect={(extend) => toggleSelected(entry.path, extend)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
