import type { Adjustments, Face } from '@photoy/types';

/**
 * Portrait regions, built from the five points a face detector reports.
 *
 * The engine measures - where the face is, where the eyes and the mouth are -
 * and this decides what that means for a tool. Which is the same split auto
 * enhance uses, and for the same reason: where an eye is, is arithmetic; how
 * much of the face around it counts as skin, is taste.
 *
 * Everything here is a pure function of numbers and bytes, so it is testable
 * without a browser and changeable without a rebuild of the engine.
 */

/** A tool the panel offers. */
export type PortraitToolId = 'skin' | 'eyes' | 'teeth' | 'light';

export interface Point {
  x: number;
  y: number;
}

/**
 * Coverage from 0 to 255 over a mask of `width` x `height`.
 *
 * The same layout the brush produces and `mask.store` accepts, so a generated
 * region and a painted one are the same thing to everything downstream.
 */
export type Coverage = Uint8Array;

/** Feather as a fraction of the region's own radius, so it scales with the face. */
const FEATHER = 0.35;

/**
 * The face's roll, from the line between the eyes.
 *
 * A bounding box is always upright and a head very often is not, so an oval
 * drawn on the box alone sits crooked on a tilted face. Two eye positions are
 * enough to fix that, and they are two of the five points we get.
 */
export function faceAngle(face: Face): number {
  return Math.atan2(face.leftEye.y - face.rightEye.y, face.leftEye.x - face.rightEye.x);
}

/** Midpoint of the two eyes, which is steadier than the box centre. */
export function eyeCentre(face: Face): Point {
  return {
    x: (face.rightEye.x + face.leftEye.x) / 2,
    y: (face.rightEye.y + face.leftEye.y) / 2,
  };
}

/** Distance between the eyes, the natural unit for everything on a face. */
export function eyeSpan(face: Face): number {
  return Math.hypot(face.leftEye.x - face.rightEye.x, face.leftEye.y - face.rightEye.y);
}

/**
 * Adds a feathered, rotated ellipse to a coverage buffer.
 *
 * Coordinates are fractions of the document; the buffer may be any shape, so
 * the aspect ratio has to come in explicitly rather than be assumed square.
 */
export function stampEllipse(
  coverage: Coverage,
  width: number,
  height: number,
  centre: Point,
  radiusX: number,
  radiusY: number,
  angle: number,
  strength = 255,
): void {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  // Only the pixels the ellipse can reach, so a small region on a large mask
  // costs what the region costs and not what the mask costs.
  const reach = Math.max(radiusX, radiusY) * (1 + FEATHER);
  const minX = Math.max(0, Math.floor((centre.x - reach) * width));
  const maxX = Math.min(width - 1, Math.ceil((centre.x + reach) * width));
  const minY = Math.max(0, Math.floor((centre.y - reach) * height));
  const maxY = Math.min(height - 1, Math.ceil((centre.y + reach) * height));

  for (let y = minY; y <= maxY; y += 1) {
    const fy = (y + 0.5) / height - centre.y;
    for (let x = minX; x <= maxX; x += 1) {
      const fx = (x + 0.5) / width - centre.x;
      // Into the ellipse's own frame, so a tilted head gets a tilted region.
      const rx = (fx * cos - fy * sin) / radiusX;
      const ry = (fx * sin + fy * cos) / radiusY;
      const distance = Math.hypot(rx, ry);
      if (distance >= 1 + FEATHER) continue;

      // Smoothstep rather than a linear ramp: a linear edge leaves a visible
      // crease where the falloff starts, because the eye reads the change in
      // slope and not the value.
      const t = Math.min(1, Math.max(0, (1 + FEATHER - distance) / FEATHER));
      const eased = t * t * (3 - 2 * t);
      const value = Math.round(eased * strength);
      const at = y * width + x;
      if (value > (coverage[at] ?? 0)) coverage[at] = value;
    }
  }
}

/** Removes coverage, for carving eyes and a mouth out of a skin region. */
export function eraseEllipse(
  coverage: Coverage,
  width: number,
  height: number,
  centre: Point,
  radiusX: number,
  radiusY: number,
  angle: number,
): void {
  const hole = new Uint8Array(coverage.length);
  stampEllipse(hole, width, height, centre, radiusX, radiusY, angle);
  for (let i = 0; i < coverage.length; i += 1) {
    coverage[i] = Math.round(((coverage[i] ?? 0) * (255 - (hole[i] ?? 0))) / 255);
  }
}

/**
 * Skin: the face oval with the eyes and the mouth taken out.
 *
 * Smoothing the eyes and the lips along with the skin is what makes cheap
 * retouching look like plastic - the eyes go soft and the face stops reading as
 * a face. Cutting them out costs two ellipses and is most of the difference.
 */
export function skinMask(faces: Face[], width: number, height: number): Coverage {
  const coverage = new Uint8Array(width * height);
  for (const face of faces) {
    const angle = faceAngle(face);
    const span = eyeSpan(face) || face.width * 0.4;
    const eyes = eyeCentre(face);

    // Centred below the eyes rather than on the box: the box includes forehead
    // and hair, and the skin worth smoothing is cheeks, nose and chin.
    const centre = {
      x: eyes.x + Math.sin(angle) * span * 0.55,
      y: eyes.y + Math.cos(angle) * span * 0.55,
    };
    stampEllipse(coverage, width, height, centre, span * 0.95, span * 1.25, angle);

    for (const eye of [face.rightEye, face.leftEye]) {
      eraseEllipse(coverage, width, height, eye, span * 0.32, span * 0.22, angle);
    }
    eraseEllipse(coverage, width, height, mouthCentre(face), span * 0.5, span * 0.3, angle);
  }
  return coverage;
}

