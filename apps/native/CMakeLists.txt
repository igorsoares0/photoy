find_package(nlohmann_json CONFIG REQUIRED)
find_package(libjpeg-turbo CONFIG REQUIRED)
find_package(libpng CONFIG REQUIRED)
find_package(TIFF REQUIRED)
find_package(WebP CONFIG REQUIRED)
find_package(lcms CONFIG REQUIRED)

add_executable(photoy-engine
  src/main.cpp

  src/core/log.cpp
  src/core/paths.cpp

  src/color/profile.cpp
  src/color/matrix.cpp
  src/color/output.cpp
  src/color/pipeline.cpp

  src/protocol/frame.cpp
  src/protocol/stdio_transport.cpp

  src/image/image_buffer.cpp
  src/image/rect.cpp
  src/image/resample.cpp
  src/image/orientation.cpp

  src/edit/adjustments.cpp
  src/edit/operation.cpp
  src/edit/edit_stack.cpp
  src/edit/render.cpp

  src/jobs/job_queue.cpp

  src/decoder/format_sniffer.cpp
  src/decoder/jpeg_marker.cpp
  src/decoder/exif.cpp
  src/decoder/jpeg_decoder.cpp
  src/decoder/png_decoder.cpp
  src/decoder/tiff_decoder.cpp
  src/decoder/webp_decoder.cpp
  src/decoder/decode.cpp

  src/export/jpeg_encoder.cpp
  src/export/png_encoder.cpp
  src/export/tiff_encoder.cpp
  src/export/webp_encoder.cpp
  src/export/encode.cpp

  src/engine/document_store.cpp
  src/engine/engine.cpp
)

target_include_directories(photoy-engine PRIVATE src)

target_link_libraries(photoy-engine PRIVATE
  nlohmann_json::nlohmann_json
  libjpeg-turbo::jpeg-static
  PNG::PNG
  TIFF::TIFF
  WebP::webp
  WebP::webpdemux
  WebP::libwebpmux
  lcms::lcms
)
