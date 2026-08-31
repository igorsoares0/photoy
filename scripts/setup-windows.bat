@echo off
setlocal
rem One-time Windows setup: build tooling, C++ dependencies, npm packages.

set "PHOTOY_ROOT=%~dp0.."
for %%I in ("%PHOTOY_ROOT%") do set "PHOTOY_ROOT=%%~fI"

echo [photoy] 1/5 build tooling
where python >nul 2>&1
if errorlevel 1 (
  echo [photoy] python was not found on PATH. Install Python 3.10+ and retry.
  exit /b 1
)
if not exist "%PHOTOY_ROOT%\.tooling\pyenv\Scripts\cmake.exe" (
  python -m venv "%PHOTOY_ROOT%\.tooling\pyenv"
  if errorlevel 1 exit /b 1
  rem CMake is pinned below 4 because several vcpkg ports still declare a
  rem minimum CMake version that 4.x refuses to accept.
  "%PHOTOY_ROOT%\.tooling\pyenv\Scripts\python.exe" -m pip install --quiet "cmake<4" ninja
  if errorlevel 1 exit /b 1
)

echo [photoy] 2/5 vcpkg
if not exist "%PHOTOY_ROOT%\.tooling\vcpkg\.git" (
  git clone --depth 1 https://github.com/microsoft/vcpkg.git "%PHOTOY_ROOT%\.tooling\vcpkg"
  if errorlevel 1 exit /b 1
)
if not exist "%PHOTOY_ROOT%\.tooling\vcpkg\vcpkg.exe" (
  call "%PHOTOY_ROOT%\.tooling\vcpkg\bootstrap-vcpkg.bat" -disableMetrics
  if errorlevel 1 exit /b 1
)

echo [photoy] 3/5 image codecs (first run takes several minutes)
call "%~dp0env.bat"
if errorlevel 1 exit /b 1
"%PHOTOY_VCPKG%\vcpkg.exe" install --triplet %PHOTOY_TRIPLET% --x-install-root="%PHOTOY_ROOT%\.tooling\vcpkg_installed"
if errorlevel 1 exit /b 1

echo [photoy] 4/5 inference runtime and model
set "ORT_VERSION=1.28.1"
if not exist "%PHOTOY_ROOT%\.tooling\onnxruntime\lib\onnxruntime.lib" (
  rem ONNX Runtime is MIT; the official prebuilt is used rather than a source
  rem build, which takes the better part of an hour for no benefit here.
  curl -sL -o "%PHOTOY_ROOT%\.tooling\ort.zip" ^
    "https://github.com/microsoft/onnxruntime/releases/download/v%ORT_VERSION%/onnxruntime-win-x64-%ORT_VERSION%.zip"
  if errorlevel 1 exit /b 1
  powershell -NoProfile -Command "Expand-Archive -Force '%PHOTOY_ROOT%\.tooling\ort.zip' '%PHOTOY_ROOT%\.tooling\ort'"
  if errorlevel 1 exit /b 1
  powershell -NoProfile -Command "Move-Item -Force '%PHOTOY_ROOT%\.tooling\ort\onnxruntime-win-x64-%ORT_VERSION%' '%PHOTOY_ROOT%\.tooling\onnxruntime'"
  del /q "%PHOTOY_ROOT%\.tooling\ort.zip"
)
if not exist "%PHOTOY_ROOT%\.tooling\models\u2netp.onnx" (
  rem U^2-Net weights are Apache-2.0. Models with non-commercial terms are
  rem deliberately excluded: the V1 has to be commercially viable.
  if not exist "%PHOTOY_ROOT%\.tooling\models" mkdir "%PHOTOY_ROOT%\.tooling\models"
  curl -sL -o "%PHOTOY_ROOT%\.tooling\models\u2netp.onnx" ^
    "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx"
  if errorlevel 1 exit /b 1
)
if not exist "%PHOTOY_ROOT%\.tooling\models\lama.onnx" (
  echo Downloading LaMa inpainting model ^(92 MB, Apache-2.0^)...
  curl -sL -o "%PHOTOY_ROOT%\.tooling\models\lama.onnx" ^
    "https://huggingface.co/opencv/inpainting_lama/resolve/main/inpainting_lama_2025jan.onnx"
)


echo [photoy] 5/5 npm packages
pushd "%PHOTOY_ROOT%"
call npm install
set "NPM_STATUS=%errorlevel%"
popd
if not "%NPM_STATUS%"=="0" exit /b 1

rem The Electron postinstall is occasionally skipped in a workspace install,
rem which leaves the package present but the binary missing.
if not exist "%PHOTOY_ROOT%\node_modules\electron\dist\electron.exe" (
  echo [photoy] fetching the Electron binary
  pushd "%PHOTOY_ROOT%\node_modules\electron"
  call node install.js
  set "ELECTRON_STATUS=%errorlevel%"
  popd
  if not "%ELECTRON_STATUS%"=="0" exit /b 1
)

echo [photoy] setup complete. Next: npm run build ^&^& npm run dev
exit /b 0
