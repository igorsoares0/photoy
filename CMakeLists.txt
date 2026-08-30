cmake_minimum_required(VERSION 3.21)

# The toolchain file must be set before project() for vcpkg to take effect;
# scripts/build-native.bat passes it on the configure command line.
project(photoy LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Link the dynamic CRT so the engine matches the x64-windows-static-md triplet:
# third-party code is static, the runtime is shared with the rest of the app.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")

set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

if(MSVC)
  add_compile_options(/W4 /permissive- /utf-8 /Zc:__cplusplus /EHsc)
  add_compile_definitions(NOMINMAX WIN32_LEAN_AND_MEAN _CRT_SECURE_NO_WARNINGS)
else()
  add_compile_options(-Wall -Wextra -Wpedantic)
endif()

add_subdirectory(apps/native)
