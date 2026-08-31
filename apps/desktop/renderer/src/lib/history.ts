import type { AdjustmentKey, Adjustments, HistoryEntry } from '@photoy/types';
import { NEUTRAL_ADJUSTMENTS } from '@photoy/types';
import { formatDimensions, formatInteger, formatSigned } from './format';

export interface HistoryRow {
  id: number;
  /** What was done, in the product's own words. */
  label: string;
  /** The measured value, shown in monospace. Null when there is nothing to measure. */
  detail: string | null;
}

const ADJUSTMENT_LABELS: Record<AdjustmentKey, string> = {
  exposure: 'Exposição',
  brightness: 'Brilho',
  contrast: 'Contraste',
  highlights: 'Realces',
  shadows: 'Sombras',
  saturation: 'Saturação',
  temperature: 'Temperatura',
};

const MASK_LABELS: Record<string, string> = {
  none: 'Máscara removida',
  linear: 'Máscara linear',
  radial: 'Máscara radial',
};

/**
 * Names the control a slider gesture moved.
 *
 * An adjustment operation carries the whole slider state rather than a delta,
 * which is what makes it replayable — but a history row has to say what
 * changed, so the change is recovered by comparing against the state the same
 * layer was in before.
 */
function describeAdjustment(
  previous: Adjustments,
  next: Adjustments,
): { label: string; detail: string | null } {
  const changed = (Object.keys(ADJUSTMENT_LABELS) as AdjustmentKey[]).filter(
    (key) => Math.abs(next[key] - previous[key]) > 1e-6,
  );

  if (changed.length === 0) return { label: 'Ajuste', detail: null };
  if (changed.length > 1) return { label: 'Ajustes', detail: `${changed.length} controles` };

  const key = changed[0] as AdjustmentKey;
  const value = next[key];
  return {
    label: ADJUSTMENT_LABELS[key],
    detail: key === 'exposure' ? `${formatSigned(value, 2)} EV` : formatSigned(value),
  };
}

/**
 * Turns the engine's operation list into rows a person can read.
 *
 * Every row that has a number shows it: a history that says "adjusted" without
 * saying by how much is not something anyone can audit.
 */
export function describeHistory(entries: HistoryEntry[]): HistoryRow[] {
  // Adjustments are per layer, so the comparison has to be per layer too. A
  // zero identifier is a real key here, not a missing one: it means the topmost
  // adjustment layer, and successive entries carrying it belong together.
  const previousByLayer = new Map<number, Adjustments>();

  return entries.map((entry) => {
    const id = entry.id;
    switch (entry.kind) {
      case 'rotate': {
        const quarters = ((entry.quarters % 4) + 4) % 4;
        const degrees = quarters === 3 ? -90 : quarters * 90;
        return { id, label: 'Girar', detail: `${formatSigned(degrees)}°` };
      }
      case 'flipHorizontal':
        return { id, label: 'Espelhar', detail: 'horizontal' };
      case 'flipVertical':
        return { id, label: 'Espelhar', detail: 'vertical' };
      case 'crop':
        return {
          id,
          label: 'Recortar',
          detail: formatDimensions(entry.rect.width, entry.rect.height),
        };
      case 'adjust': {
        const key = entry.layerId ?? 0;
        const previous = previousByLayer.get(key) ?? NEUTRAL_ADJUSTMENTS;
        previousByLayer.set(key, entry.adjustments);
        return { id, ...describeAdjustment(previous, entry.adjustments) };
      }
      case 'addLayer':
        return { id, label: 'Nova camada', detail: entry.name || null };
      case 'removeLayer':
        return { id, label: 'Remover camada', detail: null };
      case 'reorderLayer':
        return { id, label: 'Reordenar camada', detail: null };
      case 'setLayerVisible':
        return { id, label: entry.visible === false ? 'Ocultar camada' : 'Mostrar camada', detail: null };
      case 'setLayerOpacity':
        return {
          id,
          label: 'Opacidade',
          detail: `${formatInteger((entry.opacity ?? 1) * 100)} %`,
        };
      case 'setLayerBlend':
        return { id, label: 'Mistura', detail: entry.blend ?? 'normal' };
      case 'setLayerMask':
        return { id, label: MASK_LABELS[entry.mask?.kind ?? 'none'] ?? 'Máscara', detail: null };
      case 'setLayerFill':
        return {
          id,
          label: 'Fundo',
          detail: entry.fill === 'color' ? 'cor' : 'transparente',
        };
      case 'setLayerDecontaminate':
        return {
          id,
          label: 'Descontaminar',
          detail: `${formatInteger((entry.decontaminate ?? 1) * 100)} %`,
        };
      default:
        return { id, label: 'Edição', detail: null };
    }
  });
}
