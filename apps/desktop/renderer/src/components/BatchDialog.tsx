import { useEffect, useState } from 'react';
import type { ExportFormat, OutputSpace } from '@photoy/types';
import { currentAdjustments, useEditor } from '../store/editor';
import { useLibrary } from '../store/library';
import { formatInteger } from '../lib/format';
import { fileName, shorten } from '../lib/library';
import { Button } from './Button';
import { SegmentedControl } from './SegmentedControl';
import { Slider } from './Slider';

const FORMATS: ReadonlyArray<{ value: ExportFormat; label: string }> = [
  { value: 'jpeg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'tiff', label: 'TIFF' },
  { value: 'webp', label: 'WebP' },
];

const SPACES: ReadonlyArray<{ value: OutputSpace; label: string }> = [
  { value: 'srgb', label: 'sRGB' },
  { value: 'display-p3', label: 'Display P3' },
  { value: 'adobe-rgb', label: 'Adobe RGB' },
];

const LOSSY: ReadonlySet<ExportFormat> = new Set<ExportFormat>(['jpeg', 'webp']);

/** The sizes a gallery or a client actually asks for. */
const SIZES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'full', label: 'original' },
  { value: '2048', label: '2048' },
  { value: '1600', label: '1600' },
  { value: '1080', label: '1080' },
];

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--gap-inline)' }}>
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}

/**
 * One look, many photographs.
 *
 * The adjustments come from the photograph that is open, which is the whole
 * workflow this exists for: edit one until it is right, then say "the other
 * hundred like this one". Nothing is applied to the originals - each file is
 * opened, exported to the target folder and closed.
 */
