@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
set GIT_TERMINAL_PROMPT=0
set LOG=push-log.txt
title inaka 工作台 - 配置 GitHub 推送

echo ===== 运行时间 %date% %time% ===== > "%LOG%"
echo. >> "%LOG%"

echo ============================================================
echo    inaka 工作台 - 配置 GitHub 推送
echo ============================================================
echo.
echo   上次失败的原因已经找到了：
echo   这台电脑没有保存任何 GitHub 凭据，
echo   git 连用户名都拿不到，所以推送被拒绝。
echo.
echo   这次粘一次 token 就好。存好之后永久生效，
echo   以后所有改动我都能直接推，你不用再管。
echo.
echo ------------------------------------------------------------
echo   第 1 步：按任意键，浏览器会自动打开（权限我已预填好）
echo           - 点页面最下面的绿色 [Generate token]
echo           - 点生成的 token 右边的复制图标
echo   第 2 步：回到这个窗口，在 "Token:" 后面点右键粘贴，回车
echo ------------------------------------------------------------
echo.
pause

start "" "https://github.com/settings/tokens/new?scopes=repo&description=inaka-web-push"
echo.
echo   浏览器已打开，去生成 token 吧...
echo.
set "TOKEN="
set /p TOKEN=Token:

if not defined TOKEN (
    echo.
    echo [取消] 没有输入 token，什么都没做。
    echo        改动都还在本地，一个都没丢。
    echo.
    pause
    exit /b 1
)

echo.
echo [1/3] 保存凭据到本机（永久生效）...
cmdkey /generic:git:https://github.com /user:x-access-token /pass:%TOKEN% >>"%LOG%" 2>&1
if errorlevel 1 (
    echo       [警告] 保存失败，但仍会继续尝试推送
    echo [警告] cmdkey 保存失败 >> "%LOG%"
) else (
    echo       [OK] 已保存，以后不用再输
)

echo.
echo [2/3] 推送到 GitHub Pages ...
echo.

set RETRY=0

:PUSHLOOP
set /a RETRY+=1
echo ----- 第 %RETRY% 次尝试 ----- >> "%LOG%"
echo   第 %RETRY% 次尝试...
git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push origin main >>"%LOG%" 2>&1
if not errorlevel 1 goto :PUSHOk

if %RETRY% GEQ 5 goto :PUSHFail
echo      没成功，3 秒后重试（网络抖动是常事）
timeout /t 3 /nobreak >nul
goto :PUSHLOOP

:PUSHFail
echo.
echo ============================================================
echo   [失败] 试了 5 次都没成功
echo.
echo   详细原因已经写进 push-log.txt，现在帮你打开，
echo   把里面的内容截图发给我，我来接着处理。
echo ============================================================
echo.
start notepad "%LOG%"
pause
exit /b 1

:PUSHOk
echo.
echo [3/3] 推送成功！
echo.
echo ============================================================
echo   线上地址（固定不变）：
echo   https://ck2010hh-hue.github.io/inaka-web/
echo.
echo   注意：GitHub Pages 有 1-2 分钟缓存，
echo        刷新后没变化的话，等两分钟再刷一次。
echo.
echo   以后我改完代码会自动推送，你刷新就能看到，
echo   不用再做任何操作。
echo.
echo   想更保险可以去 GitHub 删掉这个 token，
echo   凭据已经存本机了，删云端的不影响推送。
echo ============================================================
echo.
pause
