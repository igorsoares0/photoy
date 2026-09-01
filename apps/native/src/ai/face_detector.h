#pragma once

#include <vector>

#include "ai/model_manager.h"
#include "image/image_buffer.h"
#include "jobs/cancellation.h"

namespace photoy::ai {

/**
 * A face the detector found, in fractions of the image it was given.
 *
 * Fractions rather than pixels for the same reason masks use them: the
 * detection is made at one size and applied at another, and a fraction survives
 * that while a pixel coordinate does not.
 */
struct Face {
  /// Bounding box, x and y at the top left.
  float x = 0.0f;
  float y = 0.0f;
  float width = 0.0f;
  float height = 0.0f;
  /// Confidence, 0 to 1.
  float score = 0.0f;

  /**
   * The five points YuNet reports, in the order it reports them.
   *
   * Right and left are the subject's, not the viewer's, which is the convention
   * the model was trained with and worth stating because it is invisible in the
   * numbers until an eye brightens on the wrong side of a face.
   */
  struct Point {
    float x = 0.0f;
    float y = 0.0f;
  };
  Point right_eye;
  Point left_eye;
  Point nose;
  Point right_mouth;
  Point left_mouth;
};

/// Faces ordered largest first, which is the order a portrait tool wants: the
/// subject of a photograph is almost always the biggest face in it.
std::vector<Face> DetectFaces(const Image16& working, Session& session,
                              const CancellationTokenPtr& token);

/**
 * Turns the model's raw output into faces.
 *
 * Split out from the inference so it can be tested without the model: the
 * anchor arithmetic and the overlap suppression are where the mistakes live,
 * and both are pure functions of numbers.
 */
struct RawOutputs {
  /// Per stride, in the order 8, 16, 32.
  std::vector<float> cls[3];
  std::vector<float> obj[3];
  std::vector<float> bbox[3];
  std::vector<float> kps[3];
};

/// Score below which a detection is discarded.
inline constexpr float kFaceScoreThreshold = 0.6f;
/// Overlap above which the weaker of two detections is discarded.
inline constexpr float kFaceOverlapThreshold = 0.3f;
/// The square the model always sees, whatever the photograph's size.
inline constexpr int kFaceInputSide = 640;

std::vector<Face> DecodeFaces(const RawOutputs& outputs, int side);

}  // namespace photoy::ai
