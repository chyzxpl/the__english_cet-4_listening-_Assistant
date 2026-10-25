@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   知识问答 Agent 正在启动...
echo   浏览器打开: http://localhost:5173
echo   按 Ctrl+C 停止
echo.
where python >nul 2>nul && (python -m http.server 5173 --bind 127.0.0.1) || (py -m http.server 5173 --bind 127.0.0.1)
pause
