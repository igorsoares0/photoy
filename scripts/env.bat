@echo off
rem Locates the Windows build toolchain and puts it on PATH for the caller.
rem Kept separate so build-native.bat and setup-windows.bat agree on one source.

set "PHOTOY_ROOT=%~dp0.."
for %%I in ("%PHOTOY_ROOT%") do set "PHOTOY_ROOT=%%~fI"

set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" (
  echo [photoy] Visual Studio Installer not found.
  echo [photoy] Install "Desktop development with C++" from the Visual Studio Build Tools.
  exit /b 1
)

rem -all is deliberate: an installation the installer flags as incomplete is
rem still perfectly usable for building, and is otherwise filtered out.
set "VSINSTALL="
for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -all -latest -prerelease -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul`) do set "VSINSTALL=%%I"
if not defined VSINSTALL (
  for /f "usebackq tokens=*" %%I in (`"%VSWHERE%" -all -latest -prerelease -products * -property installationPath 2^>nul`) do set "VSINSTALL=%%I"
)
if not defined VSINSTALL (
  echo [photoy] No Visual Studio installation with the C++ toolset was found.
  echo [photoy] Install "Desktop development with C++" from the Visual Studio Build Tools.
  exit /b 1
)
if not exist "%VSINSTALL%\VC\Auxiliary\Build\vcvars64.bat" (
  echo [photoy] Found "%VSINSTALL%" but it has no x64 C++ toolset.
  exit /b 1
)

call "%VSINSTALL%\VC\Auxiliary\Build\vcvars64.bat" >nul
if errorlevel 1 (
  echo [photoy] Failed to initialise the x64 MSVC environment.
  exit /b 1
)

rem CMake and Ninja live in a project-local virtualenv so the repo does not
rem depend on whatever happens to be installed system-wide.
set "PHOTOY_PYENV=%PHOTOY_ROOT%\.tooling\pyenv\Scripts"
if exist "%PHOTOY_PYENV%\cmake.exe" set "PATH=%PHOTOY_PYENV%;%PATH%"

where cmake >nul 2>&1
if errorlevel 1 (
  echo [photoy] cmake not found. Run scripts\setup-windows.bat first.
  exit /b 1
)

set "PHOTOY_VCPKG=%PHOTOY_ROOT%\.tooling\vcpkg"
set "PHOTOY_TRIPLET=x64-windows-static-md"
exit /b 0
