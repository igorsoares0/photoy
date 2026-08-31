import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { argv } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Writes the PNG fixtures the engine tests read.
 *
 * Generated rather than committed: the pixel patterns are what the assertions
 * check, so keeping them next to the values they encode makes it obvious when
 * one changes, and keeps binaries out of the repository.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(tag, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(tag, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function writePng(file, width, height, pixel) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = y * stride + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  writeFileSync(
    path.join(here, file),
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 1 })),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

// A gradient with a hard magenta block at x 40-89, y 20-59. The gradient
// exercises resampling; the block makes a channel-order or orientation mistake
// impossible to miss.
const GRADIENT = (x, y) =>
  x >= 40 && x < 90 && y >= 20 && y < 60
    ? [255, 0, 255, 255]
    : [Math.floor((x * 255) / 199), Math.floor((y * 255) / 119), 128, 255];

// Six flat patches of known sRGB values. Colour conversion is only checkable
// against colours whose coordinates you already know, and the primaries are
// where a wrong gamut or white point shows up first.
export const PATCHES = [
  { name: 'red', rgb: [255, 0, 0] },
  { name: 'green', rgb: [0, 255, 0] },
  { name: 'blue', rgb: [0, 0, 255] },
  { name: 'white', rgb: [255, 255, 255] },
  { name: 'light', rgb: [192, 192, 192] },
  { name: 'grey', rgb: [128, 128, 128] },
  { name: 'dark', rgb: [64, 64, 64] },
  { name: 'black', rgb: [0, 0, 0] },
  // Well inside the gamut, so a saturation increase has somewhere to go.
  { name: 'muted', rgb: [180, 120, 90] },
];

export const PATCH_SIZE = 20;

export const LARGE_WIDTH = 2600;
export const LARGE_HEIGHT = 1800;

export function generateFixtures() {
  mkdirSync(here, { recursive: true });
  writePng('gradient.png', 200, 120, GRADIENT);
  // Opaque on the left, fully transparent on the right, to catch colour
  // bleeding across the alpha edge during a downscale.
  writePng('alpha.png', 100, 60, (x) => [255, 80, 0, x < 50 ? 255 : 0]);
  writePng('patches.png', PATCHES.length * PATCH_SIZE, PATCH_SIZE, (x) => {
    const patch = PATCHES[Math.floor(x / PATCH_SIZE)];
    return [...patch.rgb, 255];
  });
  // A flat grey field, twice as wide as tall: any variation across it is the
  // mask under test and nothing else, and the aspect catches a radial mask that
  // has been stretched into an ellipse.
  writePng('flat.png', 400, 200, () => [128, 128, 128, 255]);
  // Big enough that a render takes long enough to still be queued when the
  // next one arrives, which is what the cancellation tests need.
  writePng('large.png', LARGE_WIDTH, LARGE_HEIGHT, (x, y) => [
    (x * 7) & 255,
    (y * 5) & 255,
    ((x + y) * 3) & 255,
    255,
  ]);
}

if (argv[1]?.endsWith('generate.mjs')) {
  generateFixtures();
  console.log('fixtures written');
}
