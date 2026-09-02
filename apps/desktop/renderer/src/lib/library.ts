import type { LibraryEntry } from '@photoy/types';

/**
 * The pure half of browsing: filtering a listing and naming a path.
 *
 * Here rather than in the store for the usual reason - a function that takes a
 * list and returns a list can be checked without a window, and the same one is
 * then used by the grid, the filmstrip and the batch dialog, which is what
 * keeps "what is on screen" from meaning three different things.
 */

/** Nothing, as a stable reference so a selector does not churn the store. */
export const NO_ENTRIES: readonly LibraryEntry[] = [];

export interface Filters {
  query: string;
  onlyFavourites: boolean;
}

/**
 * The entries a filter leaves.
 *
 * Returns the array it was given when nothing is filtering, rather than a copy:
 * a selector that built a new array every call would make the store look
 * changed on every render, which in this codebase has caused a render loop
 * three times.
 */
export function filterEntries(
  entries: readonly LibraryEntry[],
  filters: Filters,
): readonly LibraryEntry[] {
  const query = filters.query.trim().toLowerCase();
  if (query === '' && !filters.onlyFavourites) return entries;
  return entries.filter(
    (entry) =>
      (!filters.onlyFavourites || entry.favourite) &&
      (query === '' || entry.name.toLowerCase().includes(query)),
  );
}

/**
 * Enough of a path to recognise the folder, which is the last two parts of it.
 *
 * A full path in a 322-pixel panel is an ellipsis with a file name after it;
 * the folder and its parent are what tell two shoots apart.
 */
export function shorten(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter((part) => part !== '');
  return parts.slice(-2).join(' / ') || fullPath;
}

/** The last component of a path, whichever separator it was written with. */
export function fileName(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter((part) => part !== '');
  return parts.at(-1) ?? fullPath;
}
