/**
 * Face detection.
 *
 * The engine reports where faces and their landmarks are and stops there. What
 * a region means for a tool - how much of the face counts as skin, where the
 * teeth are inside a mouth - is decided in the renderer, because those are
 * judgements rather than measurements and they change without a rebuild.
 */

export interface FacePoint {
  x: number;
  y: number;
}

/** A detected face, in fractions of the document as it currently stands. */
export interface Face {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Confidence, 0 to 1. */
  score: number;
  /**
   * The five landmarks the detector reports.
   *
   * Right and left are the subject's, not the viewer's - so `rightEye` sits at
   * the smaller x on a face looking at the camera. Worth stating because the
   * difference is invisible in the numbers right up until an eye brightens on
   * the wrong side of somebody's face.
   */
  rightEye: FacePoint;
  leftEye: FacePoint;
  nose: FacePoint;
  rightMouth: FacePoint;
  leftMouth: FacePoint;
}

export interface FaceDetection {
  documentId: string;
  /** Largest first: the subject of a photograph is almost always the biggest. */
  faces: Face[];
}
