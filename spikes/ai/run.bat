@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%~dp0..\.."
echo.
echo == u2netp (4,4 MB) ==
segment.exe "%ROOT%\.tooling\models\u2netp.onnx" "%ROOT%\.tmp\subject.rgba" 1800 1200 "%ROOT%\.tmp\mask-u2netp.gray"
echo.
echo == u2net (168 MB) ==
segment.exe "%ROOT%\.tooling\models\u2net.onnx" "%ROOT%\.tmp\subject.rgba" 1800 1200 "%ROOT%\.tmp\mask-u2net.gray"
