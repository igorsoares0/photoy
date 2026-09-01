import { useEffect, useState } from 'react';
import { useEditor } from '../store/editor';
import type { SuggestionId } from '../lib/enhance';
import { formatSigned } from '../lib/format';
import { PanelSection } from './PanelSection';

/**
 * What each proposal is called, and what it says about the photograph.
 *
 * The copy lives here rather than in the analysis, for the same reason error
 * copy does: the engine measures and names things in codes, and the interface
 * decides what a person is told.
 */
const LABELS: Record<SuggestionId, { title: string; because(measure: number): string }> = {
  light: {
    title: 'Corrigir a luz',
    because: (m) => `${formatSigned(m, 1)} EV do meio`,
  },
  shadows: {
    title: 'Recuperar as sombras',
    because: (m) => `${Math.round(m * 100)} % da foto no escuro`,
  },
  highlights: {
    title: 'Segurar os realces',
    because: (m) => `${Math.round(m * 100)} % perto do branco`,
  },
  contrast: {
    title: 'Ampliar o contraste',
    because: (m) => `usa ${Math.round(m * 100)} % da escala`,
  },
  cast: {
    title: 'Corrigir a dominante',
    because: (m) => (m > 0 ? 'puxando para o quente' : 'puxando para o frio'),
  },
  colour: {
    title: 'Realçar as cores',
    because: (m) => `cor a ${Math.round(m * 100)} % de distância do cinza`,
  },
  detail: {
    title: 'Aumentar o detalhe',
    because: () => 'pouca variação entre pixels vizinhos',
  },
};

/**
 * Improve Photo.
 *
 * It analyses and proposes; it never applies. That is the spec's rule and it is
 * the right one: this cannot tell a soft photograph from a smooth subject, or a
 * warm evening from a colour cast, so every line is a question rather than a
 * finding. Each says what it measured, so a wrong proposal is arguable rather
 * than mysterious.
 */
export function EnhancePanel(): React.JSX.Element {
  const suggestions = useEditor((state) => state.suggestions);
  const analyse = useEditor((state) => state.analyse);
  const dismiss = useEditor((state) => state.dismissSuggestions);
  const applyEnhancements = useEditor((state) => state.applyEnhancements);
  const analysing = useEditor((state) => state.busy === 'analysing');

  const [chosen, setChosen] = useState<ReadonlySet<SuggestionId>>(new Set());

  // Everything proposed starts ticked: the list is a proposal, and a proposal
  // nobody has looked at yet should be the one the analysis actually made.
  useEffect(() => {
    setChosen(new Set(suggestions?.map((entry) => entry.id) ?? []));
  }, [suggestions]);

  const toggle = (id: SuggestionId) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  return (
    <PanelSection
      label="Melhorar"
      hint={
        suggestions === null ? null : (
          <button
            type="button"
            onClick={dismiss}
            className="photoy-mini"
            style={{ width: 'auto', padding: '0 6px' }}
          >
            descartar
          </button>
        )
      }
    >
      {suggestions === null ? (
        <button
          type="button"
          onClick={() => void analyse()}
          disabled={analysing}
          className="photoy-chip"
          style={{
            height: 30,
            borderRadius: 'var(--radius-control)',
            fontSize: 'var(--text-control)',
            border: '1px solid var(--border-quiet)',
            background: 'transparent',
            color: 'var(--fg-primary)',
            opacity: analysing ? 0.6 : 1,
          }}
        >
          {analysing ? 'Analisando…' : 'Analisar a foto'}
        </button>
      ) : suggestions.length === 0 ? (
        <span style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}>
          Nada a sugerir. A foto já está equilibrada nas contas que sei fazer.
        </span>
      ) : (
        <>
          {suggestions.map((suggestion) => (
            <label
              key={suggestion.id}
              className="flex cursor-default items-baseline gap-2"
              style={{ padding: '2px 0' }}
            >
              <input
                type="checkbox"
                checked={chosen.has(suggestion.id)}
                onChange={() => toggle(suggestion.id)}
                className="photoy-checkbox"
              />
              <span className="flex-1">
                <span
                  style={{ fontSize: 'var(--text-control)', color: 'var(--fg-primary)', display: 'block' }}
                >
                  {LABELS[suggestion.id].title}
                </span>
                <span
                  className="numeric"
                  style={{ fontSize: 'var(--text-micro)', color: 'var(--fg-numeric-idle)' }}
                >
                  {LABELS[suggestion.id].because(suggestion.measure)}
                </span>
              </span>
            </label>
          ))}

          <button
            type="button"
            onClick={() => void applyEnhancements(chosen)}
            disabled={chosen.size === 0}
            className="photoy-chip"
            style={{
              height: 30,
              borderRadius: 'var(--radius-control)',
              fontSize: 'var(--text-control)',
              border: '1px solid var(--border-hover)',
              background: 'var(--surface-active)',
              color: 'var(--fg-primary)',
              opacity: chosen.size === 0 ? 0.5 : 1,
            }}
          >
            {chosen.size === suggestions.length
              ? 'Aplicar tudo'
              : `Aplicar ${chosen.size} de ${suggestions.length}`}
          </button>
        </>
      )}
    </PanelSection>
  );
}
