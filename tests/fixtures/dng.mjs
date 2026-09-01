import { writeFileSync } from 'node:fs';

/**
 * Writes a minimal uncompressed DNG.
 *
 * Generated rather than committed for the same reason as the PNG fixtures, and
 * for one more: a raw file from a real camera carries that camera's licence
 * and metadata, while this one carries a scene we chose. A uniform neutral
 * frame is what makes the colour assertion meaningful - anything the decoder
 * does to the white point shows up as a cast, with no demosaic edge effects to
 * argue about.
 */

const BYTE = 1;
const ASCII = 2;
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;
const SRATIONAL = 10;

const SIZE_OF = { [BYTE]: 1, [ASCII]: 1, [SHORT]: 2, [LONG]: 4, [RATIONAL]: 8, [SRATIONAL]: 8 };

function encodeValues(type, values) {
  const buffer = Buffer.alloc(SIZE_OF[type] * values.length);
  values.forEach((value, index) => {
    switch (type) {
      case BYTE:
      case ASCII:
        buffer.writeUInt8(value, index);
        break;
      case SHORT:
        buffer.writeUInt16LE(value, index * 2);
        break;
      case LONG:
        buffer.writeUInt32LE(value, index * 4);
        break;
      case RATIONAL:
        buffer.writeUInt32LE(value[0], index * 8);
        buffer.writeUInt32LE(value[1], index * 8 + 4);
        break;
      case SRATIONAL:
        buffer.writeInt32LE(value[0], index * 8);
        buffer.writeInt32LE(value[1], index * 8 + 4);
        break;
      default:
        throw new Error(`unsupported tag type ${type}`);
    }
  });
  return buffer;
}

function ascii(text) {
  return [...Buffer.from(`${text}\0`, 'latin1')];
}

/// XYZ (D50) to a camera whose primaries are sRGB's, as ColorMatrix1 wants it.
const SRGB_COLOR_MATRIX = [
  3133856, -1616867, -490615,
  -978768, 1916142, 33454,
  71945, -228991, 1405243,
].map((numerator) => [numerator, 1000000]);

/**
 * @param {string} file destination path
 * @param {number} width even, so the 2x2 CFA tiles exactly
 * @param {number} height even
 * @param {(x: number, y: number, channel: 0|1|2) => number} sample 16-bit value
 *   at a CFA site, given the colour that site records
 * @param {[number, number, number]} [asShotNeutral] camera-space coordinates of
 *   the scene's neutral, which is where a raw file records its white balance
 */
export function writeDng(file, width, height, sample, asShotNeutral = [1, 1, 1]) {
  const strip = Buffer.alloc(width * height * 2);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      // RGGB: red on even rows at even columns, blue on odd at odd, green
      // on the other two sites of each tile.
      const channel = y % 2 === 0 ? (x % 2 === 0 ? 0 : 1) : (x % 2 === 0 ? 1 : 2);
      strip.writeUInt16LE(sample(x, y, channel) & 0xffff, (y * width + x) * 2);
    }
  }

  // Ascending tag order is required by the TIFF specification, and LibRaw is
  // one of the readers that relies on it.
  const entries = [
    [254, LONG, [0]], // NewSubfileType: this IFD is the full-resolution image
    [256, LONG, [width]],
    [257, LONG, [height]],
    [258, SHORT, [16]], // BitsPerSample
    [259, SHORT, [1]], // Compression: none
    [262, SHORT, [32803]], // PhotometricInterpretation: colour filter array
    [271, ASCII, ascii('Photoy')], // Make
    [272, ASCII, ascii('Synthetic')], // Model
    [273, LONG, null], // StripOffsets, patched once the layout is known
    [277, SHORT, [1]], // SamplesPerPixel
    [278, LONG, [height]], // RowsPerStrip: one strip for the whole frame
    [279, LONG, [strip.length]], // StripByteCounts
    [33421, SHORT, [2, 2]], // CFARepeatPatternDim
    [33422, BYTE, [0, 1, 1, 2]], // CFAPattern: RGGB
    [50706, BYTE, [1, 4, 0, 0]], // DNGVersion
    [50707, BYTE, [1, 1, 0, 0]], // DNGBackwardVersion
    [50708, ASCII, ascii('Photoy Synthetic')], // UniqueCameraModel
    [50714, SHORT, [0]], // BlackLevel
    [50717, LONG, [65535]], // WhiteLevel
    [50721, SRATIONAL, SRGB_COLOR_MATRIX], // ColorMatrix1
    // AsShotNeutral: the camera's own reading of the scene's white, which the
    // decoder inverts into the white-balance multipliers.
    [50728, RATIONAL, asShotNeutral.map((value) => [Math.round(value * 1000000), 1000000])],
    [50778, SHORT, [21]], // CalibrationIlluminant1: D65
  ];

  const headerSize = 8;
  const directorySize = 2 + entries.length * 12 + 4;
  let overflowOffset = headerSize + directorySize;

  // Values of four bytes or fewer live inside the entry; anything larger sits
  // after the directory and the entry holds its offset.
  const overflow = [];
  const inlined = entries.map(([tag, type, values]) => {
    if (values === null) return { tag, type, count: 1, payload: null };
    const encoded = encodeValues(type, values);
    if (encoded.length <= 4) {
      const padded = Buffer.alloc(4);
      encoded.copy(padded);
      return { tag, type, count: values.length, inline: padded };
    }
    const offset = overflowOffset;
    overflow.push(encoded);
    overflowOffset += encoded.length + (encoded.length % 2);
    return { tag, type, count: values.length, offset };
  });

  const stripOffset = overflowOffset;
  const directory = Buffer.alloc(directorySize);
  directory.writeUInt16LE(entries.length, 0);
  inlined.forEach((entry, index) => {
    const at = 2 + index * 12;
    directory.writeUInt16LE(entry.tag, at);
    directory.writeUInt16LE(entry.type, at + 2);
    directory.writeUInt32LE(entry.count, at + 4);
    if (entry.payload === null) {
      directory.writeUInt32LE(stripOffset, at + 8); // StripOffsets
    } else if (entry.inline) {
      entry.inline.copy(directory, at + 8);
    } else {
      directory.writeUInt32LE(entry.offset, at + 8);
    }
  });
  directory.writeUInt32LE(0, directorySize - 4); // no further IFDs

  const header = Buffer.alloc(8);
  header.write('II', 0, 'latin1');
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(headerSize, 4);

  const padded = overflow.map((buffer) =>
    buffer.length % 2 === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(1)]),
  );
  writeFileSync(file, Buffer.concat([header, directory, ...padded, strip]));
}
