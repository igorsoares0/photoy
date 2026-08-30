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
if errorlevel 1 exit /b 1

echo [photoy] engine built: %ENGINE_OUT%\photoy-engine.exe
exit /b 0
