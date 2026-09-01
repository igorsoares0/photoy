#include "ai/face_detector.h"

#include <algorithm>
#include <cmath>
#include <array>
#include <cstdint>

#include "color/pipeline.h"
#include "core/error.h"
#include "image/rect.h"
#include "image/resample.h"

namespace photoy::ai {
namespace {

/// The three feature maps YuNet reports at, in the order its outputs are named.
constexpr int kStrides[3] = {8, 16, 32};

/// Area of overlap over area of union, the usual measure of "these two boxes
/// are the same face".
float Overlap(const Face& a, const Face& b) noexcept {
  const float left = std::max(a.x, b.x);
  const float top = std::max(a.y, b.y);
  const float right = std::min(a.x + a.width, b.x + b.width);
  const float bottom = std::min(a.y + a.height, b.y + b.height);
  const float width = right - left;
  const float height = bottom - top;
  if (width <= 0.0f || height <= 0.0f) return 0.0f;

  const float intersection = width * height;
  const float united = a.width * a.height + b.width * b.height - intersection;
  return united > 0.0f ? intersection / united : 0.0f;
}

/// Working-space pixels into the normalised NCHW tensor the model wants.
std::vector<float> ToTensor(const Image8& square) {
  const int side = square.width();
  std::vector<float> tensor(static_cast<std::size_t>(side) * side * 3);
  const std::size_t plane = static_cast<std::size_t>(side) * side;
  for (int y = 0; y < side; ++y) {
    const std::uint8_t* row = square.Row(y);
    for (int x = 0; x < side; ++x) {
      const std::size_t at = static_cast<std::size_t>(y) * side + x;
      const std::uint8_t* pixel = row + static_cast<std::size_t>(x) * kChannels;
      // Channel order follows OpenCV's, which is what the model was trained and
      // published against. Values are raw 0-255: YuNet does no mean subtraction.
      tensor[at] = static_cast<float>(pixel[2]);
      tensor[plane + at] = static_cast<float>(pixel[1]);
      tensor[2 * plane + at] = static_cast<float>(pixel[0]);
    }
  }
  return tensor;
}

}  // namespace

std::vector<Face> DecodeFaces(const RawOutputs& outputs, int side) {
  std::vector<Face> found;

  for (int level = 0; level < 3; ++level) {
    const int stride = kStrides[level];
    const int columns = side / stride;
    const std::size_t anchors = static_cast<std::size_t>(columns) * columns;
    if (outputs.cls[level].size() < anchors || outputs.obj[level].size() < anchors ||
        outputs.bbox[level].size() < anchors * 4 || outputs.kps[level].size() < anchors * 10) {
      continue;
    }

    for (std::size_t anchor = 0; anchor < anchors; ++anchor) {
      // Two heads have to agree: one says "this is a face", the other says
      // "there is an object here at all". The geometric mean is what YuNet's
      // own decoder uses, and it is stricter than either alone.
      const float score =
          std::sqrt(std::max(0.0f, outputs.cls[level][anchor] * outputs.obj[level][anchor]));
      if (score < kFaceScoreThreshold) continue;

      const float column = static_cast<float>(anchor % columns);
      const float row = static_cast<float>(anchor / columns);
      const float* box = outputs.bbox[level].data() + anchor * 4;

      // The box is expressed against its anchor cell: centre as an offset in
      // cells, size as a logarithm so the regression stays well behaved across
      // the range of face sizes a photograph holds.
      const float centre_x = (column + box[0]) * stride;
      const float centre_y = (row + box[1]) * stride;
      const float width = std::exp(box[2]) * stride;
      const float height = std::exp(box[3]) * stride;

      Face face;
      face.score = score;
      face.x = (centre_x - width * 0.5f) / side;
      face.y = (centre_y - height * 0.5f) / side;
      face.width = width / side;
      face.height = height / side;

      const float* points = outputs.kps[level].data() + anchor * 10;
      Face::Point* targets[5] = {&face.right_eye, &face.left_eye, &face.nose, &face.right_mouth,
                                 &face.left_mouth};
      for (int i = 0; i < 5; ++i) {
        targets[i]->x = (column + points[i * 2]) * stride / side;
        targets[i]->y = (row + points[i * 2 + 1]) * stride / side;
      }
      found.push_back(face);
    }
  }

  // One face lights up several anchors, so the same face arrives several times.
  // Keeping the strongest and discarding what overlaps it is what turns a list
  // of activations into a list of faces.
  std::sort(found.begin(), found.end(),
            [](const Face& a, const Face& b) { return a.score > b.score; });

  std::vector<Face> kept;
  for (const Face& candidate : found) {
    const bool duplicate = std::any_of(kept.begin(), kept.end(), [&](const Face& already) {
      return Overlap(candidate, already) > kFaceOverlapThreshold;
    });
    if (!duplicate) kept.push_back(candidate);
  }

  // Largest first: the subject of a photograph is almost always the biggest
  // face in it, and a portrait panel should open on the subject.
  std::sort(kept.begin(), kept.end(), [](const Face& a, const Face& b) {
    return a.width * a.height > b.width * b.height;
  });
  return kept;
}

std::vector<Face> DetectFaces(const Image16& working, Session& session,
                              const CancellationTokenPtr& token) {
  if (working.empty()) return {};
  if (token->cancelled()) {
    throw EngineException(error_code::kCancelled, "Detection cancelled", "superseded");
  }

  // The model's input is a fixed square, so the photograph is squashed into it
  // rather than letterboxed. Squashing distorts faces, which a detector trained
  // on squashed crops tolerates, and it keeps the coordinates a plain fraction
  // of the image in each axis - no padding to subtract back out later.
  // Reduced in the working space so the averaging happens in linear light, then
  // converted to the encoding the model was published against - the same order
  // segmentation uses, and for the same reason.
  const Image16 reduced = DownscaleBox(working, Rect{0, 0, working.width(), working.height()},
                                       kFaceInputSide, kFaceInputSide, token);
  const Image8 square = color::ToOutput8(reduced, color::OutputSpace::kSrgb, token);
  const std::vector<float> tensor = ToTensor(square);

  const std::array<std::int64_t, 4> shape{1, 3, kFaceInputSide, kFaceInputSide};
  const auto results = session.RunAll(tensor, shape);

  RawOutputs outputs;
  for (const auto& [name, values] : results) {
    int level = -1;
    if (name.size() > 2 && name.compare(name.size() - 2, 2, "_8") == 0) level = 0;
    else if (name.size() > 3 && name.compare(name.size() - 3, 3, "_16") == 0) level = 1;
    else if (name.size() > 3 && name.compare(name.size() - 3, 3, "_32") == 0) level = 2;
    if (level < 0) continue;

    if (name.rfind("cls", 0) == 0) outputs.cls[level] = values;
    else if (name.rfind("obj", 0) == 0) outputs.obj[level] = values;
    else if (name.rfind("bbox", 0) == 0) outputs.bbox[level] = values;
    else if (name.rfind("kps", 0) == 0) outputs.kps[level] = values;
  }

  return DecodeFaces(outputs, kFaceInputSide);
}

}  // namespace photoy::ai
