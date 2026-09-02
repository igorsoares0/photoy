find_package(nlohmann_json CONFIG REQUIRED)
find_package(libjpeg-turbo CONFIG REQUIRED)
find_package(libpng CONFIG REQUIRED)
find_package(TIFF REQUIRED)
find_package(WebP CONFIG REQUIRED)
find_package(lcms CONFIG REQUIRED)
find_package(libzip CONFIG REQUIRED)
# LibRaw is dual licensed, LGPL-2.1-only or CDDL-1.0, and the choice is ours.
# We take CDDL-1.0: its copyleft is per file, so it reaches modifications to
# LibRaw's own sources and nothing else, which is what makes it compatible with
# linking the library statically into a proprietary binary. The LGPL branch is
# not, under static linking. Nothing here modifies LibRaw.
find_package(libraw CONFIG REQUIRED)

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
  src/color/temperature.cpp
  src/color/output.cpp
  src/color/pipeline.cpp

  src/protocol/frame.cpp
  src/protocol/stdio_transport.cpp

  src/image/image_buffer.cpp
  src/image/rect.cpp
  src/image/resample.cpp
  src/image/orientation.cpp

  src/edit/adjustments.cpp
  src/edit/curve.cpp
  src/edit/layer.cpp
  src/edit/mask.cpp
  src/edit/decontaminate.cpp
  src/edit/patch.cpp
  src/edit/detail.cpp
  src/edit/analysis.cpp
  src/edit/operation.cpp
  src/edit/edit_stack.cpp
  src/edit/render.cpp
  src/edit/serialize.cpp

  src/project/project.cpp
  src/project/mask_image.cpp

  src/ai/model_manager.cpp
  src/ai/compute_dml.cpp
  src/ai/segmenter.cpp
  src/ai/face_detector.cpp
  src/ai/inpainter.cpp
  src/ai/denoiser.cpp

  src/jobs/job_queue.cpp

  src/decoder/format_sniffer.cpp
  src/decoder/jpeg_marker.cpp
  src/decoder/exif.cpp
  src/decoder/jpeg_decoder.cpp
  src/decoder/png_decoder.cpp
  src/decoder/tiff_decoder.cpp
  src/decoder/webp_decoder.cpp
  src/decoder/raw_decoder.cpp
  src/decoder/heif_decoder.cpp
  src/decoder/decode.cpp

  src/export/jpeg_encoder.cpp
  src/export/png_encoder.cpp
  src/export/tiff_encoder.cpp
  src/export/webp_encoder.cpp
  src/export/encode.cpp

  src/engine/thumbnail.cpp
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
  # The reentrant build: image.open runs on the job queue, so two decodes
  # can be in flight at once.
  #
  # Built with OpenMP, which is where a raw open got most of its speed: the
  # demosaic of a 24 MP frame went from 2.9 s to 0.9 s. It adds VCOMP140.DLL to
  # the engine's imports, from the same Visual C++ redistributable that already
  # supplies MSVCP140 and VCRUNTIME140, so packaging gains a file but no new
  # dependency.
  libraw::raw_r
  "${PHOTOY_ORT}/lib/onnxruntime.lib"
)

# The runtime is a DLL; it has to sit beside the engine to be found.
add_custom_command(TARGET photoy-engine POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_if_different
          "${PHOTOY_ORT}/lib/onnxruntime.dll" "$<TARGET_FILE_DIR:photoy-engine>")

if(WIN32)
  # Both are Windows SDK libraries, so neither adds a dependency. Kept here
  # rather than in the list above because the port to macOS reaches these two
  # through ImageIO and Metal instead, and a link line that named them
  # unconditionally would not configure there at all.
  #
  #   dxgi          enumerates the graphics adapters for ai/compute.h
  #   windowscodecs decodes HEIC, which is how it is read without shipping HEVC
  target_link_libraries(photoy-engine PRIVATE dxgi windowscodecs)

  # Test-only. Makes the HEIC fixtures with the platform's own codec, because
  # there is no HEIC encoder in this tree and deliberately never will be. Built
  # beside the engine so `npm test` can reach it; ships with nothing.
  add_executable(photoy-heic-fixture tools/heic_fixture.cpp)
  target_link_libraries(photoy-heic-fixture PRIVATE windowscodecs ole32)
  set_target_properties(photoy-heic-fixture PROPERTIES OUTPUT_NAME "heic-fixture")
endif()
