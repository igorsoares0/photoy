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
  | 'compare'
  | 'undo'
  | 'redo'
  | 'reset'
  | 'grid'
  | 'star'
  | 'search'
  | 'copy'
  | 'paste'
  | 'stack';

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
  // A frame split down the middle: one half of the picture as it is, the other
  // as it was.
  compare: ['M3 4h18v16H3z', 'M12 4v16', 'M7 9h1', 'M7 13h1', 'M16 9h1', 'M16 13h1'],
  eraser: [
    'm7 21-4.3-4.3a2 2 0 0 1 0-2.8l9.6-9.6a2 2 0 0 1 2.8 0l5.6 5.6a2 2 0 0 1 0 2.8L13 21',
    'M22 21H7',
    'm5 11 9 9',
  ],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  reset: ['M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.4 2.6L3 8', 'M3 3v5h5'],
  // Four panes: the folder as a contact sheet, which is what the library is.
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z'],
  // Outlined like everything else here. A filled star would be the only filled
  // shape in the set, so a marked photograph is said in colour instead.
  star: ['m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.8l6.5-.9z'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-4-4'],
  copy: ['M9 9h10v12H9z', 'M15 5H5v12h2'],
  paste: ['M9 4h6v3H9z', 'M9 5H6v16h12V5h-3', 'M9 13h6', 'M9 17h4'],
  // Sheets of paper, one behind another: many photographs, one action.
  stack: ['M12 3 3 8l9 5 9-5z', 'm3 13 9 5 9-5', 'm3 18 9 4 9-4'],
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
