import { useEditor } from '../store/editor';
import { formatBytes, formatDimensions, formatZoom } from '../lib/format';

const BUSY_LABEL: Record<string, string> = {
  opening: 'abrindo',
  rendering: 'renderizando',
  exporting: 'exportando',
  segmenting: 'selecionando',
  filling: 'preenchendo',
};

function Badge({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span
      className="numeric"
      style={{
        fontSize: 'var(--text-micro)',
        color: 'var(--fg-faint)',
        border: '1px solid var(--border-quiet)',
        borderRadius: 'var(--radius-sm)',
        padding: '1px 5px',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </span>
  );
}

export function StatusBar(): React.JSX.Element {
  const document = useEditor((state) => state.document);
  const editCount = useEditor((state) => state.history?.cursor ?? 0);
  const width = useEditor((state) => state.history?.width ?? state.document?.image.width ?? 0);
  const height = useEditor((state) => state.history?.height ?? state.document?.image.height ?? 0);
  const viewport = useEditor((state) => state.viewport);
  const busy = useEditor((state) => state.busy);
  const engineState = useEditor((state) => state.engineState);

  return (
    <footer
      className="flex shrink-0 items-center gap-3 px-3"
      style={{
        height: 'var(--h-statusbar)',
        background: 'var(--surface-chrome)',
        borderTop: '1px solid var(--border-hairline)',
        fontSize: 'var(--text-meta)',
        color: 'var(--fg-ghost)',
      }}
    >
      {document !== null ? (
        <>
          <Badge>{document.image.format}</Badge>
          <span className="numeric">{formatDimensions(width, height)}</span>
          <span className="numeric">{formatBytes(document.image.fileSize)}</span>
          <span className="numeric">{document.image.bitDepth} bits</span>
          {document.image.hasAlpha ? <span>alfa</span> : null}
          {editCount > 0 ? (
            <span className="numeric" style={{ color: 'var(--fg-muted)' }}>
              {editCount} {editCount === 1 ? 'edição' : 'edições'}
            </span>
          ) : null}
          {/* An assumption is stated as one: an untagged file is read as sRGB,
              and saying so is cheaper than a surprise later. */}
          <span
            className="numeric"
            style={{ color: document.image.tagged ? 'var(--fg-ghost)' : 'var(--fg-numeric-idle)' }}
            title={document.image.tagged ? document.image.sourceProfile : 'Arquivo sem perfil ICC'}
          >
            {document.image.tagged ? document.image.sourceProfile : 'sRGB assumido'}
          </span>
        </>
      ) : (
        <span>Nenhuma imagem aberta</span>
      )}

      <span className="ml-auto flex items-center gap-3">
        {busy !== null ? (
          <span className="numeric" style={{ color: 'var(--fg-numeric-idle)' }}>
            {BUSY_LABEL[busy] ?? busy}
          </span>
        ) : null}
        {engineState !== 'ready' ? (
          <span className="numeric" style={{ color: 'var(--danger)' }}>
            motor · {engineState}
          </span>
        ) : null}
        {document !== null ? <span className="numeric">{formatZoom(viewport.scale)}</span> : null}
      </span>
    </footer>
  );
}
