/**
 * The icon set.
 *
 * Lucide geometry, drawn inline: stroke only, 1.5 wide, currentColor, never
 * filled. Inline rather than a font or a sprite because the style guide rules
 * both out, and because at these sizes the paths are shorter than the loader
 * would be.
 */
export type IconName =
  | 'rotateCw'
  | 'rotateCcw'
  | 'flipHorizontal'
  | 'flipVertical'
  | 'crop'
  | 'subject'
  | 'brush'
  | 'eraser'
  | 'undo'
  | 'redo'
  | 'reset';

const PATHS: Record<IconName, string[]> = {
  rotateCw: ['M21 2v6h-6', 'M21 12a9 9 0 1 1-3-7.7L21 8'],
  rotateCcw: ['M3 2v6h6', 'M3 12a9 9 0 1 0 3-7.7L3 8'],
  flipHorizontal: [
    'M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3',
    'M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3',
    'M12 2v2',
    'M12 8v2',
    'M12 14v2',
    'M12 20v2',
  ],
  flipVertical: [
    'M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3',
    'M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3',
    'M2 12h2',
    'M8 12h2',
    'M14 12h2',
    'M20 12h2',
  ],
  crop: ['M6 2v14a2 2 0 0 0 2 2h14', 'M18 22V8a2 2 0 0 0-2-2H2'],
  // Head and shoulders: the subject is what background removal keeps, so the
  // icon draws that rather than the thing being taken away.
  subject: ['M19 21a7 7 0 0 0-14 0', 'M16 8a4 4 0 1 1-8 0 4 4 0 1 1 8 0'],
  brush: ['m15 4 5 5', 'M9.5 14.5 3 21l2-6 11-11a2.8 2.8 0 0 1 4 4L9 18'],
  eraser: [
    'm7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21',
    'M22 21H7',
    'm5 11 9 9',
  ],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  reset: ['M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8', 'M3 3v5h5'],
};

export function Icon({ name, size = 17 }: { name: IconName; size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
