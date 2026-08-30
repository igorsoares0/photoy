@echo off
setlocal
rem Espinho de inferencia. Fora do build do produto - ver README.md.
call "%~dp0..\..\scripts\env.bat"
if errorlevel 1 exit /b 1

set "ORT=%PHOTOY_ROOT%\.tooling\onnxruntime"
if not exist "%ORT%\lib\onnxruntime.lib" (
  echo [espinho] ONNX Runtime nao encontrado em %ORT%
  exit /b 1
)

cd /d "%~dp0"
cl /nologo /O2 /MD /EHsc /std:c++17 /w /DNOMINMAX /DWIN32_LEAN_AND_MEAN /I"%ORT%\include" segment.cpp /Fe:segment.exe ^
   /link "%ORT%\lib\onnxruntime.lib" psapi.lib
if errorlevel 1 exit /b 1

copy /y "%ORT%\lib\onnxruntime.dll" . >nul
copy /y "%ORT%\lib\onnxruntime_providers_shared.dll" . >nul
echo [espinho] compilado
