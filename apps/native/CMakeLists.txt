find_package(nlohmann_json CONFIG REQUIRED)
find_package(libjpeg-turbo CONFIG REQUIRED)
find_package(libpng CONFIG REQUIRED)
find_package(TIFF REQUIRED)
find_package(WebP CONFIG REQUIRED)
find_package(lcms CONFIG REQUIRED)
find_package(libzip CONFIG REQUIRED)

# The official prebuilt ONNX Runtime (MIT), fetched by scripts/setup-windows.bat.
# A source build through vcpkg takes the better part of an hour for no benefit.
set(PHOTOY_ORT "${CMAKE_SOURCE_DIR}/.tooling/onnxruntime")
if(NOT EXISTS "${PHOTOY_ORT}/lib/onnxruntime.lib")
  message(FATAL_ERROR "ONNX Runtime not found at ${PHOTOY_ORT}. Run scripts/setup-windows.bat.")
endif()

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
  src/edit/layer.cpp
  src/edit/mask.cpp
  src/edit/operation.cpp
  src/edit/edit_stack.cpp
  src/edit/render.cpp
  src/edit/serialize.cpp

  src/project/project.cpp
  src/project/mask_image.cpp

  src/ai/model_manager.cpp
  src/ai/segmenter.cpp

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

target_include_directories(photoy-engine PRIVATE src "${PHOTOY_ORT}/include")

target_link_libraries(photoy-engine PRIVATE
  nlohmann_json::nlohmann_json
  libjpeg-turbo::jpeg-static
  PNG::PNG
  TIFF::TIFF
  WebP::webp
  WebP::webpdemux
  WebP::libwebpmux
  lcms::lcms
  libzip::zip
  "${PHOTOY_ORT}/lib/onnxruntime.lib"
)

# The runtime is a DLL; it has to sit beside the engine to be found.
add_custom_command(TARGET photoy-engine POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "${PHOTOY_ORT}/lib/onnxruntime.dll" "$<TARGET_FILE_DIR:photoy-engine>")
