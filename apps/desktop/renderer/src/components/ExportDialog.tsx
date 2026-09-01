import { useEffect, useMemo, useState } from 'react';
import type { ExportFormat, OutputSpace } from '@photoy/types';
import { useEditor } from '../store/editor';
import { formatDimensions } from '../lib/format';
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

/** Only these two encoders read the quality value; the others are lossless. */
const LOSSY: ReadonlySet<ExportFormat> = new Set<ExportFormat>(['jpeg', 'webp']);

/** Only these two containers can carry more than 8 bits per channel. */
const DEEP: ReadonlySet<ExportFormat> = new Set<ExportFormat>(['png', 'tiff']);

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--gap-inline)' }}>
      <span className="eyebrow">{label}</span>
      {children}
    </div>
  );
}

function Checkbox({
  checked,
  onChange,
  disabled = false,
  children,
}: {
  checked: boolean;
  onChange(next: boolean): void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex cursor-default items-center gap-2" style={{ opacity: disabled ? 0.42 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="photoy-checkbox"
      />
      <span style={{ fontSize: 'var(--text-control)', color: 'var(--fg-secondary)' }}>{children}</span>
    </label>
  );
}

export function ExportDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const document = useEditor((state) => state.document);
  const busy = useEditor((state) => state.busy);
  const exportImage = useEditor((state) => state.exportImage);

  const [format, setFormat] = useState<ExportFormat>('jpeg');
  const [quality, setQuality] = useState(92);
  const [colorSpace, setColorSpace] = useState<OutputSpace>('srgb');
  const [sixteenBit, setSixteenBit] = useState(false);
  const [preserveMetadata, setPreserveMetadata] = useState(true);

  // Sixteen bits are only offered when the source has depth worth keeping:
  // writing them from an 8-bit JPEG doubles the file and adds nothing.
  const canGoDeep = DEEP.has(format) && (document?.image.bitDepth ?? 8) > 8;

  useEffect(() => {
    setSixteenBit(canGoDeep);
  }, [canGoDeep]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const losslessNote = useMemo(() => {
    if (format === 'png') return 'PNG é sempre sem perdas.';
    return 'TIFF é gravado sem perdas, com deflate.';
  }, [format]);

  if (document === null) return <></>;

  const run = async () => {
    await exportImage({ format, quality, colorSpace, sixteenBit, preserveMetadata });
    onClose();
  };

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center"
      style={{
        background: 'color-mix(in srgb, var(--surface-app) 66%, transparent)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Exportar imagem"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 364,
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
            Exportar
          </span>
          <span className="numeric" style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-ghost)' }}>
            {formatDimensions(document.image.width, document.image.height)}
          </span>
        </div>

        <div className="flex flex-col" style={{ gap: 'var(--gap-control)' }}>
          <Field label="Formato">
            <SegmentedControl<ExportFormat> options={FORMATS} value={format} onChange={setFormat} />
          </Field>

          {LOSSY.has(format) ? (
            <Slider
              label="Qualidade"
              value={quality}
              min={1}
              max={100}
              display={format === 'webp' && quality === 100 ? 'sem perdas' : `${quality} %`}
              onChange={setQuality}
            />
          ) : (
            <span style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-numeric-idle)' }}>
              {losslessNote}
            </span>
          )}
        </div>

        <div className="flex flex-col" style={{ gap: 'var(--gap-control)' }}>
          <Field label="Espaço de cor">
            <SegmentedControl<OutputSpace>
              options={SPACES}
              value={colorSpace}
              onChange={setColorSpace}
            />
          </Field>

          <Checkbox checked={sixteenBit && canGoDeep} onChange={setSixteenBit} disabled={!canGoDeep}>
            16 bits por canal
          </Checkbox>

          {!canGoDeep && DEEP.has(format) ? (
            <span style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-numeric-idle)' }}>
              O original tem {document.image.bitDepth} bits — não há profundidade a preservar.
            </span>
          ) : null}
        </div>

        <Checkbox checked={preserveMetadata} onChange={setPreserveMetadata}>
          Preservar metadados EXIF
        </Checkbox>

        <div className="flex flex-col" style={{ gap: 'var(--gap-inline)' }}>
          <Button variant="primary" height={34} fullWidth onClick={() => void run()} disabled={busy !== null}>
            {busy === 'exporting' ? 'Exportando' : 'Escolher destino e exportar'}
          </Button>
          <Button variant="ghost" height={30} fullWidth onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
