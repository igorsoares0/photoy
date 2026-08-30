@echo off
setlocal
rem One-time Windows setup: build tooling, C++ dependencies, npm packages.

set "PHOTOY_ROOT=%~dp0.."
for %%I in ("%PHOTOY_ROOT%") do set "PHOTOY_ROOT=%%~fI"

echo [photoy] 1/4 build tooling
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

echo [photoy] 2/4 vcpkg
if not exist "%PHOTOY_ROOT%\.tooling\vcpkg\.git" (
  git clone --depth 1 https://github.com/microsoft/vcpkg.git "%PHOTOY_ROOT%\.tooling\vcpkg"
  if errorlevel 1 exit /b 1
)
if not exist "%PHOTOY_ROOT%\.tooling\vcpkg\vcpkg.exe" (
  call "%PHOTOY_ROOT%\.tooling\vcpkg\bootstrap-vcpkg.bat" -disableMetrics
  if errorlevel 1 exit /b 1
)

echo [photoy] 3/4 image codecs (first run takes several minutes)
call "%~dp0env.bat"
if errorlevel 1 exit /b 1
"%PHOTOY_VCPKG%\vcpkg.exe" install --triplet %PHOTOY_TRIPLET% --x-install-root="%PHOTOY_ROOT%\.tooling\vcpkg_installed"
if errorlevel 1 exit /b 1

echo [photoy] 4/4 npm packages
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
