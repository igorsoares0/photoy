import { useEffect } from 'react';
import { useEditor } from '../store/editor';
import { errorCopy } from '../lib/errors';
import { formatBytes, formatDuration } from '../lib/format';
import { Button } from './Button';

/** Colour space names are technical terms, so they stay in English. */
const SPACE_LABEL: Record<string, string> = {
  srgb: 'sRGB',
  'display-p3': 'Display P3',
  'adobe-rgb': 'Adobe RGB',
};

/**
 * Failure copy in the fixed order: what happened, what is still intact, what to
 * do. The technical note stays monospace and separate from the prose.
 */
function ErrorCard(): React.JSX.Element | null {
  const error = useEditor((state) => state.error);
  const dismiss = useEditor((state) => state.dismissError);
  if (error === null) return null;

  const copy = errorCopy(error.code);
  return (
    <div
      style={{
        width: 360,
        background: 'var(--clay-surface-deep)',
        border: '1px solid var(--danger-border)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-panel-float)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 'var(--text-emphasis)', color: 'var(--fg-primary)' }}>
        {copy.headline}
      </span>
      <span
        style={{ fontSize: 'var(--text-label)', color: 'var(--fg-muted)', lineHeight: 'var(--leading-normal)' }}
      >
        {copy.body}
      </span>
      <span className="numeric" style={{ fontSize: 'var(--text-micro)', color: 'var(--clay-dim)' }}>
        {error.code}
        {error.detail !== undefined ? ` · ${error.detail}` : ''}
      </span>
      <button
        type="button"
        onClick={dismiss}
        style={{ alignSelf: 'flex-start', fontSize: 'var(--text-chip)', color: 'var(--fg-muted)' }}
      >
        Dispensar
      </button>
    </div>
  );
}

/** The engine reports, it does not narrate: what was written, where, how big. */
function ExportCard(): React.JSX.Element | null {
  const lastExport = useEditor((state) => state.lastExport);
  const dismiss = useEditor((state) => state.dismissExport);

  useEffect(() => {
    if (lastExport === null) return;
    const timer = window.setTimeout(dismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [lastExport, dismiss]);

  if (lastExport === null) return null;
  const fileName = lastExport.path.split(/[\\/]/).pop() ?? lastExport.path;

  return (
    <div
      style={{
        width: 360,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-panel-float)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 'var(--text-emphasis)', color: 'var(--fg-primary)' }}>
        Exportado
      </span>
      <span className="numeric" style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-muted)' }}>
        {fileName}
      </span>
      <span className="numeric" style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
        {SPACE_LABEL[lastExport.colorSpace] ?? lastExport.colorSpace} · {lastExport.bitDepth} bits ·{' '}
        {formatBytes(lastExport.bytesWritten)} · {formatDuration(lastExport.durationMs)}
      </span>
    </div>
  );
}

/**
 * The unfinished session from a previous run.
 *
 * Offered, never applied on its own: restoring behind the user's back would
 * replace whatever they opened this time. First person plural is used here
 * because the application acted on its own initiative.
 */
function RecoveryCard(): React.JSX.Element | null {
  const offer = useEditor((state) => state.recovery);
  const take = useEditor((state) => state.takeRecovery);
  const discard = useEditor((state) => state.discardRecovery);
  if (offer === null) return null;

  const when = new Date(offer.savedAt).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div
      style={{
        width: 360,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-panel-float)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 'var(--text-emphasis)', color: 'var(--fg-primary)' }}>
        Encontramos uma sessão não finalizada
      </span>
      <span
        style={{ fontSize: 'var(--text-label)', color: 'var(--fg-muted)', lineHeight: 'var(--leading-normal)' }}
      >
        O trabalho em {offer.fileName} foi salvo automaticamente e não chegou a um arquivo de
        projeto. Nada foi alterado até você decidir.
      </span>
      <span className="numeric" style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
        autosave {when}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="primary" height={30} onClick={() => void take()}>
          Restaurar
        </Button>
        <Button variant="ghost" height={30} onClick={() => void discard()}>
          Descartar
        </Button>
      </div>
    </div>
  );
}

export function Notices(): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute right-4 top-4 z-10 flex flex-col gap-2">
      <div className="pointer-events-auto">
        <RecoveryCard />
      </div>
      <div className="pointer-events-auto">
        <ErrorCard />
      </div>
      <div className="pointer-events-auto">
        <ExportCard />
      </div>
    </div>
  );
}