export function BatchDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const selection = useLibrary((state) => state.selection);
  const settings = useLibrary((state) => state.settings);
  const batch = useLibrary((state) => state.batch);
  const updateSettings = useLibrary((state) => state.updateSettings);
  const runBatch = useLibrary((state) => state.runBatch);
  const cancelBatch = useLibrary((state) => state.cancelBatch);
  const dismissBatch = useLibrary((state) => state.dismissBatch);
  const adjustments = useEditor(currentAdjustments);
  const hasDocument = useEditor((state) => state.document !== null);
  const [failuresOpen, setFailuresOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape closes the dialog, but never a run: stopping a batch is a
      // decision with files already on disk behind it, and it has its own button.
      if (event.key === 'Escape' && !batch.running) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, batch.running]);

  const chooseDirectory = async () => {
    const picked = await window.photoy.chooseBatchDirectory();
    if (picked.ok && picked.value !== null) updateSettings({ targetDirectory: picked.value });
  };

  const items = batch.items;
  const failures = items?.filter((item) => item.outcome === 'failed') ?? [];
  const ready = settings.targetDirectory !== null && selection.length > 0;

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center"
      style={{
        background: 'color-mix(in srgb, var(--surface-app) 66%, transparent)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={() => {
        if (!batch.running) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Exportar em lote"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 392,
          maxHeight: '86%',
          overflowY: 'auto',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-panel)',
          boxShadow: 'var(--shadow-dialog)',
          padding: 'var(--pad-panel)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--gap-group)',
        }}
      >
        <div className="flex flex-col gap-1">
          <span
            style={{
              fontSize: 'var(--text-title)',
              fontWeight: 'var(--weight-medium)' as unknown as number,
              color: 'var(--fg-primary)',
            }}
          >
            Exportar em lote
          </span>
          <span className="numeric" style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-ghost)' }}>
            {formatInteger(selection.length)} fotos selecionadas
          </span>
        </div>

        {items !== null ? (
          <div className="flex flex-col" style={{ gap: 'var(--gap-control)' }}>
            <span style={{ fontSize: 'var(--text-control)', color: 'var(--fg-secondary)' }}>
              {formatInteger(items.filter((item) => item.outcome === 'exported').length)} exportadas
              {failures.length > 0 ? `, ${formatInteger(failures.length)} com erro` : ''}
              {batch.cancelled ? ', o restante cancelado' : ''}.
            </span>
            {failures.length > 0 ? (
              <>
                <button
                  type="button"
                  className="photoy-mini"
                  style={{ width: 'auto', padding: '0 8px' }}
                  onClick={() => setFailuresOpen(!failuresOpen)}
                >
                  {failuresOpen ? 'ocultar' : 'ver o que falhou'}
                </button>
                {failuresOpen ? (
                  <div
                    className="flex flex-col overflow-y-auto"
                    style={{ gap: 4, maxHeight: 160, paddingRight: 4 }}
                  >
                    {failures.map((item) => (
                      <div key={item.path} className="flex flex-col">
                        <span
                          className="truncate"
                          style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-primary)' }}
                          title={item.path}
                        >
                          {fileName(item.path)}
                        </span>
                        <span style={{ fontSize: 'var(--text-micro)', color: 'var(--danger)' }}>
                          {item.error}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            <Button
              variant="primary"
              height={34}
              fullWidth
              onClick={() => {
                dismissBatch();
                onClose();
              }}
            >
              Pronto
            </Button>
          </div>
        ) : batch.running ? (
          <div className="flex flex-col" style={{ gap: 'var(--gap-control)' }}>
            <span className="numeric" style={{ fontSize: 'var(--text-control)', color: 'var(--fg-primary)' }}>
              {formatInteger(batch.done)} de {formatInteger(batch.total)}
            </span>
            {/* A real fraction, because there is one to report: a batch knows
                how many files it has and how many it has finished. */}
            <span
              className="relative block"
              style={{ height: 2, background: 'var(--border-subtle)', borderRadius: 'var(--radius-hairline)' }}
            >
              <span
                className="absolute left-0 top-0"
                style={{
                  height: 2,
                  width: `${batch.total === 0 ? 0 : (batch.done / batch.total) * 100}%`,
                  background: 'var(--fg-primary)',
                  borderRadius: 'var(--radius-hairline)',
                  transition: 'var(--transition-control)',
                }}
              />
            </span>
            <span
              className="truncate"
              style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-muted)' }}
              title={batch.current ?? ''}
            >
              {batch.current === null ? '…' : fileName(batch.current)}
            </span>
            <Button variant="danger" height={32} fullWidth onClick={() => void cancelBatch()}>
              Parar depois desta
            </Button>
          </div>
        ) : (
          <>
            <Field label="Destino">
              <button
                type="button"
                onClick={() => void chooseDirectory()}
                className="photoy-layer-row flex w-full items-center"
                style={{
                  height: 30,
                  padding: '0 10px',
                  borderRadius: 'var(--radius-row)',
                  border: '1px solid var(--border-quiet)',
                  textAlign: 'left',
                }}
                title={settings.targetDirectory ?? undefined}
              >
                <span
                  className="flex-1 truncate"
                  style={{
                    fontSize: 'var(--text-control)',
                    color:
                      settings.targetDirectory === null ? 'var(--fg-numeric-idle)' : 'var(--fg-primary)',
                  }}
                >
                  {settings.targetDirectory === null
                    ? 'Escolher pasta…'
                    : shorten(settings.targetDirectory)}
                </span>
              </button>
            </Field>

            <Field label="Formato">
              <SegmentedControl<ExportFormat>
                options={FORMATS}
                value={settings.format}
                onChange={(format) => updateSettings({ format })}
              />
            </Field>

            {LOSSY.has(settings.format) ? (
              <Slider
                label="Qualidade"
                value={settings.quality}
                min={1}
                max={100}
                display={`${settings.quality} %`}
                onChange={(quality) => updateSettings({ quality })}
              />
            ) : null}

            <Field label="Tamanho máximo">
              <SegmentedControl<string>
                options={SIZES}
                value={settings.maxSide === null ? 'full' : String(settings.maxSide)}
                onChange={(value) =>
                  updateSettings({ maxSide: value === 'full' ? null : Number(value) })
                }
              />
            </Field>

            <Field label="Espaço de cor">
              <SegmentedControl<OutputSpace>
                options={SPACES}
                value={settings.colorSpace}
                onChange={(colorSpace) => updateSettings({ colorSpace })}
              />
            </Field>

            <label className="flex cursor-default items-center gap-2" style={{ opacity: hasDocument ? 1 : 0.42 }}>
              <input
                type="checkbox"
                checked={settings.applyAdjustments && hasDocument}
                disabled={!hasDocument}
                onChange={(event) => updateSettings({ applyAdjustments: event.target.checked })}
                className="photoy-checkbox"
              />
              <span style={{ fontSize: 'var(--text-control)', color: 'var(--fg-secondary)' }}>
                Aplicar os ajustes da foto aberta
              </span>
            </label>
            {!hasDocument ? (
              <span style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-numeric-idle)' }}>
                Nenhuma foto aberta: as originais serão exportadas como estão.
              </span>
            ) : null}

            <div className="flex flex-col" style={{ gap: 'var(--gap-inline)' }}>
              <Button
                variant="primary"
                height={34}
                fullWidth
                disabled={!ready}
                onClick={() => void runBatch(hasDocument ? adjustments : null, 'Lote')}
              >
                {settings.targetDirectory === null
                  ? 'Escolha a pasta de destino'
                  : `Exportar ${formatInteger(selection.length)}`}
              </Button>
              <Button variant="ghost" height={30} fullWidth onClick={onClose}>
                Cancelar
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
