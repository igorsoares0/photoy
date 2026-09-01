import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { argv } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDng } from './dng.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

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

export const SUBJECT_WIDTH = 900;
export const SUBJECT_HEIGHT = 600;

export const LARGE_WIDTH = 2600;
export const LARGE_HEIGHT = 1800;

/**
 * Converts a PNG fixture to HEIC with the platform's own codec.
 *
 * There is no HEIC encoder in this repository and deliberately never will be,
 * so the fixture is made by the same operating-system codec that reads it back.
 * On a machine without one nothing is written and the HEIC tests skip - which
 * is honest, because without the codec the feature does not work there either.
 */
function writeHeic(sourceName, targetName) {
  // Wherever the build put it. Release is the usual one; Debug exists when
  // somebody is chasing something in the engine.
  const tool = ['Release', 'Debug']
    .map((config) => path.resolve(here, `../../build/${config}/bin/heic-fixture.exe`))
    .find((candidate) => existsSync(candidate));
  const target = path.join(here, targetName);
  if (tool === undefined) return;
  const made = spawnSync(tool, [path.join(here, sourceName), target], { encoding: 'utf8' });
  if (made.status !== 0 && existsSync(target)) rmSync(target, { force: true });
}

export function generateFixtures() {
  mkdirSync(here, { recursive: true });

  // A uniform half-scale neutral frame. Every raw assertion that matters -
  // that the white point survives, that nothing brightens the image behind our
  // back - is a statement about one pixel of this, with no demosaic edge to
  // argue about.
  writeDng(path.join(here, 'neutral.dng'), 64, 64, () => 32768);

  // The same scene through a camera that records twice as much red for a
  // neutral, at levels chosen so the balanced result lands on the same grey as
  // neutral.dng. Equal channels alone would not prove much - a clipped white is
  // also equal - so the assertion is that both files decode to the same value.
  writeDng(
    path.join(here, 'warm.dng'),
    64,
    64,
    (x, y, channel) => (channel === 0 ? 32768 : 16384),
    [2, 1, 1],
  );

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

  // Two flat halves with noise laid over them: the noise is what a denoiser has
  // to remove and the boundary between them is what it has to leave alone.
  // Deterministic, so a test measures the filter and not the weather.
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed >> 8) % 61) - 30;
  };
  writePng('noisy.png', 240, 160, (x) => {
    const base = x < 120 ? 90 : 170;
    const shift = noise();
    return [
      Math.max(0, Math.min(255, base + shift)),
      Math.max(0, Math.min(255, base + shift)),
      Math.max(0, Math.min(255, base + shift)),
      255,
    ];
  });
  // A subject against a background: a head and shoulders in a warm tone over a
  // cool gradient. Segmentation needs something salient to find, and a flat
  // field or a gradient gives it nothing.
  writePng('subject.png', SUBJECT_WIDTH, SUBJECT_HEIGHT, (x, y) => {
    const fx = x / SUBJECT_WIDTH;
    const fy = y / SUBJECT_HEIGHT;
    const glow = Math.exp(-(((fx - 0.8) ** 2 + (fy - 0.18) ** 2) * 22));
    let r = 0.40 + 0.30 * (1 - fy) + 0.42 * glow;
    let g = 0.47 + 0.28 * (1 - fy) + 0.40 * glow;
    let b = 0.62 + 0.22 * (1 - fy) + 0.34 * glow;

    const headR = SUBJECT_HEIGHT * 0.17;
    const dh = Math.hypot(x - SUBJECT_WIDTH * 0.46, (y - SUBJECT_HEIGHT * 0.33) * 1.1) / headR;
    const shoulder =
      (y - SUBJECT_HEIGHT * 0.62) / (SUBJECT_HEIGHT * 0.5) -
      ((x - SUBJECT_WIDTH * 0.46) / (SUBJECT_WIDTH * 0.4)) ** 2;
    if (dh < 1 || (shoulder > 0 && y > SUBJECT_HEIGHT * 0.55)) {
      const shade = dh < 1 ? 0.74 + 0.20 * (1 - Math.min(dh, 1)) : 0.44;
      r = shade * 0.94;
      g = shade * 0.66;
      b = shade * 0.53;
    }
    const grain = ((x * 31 + y * 17) % 9) / 500;
    return [
      Math.max(0, Math.min(255, Math.round((r + grain) * 255))),
      Math.max(0, Math.min(255, Math.round((g + grain) * 255))),
      Math.max(0, Math.min(255, Math.round((b + grain) * 255))),
      255,
    ];
  });
  // Big enough that a render takes long enough to still be queued when the
  // next one arrives, which is what the cancellation tests need.
  writePng('large.png', LARGE_WIDTH, LARGE_HEIGHT, (x, y) => [
    (x * 7) & 255,
    (y * 5) & 255,
    ((x + y) * 3) & 255,
    255,
  ]);
  writeHeic('subject.png', 'subject.heic');

}

if (argv[1]?.endsWith('generate.mjs')) {
  generateFixtures();
  console.log('fixtures written');
}
