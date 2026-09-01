import { useEffect, useState } from 'react';
import { useEditor } from '../store/editor';
import { formatDecimal, formatInteger } from '../lib/format';
import { PanelSection } from './PanelSection';

/** What the engine will clamp to anyway; saying so here avoids a silent snap. */
const MAX_SIDE = 30000;

/**
 * The enlargements section 23 asks for.
 *
 * Multiples of the size the stack currently produces, not of the file: a crop
 * before this is part of what is being enlarged, and doubling the file behind a
 * crop would mean something nobody asked for.
 */
const FACTORS = [2, 4] as const;

/**
 * The document's output size.
 *
 * A resize is a transformation like crop and rotate, not an export setting: it
 * goes into the edit stack, it can be undone, and the photograph underneath
 * keeps every pixel it arrived with. That is also why the fields read back from
 * the document rather than holding their own truth - undo has to be able to
 * move them.
 */
export function ResizePanel(): React.JSX.Element {
  // Numbers, not an object: a selector that builds one returns a new reference
  // every call and the store never stops re-rendering.
  const width = useEditor((state) => state.history?.width ?? 0);
  const height = useEditor((state) => state.history?.height ?? 0);
  const applyEdit = useEditor((state) => state.applyEdit);

  const [locked, setLocked] = useState(true);
  const [draft, setDraft] = useState<{ width: string; height: string } | null>(null);

  // Whatever the stack says wins; a crop or an undo moves these under the user.
  useEffect(() => setDraft(null), [width, height]);

  const shown = draft ?? { width: String(width), height: String(height) };
  const ratio = height > 0 ? width / height : 1;
  const clamp = (value: number) => Math.max(1, Math.min(MAX_SIDE, Math.round(value)));

  const edit = (axis: 'width' | 'height', text: string) => {
    const next = { ...shown, [axis]: text };
    const parsed = Number.parseInt(text, 10);
    if (locked && Number.isFinite(parsed) && parsed > 0 && ratio > 0) {
      next[axis === 'width' ? 'height' : 'width'] = String(
        clamp(axis === 'width' ? parsed / ratio : parsed * ratio),
      );
    }
    setDraft(next);
  };

  const commit = () => {
    if (draft === null) return;
    const nextWidth = clamp(Number.parseInt(draft.width, 10));
    const nextHeight = clamp(Number.parseInt(draft.height, 10));
    if (!Number.isFinite(nextWidth) || !Number.isFinite(nextHeight)) {
      setDraft(null);
      return;
    }
    if (nextWidth === width && nextHeight === height) {
      setDraft(null);
      return;
    }
    void applyEdit({ kind: 'resize', width: nextWidth, height: nextHeight });
  };

  const field = (axis: 'width' | 'height', label: string) => (
    <label className="flex flex-1 items-center" style={{ gap: 6 }}>
      <span style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>{label}</span>
      <input
        type="number"
        min={1}
        max={MAX_SIDE}
        value={shown[axis]}
        onChange={(event) => edit(axis, event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft(null);
        }}
        className="photoy-number"
        aria-label={axis === 'width' ? 'Largura em pixels' : 'Altura em pixels'}
      />
    </label>
  );

  const megapixels = (width * height) / 1e6;

  const scaleBy = (factor: number) => {
    const nextWidth = clamp(width * factor);
    const nextHeight = clamp(height * factor);
    if (nextWidth === width && nextHeight === height) return;
    void applyEdit({ kind: 'resize', width: nextWidth, height: nextHeight });
  };

  return (
    <PanelSection
      label="Tamanho"
      hint={
        <button
          type="button"
          onClick={() => setLocked(!locked)}
          className="photoy-mini"
          style={{ width: 'auto', padding: '0 6px', color: locked ? 'var(--fg-primary)' : undefined }}
          aria-pressed={locked}
          aria-label="Travar proporção"
        >
          {locked ? 'proporção travada' : 'proporção livre'}
        </button>
      }
    >
      <div className="flex items-center" style={{ gap: 'var(--gap-inline)' }}>
        {field('width', 'L')}
        <span style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>×</span>
        {field('height', 'A')}
      </div>
      <div className="flex items-center" style={{ gap: 'var(--gap-inline)' }}>
        {FACTORS.map((factor) => (
          <button
            key={factor}
            type="button"
            className="photoy-mini"
            style={{ width: 'auto', padding: '0 8px' }}
            onClick={() => scaleBy(factor)}
            disabled={width * factor > MAX_SIDE || height * factor > MAX_SIDE}
          >
            {factor}×
          </button>
        ))}
        <span style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
          ampliar
        </span>
      </div>
      <span className="numeric" style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
        {formatInteger(width)} × {formatInteger(height)} px · {formatDecimal(megapixels, 1)} MP
      </span>
    </PanelSection>
  );
}
