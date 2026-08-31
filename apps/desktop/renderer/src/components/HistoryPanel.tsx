import { useEditor } from '../store/editor';
import { describeHistory } from '../lib/history';

/**
 * Everything that has been done, and a way back to any of it.
 *
 * Oldest at the top, with the untouched original above them all. Entries past
 * the current position are the redo tail: still there, still reachable, and
 * dimmed so it reads as what has been stepped back from rather than as
 * something waiting to happen.
 */
export function HistoryPanel(): React.JSX.Element {
  const entries = useEditor((state) => state.history?.entries);
  const cursor = useEditor((state) => state.history?.cursor ?? 0);
  const seekEdit = useEditor((state) => state.seekEdit);

  const rows = describeHistory(entries ?? []);

  return (
    <div
      className="flex flex-1 flex-col overflow-y-auto"
      style={{ padding: 'var(--pad-panel)', gap: 2 }}
    >
      <Row
        label="Original"
        detail={null}
        current={cursor === 0}
        undone={false}
        onClick={() => void seekEdit(0)}
      />
      {rows.map((row, index) => (
        <Row
          key={row.id}
          label={row.label}
          detail={row.detail}
          current={cursor === index + 1}
          undone={index + 1 > cursor}
          onClick={() => void seekEdit(index + 1)}
        />
      ))}
      {rows.length === 0 ? (
        <span
          style={{ fontSize: 'var(--text-chip)', color: 'var(--fg-numeric-idle)', marginTop: 8 }}
        >
          Nada foi alterado ainda.
        </span>
      ) : null}
    </div>
  );
}

function Row({
  label,
  detail,
  current,
  undone,
  onClick,
}: {
  label: string;
  detail: string | null;
  current: boolean;
  undone: boolean;
  onClick(): void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="photoy-layer-row flex w-full items-baseline justify-between"
      style={{
        height: 26,
        padding: '0 8px',
        borderRadius: 'var(--radius-row)',
        background: current ? 'var(--surface-active)' : 'transparent',
        boxShadow: current ? 'inset 0 0 0 1px var(--border-hover)' : 'none',
        opacity: undone ? 0.42 : 1,
        transition: 'var(--transition-control)',
      }}
    >
      <span
        className="truncate text-left"
        style={{
          fontSize: 'var(--text-control)',
          color: current ? 'var(--fg-primary)' : 'var(--fg-secondary)',
        }}
      >
        {label}
      </span>
      {detail !== null ? (
        <span
          className="numeric shrink-0 pl-2"
          style={{ fontSize: 'var(--text-label)', color: 'var(--fg-ghost)' }}
        >
          {detail}
        </span>
      ) : null}
    </button>
  );
}
