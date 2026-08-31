@echo off
setlocal
rem Configures and builds the native engine. Usage: build-native.bat [Release^|Debug]

set "CONFIG=%~1"
if "%CONFIG%"=="" set "CONFIG=Release"

call "%~dp0env.bat"
if errorlevel 1 exit /b 1

if not exist "%PHOTOY_VCPKG%\vcpkg.exe" (
  echo [photoy] vcpkg is not bootstrapped. Run scripts\setup-windows.bat first.
  exit /b 1
)

set "BUILD_DIR=%PHOTOY_ROOT%\build\%CONFIG%"

cmake -S "%PHOTOY_ROOT%" -B "%BUILD_DIR%" -G Ninja ^
  -DCMAKE_BUILD_TYPE=%CONFIG% ^
  -DCMAKE_TOOLCHAIN_FILE="%PHOTOY_VCPKG%\scripts\buildsystems\vcpkg.cmake" ^
  -DVCPKG_TARGET_TRIPLET=%PHOTOY_TRIPLET% ^
  -DVCPKG_INSTALLED_DIR="%PHOTOY_ROOT%\.tooling\vcpkg_installed" ^
  -DVCPKG_MANIFEST_INSTALL=OFF
if errorlevel 1 exit /b 1

cmake --build "%BUILD_DIR%"
if errorlevel 1 exit /b 1

rem Publish the engine where the desktop app looks for it.
set "ENGINE_OUT=%PHOTOY_ROOT%\apps\desktop\resources\engine"
if not exist "%ENGINE_OUT%" mkdir "%ENGINE_OUT%"
copy /y "%BUILD_DIR%\bin\photoy-engine.exe" "%ENGINE_OUT%\photoy-engine.exe" >nul
if errorlevel 1 (
  rem The published binary is held open while the app is running, and the copy
  rem fails with a message that says nothing about why.
  tasklist /fi "imagename eq photoy-engine.exe" 2>nul | find /i "photoy-engine.exe" >nul
  if not errorlevel 1 (
    echo [photoy] the engine is running - close the app and build again.
  ) else (
    echo [photoy] could not publish the engine to %ENGINE_OUT%.
  )
  exit /b 1
)

copy /y "%BUILD_DIR%\bin\onnxruntime.dll" "%ENGINE_OUT%\onnxruntime.dll" >nul
if not exist "%ENGINE_OUT%\models" mkdir "%ENGINE_OUT%\models"
copy /y "%PHOTOY_ROOT%\.tooling\models\u2netp.onnx" "%ENGINE_OUT%\models\u2netp.onnx" >nul
if exist "%PHOTOY_ROOT%\.tooling\models\lama.onnx" copy /y "%PHOTOY_ROOT%\.tooling\models\lama.onnx" "%ENGINE_OUT%\models\lama.onnx" >nul

echo [photoy] engine built: %ENGINE_OUT%\photoy-engine.exe
exit /b 0