/** Midpoint of the mouth corners. */
export function mouthCentre(face: Face): Point {
  return {
    x: (face.rightMouth.x + face.leftMouth.x) / 2,
    y: (face.rightMouth.y + face.leftMouth.y) / 2,
  };
}

/** Both eyes, as two small ellipses. */
export function eyesMask(faces: Face[], width: number, height: number): Coverage {
  const coverage = new Uint8Array(width * height);
  for (const face of faces) {
    const angle = faceAngle(face);
    const span = eyeSpan(face) || face.width * 0.4;
    for (const eye of [face.rightEye, face.leftEye]) {
      stampEllipse(coverage, width, height, eye, span * 0.3, span * 0.2, angle);
    }
  }
  return coverage;
}

/** The whole face, for lighting it. */
export function faceMask(faces: Face[], width: number, height: number): Coverage {
  const coverage = new Uint8Array(width * height);
  for (const face of faces) {
    const angle = faceAngle(face);
    const span = eyeSpan(face) || face.width * 0.4;
    const eyes = eyeCentre(face);
    const centre = {
      x: eyes.x + Math.sin(angle) * span * 0.35,
      y: eyes.y + Math.cos(angle) * span * 0.35,
    };
    stampEllipse(coverage, width, height, centre, span * 1.15, span * 1.6, angle);
  }
  return coverage;
}

/**
 * What a pixel looks like, for the one region that cannot be decided by
 * geometry alone.
 *
 * Coordinates are fractions of the document, so the caller can answer from a
 * preview of any size without the region having to know which.
 */
export type Sampler = (x: number, y: number) => { luma: number; saturation: number };

/** Below this a pixel is too dark inside a mouth to be a tooth. */
const TEETH_MIN_LUMA = 0.35;
/** Above this it is too colourful to be one. Lips are the colour in a mouth. */
const TEETH_MAX_SATURATION = 0.45;

/**
 * Teeth: the mouth region, kept only where the pixels are bright and pale.
 *
 * The one region geometry cannot draw. Five points give the mouth corners, and
 * everything between them is lips as much as teeth - whitening a lip is exactly
 * the mistake this has to avoid. What separates them is not shape but colour: a
 * tooth is the bright, nearly colourless part of a mouth, and a lip is the
 * coloured part, whatever shape either happens to be.
 *
 * A closed mouth therefore yields almost nothing, which is correct: there is
 * nothing there to whiten.
 */
export function teethMask(
  faces: Face[],
  width: number,
  height: number,
  sample: Sampler,
): Coverage {
  const coverage = new Uint8Array(width * height);
  for (const face of faces) {
    const angle = faceAngle(face);
    const span = eyeSpan(face) || face.width * 0.4;
    stampEllipse(coverage, width, height, mouthCentre(face), span * 0.46, span * 0.26, angle);
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = y * width + x;
      if (coverage[at] === 0) continue;
      const { luma, saturation } = sample((x + 0.5) / width, (y + 0.5) / height);
      // Ramped rather than switched: a hard threshold puts a jagged edge along
      // the gum line, where luma crosses it pixel by pixel.
      const bright = Math.min(1, Math.max(0, (luma - TEETH_MIN_LUMA) / 0.25));
      const pale = Math.min(1, Math.max(0, (TEETH_MAX_SATURATION - saturation) / 0.2));
      coverage[at] = Math.round((coverage[at] ?? 0) * bright * pale);
    }
  }
  return coverage;
}

/**
 * What each tool does at full strength, as adjustments the engine already has.
 *
 * No new pixel code: a portrait tool is a region plus a setting of the same
 * sliders the panel below it offers. The strength the panel carries scales
 * these, so 0 is neutral and 100 is what is written here.
 */
export function toolAdjustments(tool: PortraitToolId, strength: number): Partial<Adjustments> {
  const amount = Math.min(1, Math.max(0, strength / 100));
  switch (tool) {
    case 'skin':
      // The guided filter, which smooths inside a region and leaves the edges
      // between regions alone - so pores go and the jawline stays.
      return { denoise: 70 * amount, denoiseDetail: 35, clarity: -25 * amount };
    case 'eyes':
      return { clarity: 40 * amount, exposure: 0.15 * amount, sharpen: 25 * amount };
    case 'teeth':
      // Desaturating does most of the work; brightening a little finishes it.
      // Brightening first would grey the whole mouth before the yellow left.
      return { saturation: -60 * amount, brightness: 12 * amount };
    case 'light':
      return { exposure: 0.35 * amount, shadows: 20 * amount };
    default:
      return {};
  }
}

/**
 * What `Auto` sets each tool to.
 *
 * Conservative on purpose. A portrait that has obviously been retouched is a
 * worse photograph than one that has not, and the person looking hardest at it
 * is the person in it. These are a starting point to pull further, not a look.
 */
export const AUTO_STRENGTHS: Record<PortraitToolId, number> = {
  skin: 40,
  light: 25,
  eyes: 30,
  teeth: 35,
};
