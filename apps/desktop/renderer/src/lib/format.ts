/**
 * pt-BR number formatting, per the style guide: decimal comma, a thin space for
 * thousands, and a lowercase unit separated by a space.
 */

const THIN_SPACE = ' ';

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

export function formatInteger(value: number): string {
  return groupThousands(Math.round(value).toString());
}

export function formatDecimal(value: number, fractionDigits = 1): string {
  const fixed = Math.abs(value).toFixed(fractionDigits);
  const [whole = '0', fraction] = fixed.split('.');
  const sign = value < 0 ? '−' : '';
  return fraction === undefined
    ? `${sign}${groupThousands(whole)}`
    : `${sign}${groupThousands(whole)},${fraction}`;
}

/** Byte counts read as "14,2 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${formatInteger(bytes)} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatDecimal(value, value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** Pixel dimensions read as "6 000 × 4 000". */
export function formatDimensions(width: number, height: number): string {
  return `${formatInteger(width)}${THIN_SPACE}×${THIN_SPACE}${formatInteger(height)}`;
}

/** Zoom reads as a whole percent below 100%, one decimal above. */
export function formatZoom(scale: number): string {
  const percent = scale * 100;
  return percent >= 10
    ? `${formatInteger(percent)}${THIN_SPACE}%`
    : `${formatDecimal(percent, 1)}${THIN_SPACE}%`;
}

/**
 * A bipolar control's value, signed so the direction reads without the track.
 *
 * The minus is U+2212, not a hyphen: at these sizes a hyphen sits too high and
 * too short to balance the plus it alternates with.
 */
export function formatSigned(value: number, fractionDigits = 0): string {
  const magnitude =
    fractionDigits === 0 ? formatInteger(Math.abs(value)) : formatDecimal(Math.abs(value), fractionDigits);
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `−${magnitude}`;
  return magnitude;
}

export function formatDuration(milliseconds: number): string {
  return milliseconds < 1000
    ? `${formatInteger(milliseconds)} ms`
    : `${formatDecimal(milliseconds / 1000, 1)} s`;
}
