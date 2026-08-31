import { useEffect, useMemo, useState } from 'react';
import type { Preset, PresetCategory } from '@photoy/types';
import { BUILT_IN_PRESETS } from '@photoy/types';
import { currentAdjustments, useEditor } from '../store/editor';
import { PanelSection } from './PanelSection';

const CATEGORIES: Array<{ value: PresetCategory; label: string }> = [
  { value: 'colour', label: 'Cor' },
  { value: 'monochrome', label: 'P&B' },
  { value: 'cinematic', label: 'Cinema' },
  { value: 'portrait', label: 'Retrato' },
  { value: 'landscape', label: 'Paisagem' },
];

/**
 * Saved looks.
 *
 * A preset is edit parameters, never rendered pixels - which is what the edit
 * stack already is, so applying one is an ordinary operation and undo takes it
 * back like anything else.
 *
 * The shipped presets are a constant in the types package rather than rows in
 * the database: they travel with the version that defines them, cannot be lost,
 * and cannot be edited into something that no longer matches its name.
 */
export function PresetsPanel(): React.JSX.Element {
  const presets = useEditor((state) => state.presets);
  const loadPresets = useEditor((state) => state.loadPresets);
  const applyPreset = useEditor((state) => state.applyPreset);
  const savePreset = useEditor((state) => state.savePreset);
  const deletePreset = useEditor((state) => state.deletePreset);
  const values = useEditor(currentAdjustments);

  const [category, setCategory] = useState<PresetCategory>('colour');
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const shown = useMemo(
    () =>
      [...BUILT_IN_PRESETS, ...presets].filter((preset) => preset.category === category),
    [presets, category],
  );

  const touched = Object.values(values).some((value) => value !== 0);

  const commit = () => {
    void savePreset(draft, category);
    setDraft('');
    setNaming(false);
  };

  return (
    <PanelSection
      label="Predefinições"
      hint={
        <button
          type="button"
          onClick={() => setNaming(!naming)}
          disabled={!touched}
          className="photoy-mini"
          style={{ width: 'auto', padding: '0 6px' }}
          aria-label="Salvar os ajustes atuais como predefinição"
        >
          salvar
        </button>
      }
    >
      <div className="flex flex-wrap" style={{ gap: 'var(--gap-inline)' }}>
        {CATEGORIES.map((entry) => {
          const selected = category === entry.value;
          return (
            <button
              key={entry.value}
              type="button"
              onClick={() => setCategory(entry.value)}
              className="photoy-chip"
              style={{
                border: `1px solid ${selected ? 'var(--border-hover)' : 'var(--border-quiet)'}`,
                background: selected ? 'var(--surface-active)' : 'transparent',
                color: selected ? 'var(--fg-primary)' : 'var(--fg-secondary)',
              }}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {naming ? (
        <input
          autoFocus
          value={draft}
          placeholder="Nome da predefinição"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft('');
              setNaming(false);
            }
          }}
          className="photoy-number"
          style={{ textAlign: 'left', fontFamily: 'var(--font-sans)' }}
          aria-label="Nome da predefinição"
        />
      ) : null}

      {shown.length === 0 ? (
        <span style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
          Nenhuma predefinição aqui ainda.
        </span>
      ) : (
        <div className="flex flex-col" style={{ gap: 2 }}>
          {shown.map((preset: Preset) => (
            <div
              key={preset.id}
              className="photoy-layer-row flex w-full items-center gap-2"
              style={{ height: 26, padding: '0 8px', borderRadius: 'var(--radius-row)' }}
            >
              <button
                type="button"
                onClick={() => void applyPreset(preset)}
                className="flex-1 truncate text-left"
                style={{ fontSize: 'var(--text-control)', color: 'var(--fg-primary)' }}
              >
                {preset.name}
              </button>
              {preset.builtIn ? null : (
                <button
                  type="button"
                  onClick={() => void deletePreset(preset.id)}
                  className="photoy-mini"
                  style={{ width: 'auto', padding: '0 4px' }}
                  aria-label={`Excluir ${preset.name}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </PanelSection>
  );
}
