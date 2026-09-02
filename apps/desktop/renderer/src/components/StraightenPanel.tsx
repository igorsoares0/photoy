import type { HistoryEntry } from '@photoy/types';
import { MAX_STRAIGHTEN_DEGREES } from '@photoy/types';
import { useEditor } from '../store/editor';
import { formatSigned } from '../lib/format';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

/**
 * The angle in effect, read back from the stack.
 *
 * The operation carries the whole state rather than a delta, so the last
 * straighten in the active stack is the answer - which is also what makes undo
 * move the slider rather than leave it lying about where the photograph is.
 */
function currentAngle(entries: readonly HistoryEntry[]): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.kind === 'straighten') return entry.angle;
  }
  return 0;
}

/**
 * Levelling a horizon.
 *
 * Beside the size rather than inside the crop tool: a crooked horizon is a fact
 * about the photograph, not a pending decision about its framing, and it is
 * fixed the same way an exposure is - move the control, see the picture change,
 * undo if it was wrong.
 */
export function StraightenPanel(): React.JSX.Element | null {
  const history = useEditor((state) => state.history);
  const applyEdit = useEditor((state) => state.applyEdit);
  const cursor = useEditor((state) => state.history?.cursor ?? 0);
  if (history === null) return null;

  // Only the entries that are actually in effect: the redo tail is still in the
  // list, and reading the angle out of it would show an edit that was undone.
  const angle = currentAngle(history.entries.slice(0, cursor));

  const set = (next: number, continuing: boolean) =>
    void applyEdit({ kind: 'straighten', angle: next }, continuing);

  return (
    <PanelSection label="Nivelar">
      <Slider
        label="Ângulo"
        value={angle}
        min={-MAX_STRAIGHTEN_DEGREES}
        max={MAX_STRAIGHTEN_DEGREES}
        step={0.1}
        display={`${formatSigned(angle, 1)}°`}
        idle={angle === 0}
        onChange={set}
        onReset={() => set(0, false)}
      />
    </PanelSection>
  );
}
