import { useMemo } from 'react';
import { useEditor } from '../store/editor';
import { channelPath } from '../lib/histogram';

/**
 * The channel colours, matched to the curve panel's.
 *
 * The same three lines mean the same three things in both places, so they are
 * drawn the same way. Not tokens: these say which channel, which is information
 * about the photograph rather than a state of the interface.
 */
const CHANNELS = [
  { key: 'red' as const, colour: '#e08b7d' },
  { key: 'green' as const, colour: '#7dbd90' },
  { key: 'blue' as const, colour: '#7da2e0' },
];

/** Below this nobody would call it clipping; above it, it is worth saying. */
const CLIPPING_NOTICE = 0.005;

/**
 * The distribution of what is on screen.
 *
 * Three channels drawn over each other in screen blending, which is what makes
 * the overlaps read as grey where all three agree - the same thing every editor
 * that draws one of these does, and for the same reason: the shape of the
 * agreement is most of what a histogram is read for.
 */
export function Histogram(): React.JSX.Element | null {
  const histogram = useEditor((state) => state.histogram);
  const paths = useMemo(
    () =>
      histogram === null
        ? null
        : CHANNELS.map((channel) => ({
            ...channel,
            d: channelPath(histogram[channel.key], histogram.peak),
          })),
    [histogram],
  );

  if (histogram === null || paths === null || histogram.counted === 0) return null;

  const shadows = histogram.clippedShadows;
  const highlights = histogram.clippedHighlights;

  return (
    <div className="flex flex-col" style={{ gap: 4 }}>
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className="w-full"
        style={{
          height: 78,
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-quiet)',
          borderRadius: 'var(--radius-control)',
          display: 'block',
        }}
      >
        {/* Quarters, the same reading marks the curve square carries. */}
        {[0.25, 0.5, 0.75].map((at) => (
          <line
            key={at}
            x1={at}
            y1={0}
            x2={at}
            y2={1}
            stroke="var(--border-hairline)"
            strokeWidth={0.003}
          />
        ))}
        <g style={{ mixBlendMode: 'screen' }}>
          {paths.map((channel) => (
            <path key={channel.key} d={channel.d} fill={channel.colour} fillOpacity={0.55} />
          ))}
        </g>
      </svg>

      {shadows > CLIPPING_NOTICE || highlights > CLIPPING_NOTICE ? (
        <div className="flex items-baseline justify-between">
          <span
            className="numeric"
            style={{
              fontSize: 'var(--text-micro)',
              color: shadows > CLIPPING_NOTICE ? 'var(--fg-muted)' : 'transparent',
            }}
          >
            {`${(shadows * 100).toFixed(1)} % no preto`}
          </span>
          <span
            className="numeric"
            style={{
              fontSize: 'var(--text-micro)',
              color: highlights > CLIPPING_NOTICE ? 'var(--fg-muted)' : 'transparent',
            }}
          >
            {`${(highlights * 100).toFixed(1)} % estourado`}
          </span>
        </div>
      ) : null}
    </div>
  );
}
