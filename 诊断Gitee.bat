@echo off
chcp 936 >nul
title Gitee 连通性诊断
cd /d "%~dp0"
echo.
echo ============================================================
echo    Gitee 连通性诊断
echo    用于排查工作台 "同步失败：无法连接 Gitee"
echo ============================================================
echo.
echo 测试 4 个地址，请稍候（约 10 秒）...
echo.
echo ------------------------------------------------------------
echo  结果   地址                     状态码   含义
echo ------------------------------------------------------------

call :t "Gitee 首页" "https://gitee.com"
call :t "Gitee API 接口" "https://gitee.com/api/v5/user"
call :t "GitHub Pages(对比)" "https://ck2010hh-hue.github.io/inaka-web/"
call :t "百度(基础网络)" "https://www.baidu.com"

echo ------------------------------------------------------------
echo.
echo ============================================================
echo   怎么看结果
echo ============================================================
echo.
echo   [通]  HTTP 200 或 401 = 正常到达 Gitee
echo         （401 是没带令牌，属于正常）
echo   [X]   HTTP 000 或超时  = 连不上
echo.
echo   >>> 如果 4 项全部 [通]：
echo       你电脑网络没问题，是【浏览器】把请求拦了。
echo       请依次试这 3 步：
echo         1. 用无痕窗口 (Ctrl+Shift+N) 打开工作台再点同步
echo            无痕模式默认禁用所有插件，能成功 = 插件问题
echo         2. 临时关掉广告拦截插件
echo            (uBlock / AdBlock / AdGuard / 广告终结者 等)
echo            因为 Gitee 的 CDN 域名里含 baiduads，
echo            常被广告拦截规则误杀
echo         3. 换 Edge 或 Chrome 再试一次
echo.
echo   >>> 如果有 [X]：
echo       网络层不通，检查 VPN / 代理 / 公司网关。
echo       可试试切换手机热点。
echo.
echo ============================================================
echo.
pause
exit /b

:t
set "CODE=000"
for /f "delims=" %%i in ('curl -s -o nul -w "%%{http_code}" --max-time 12 "%~2"') do set "CODE=%%i"
if "%CODE%"=="200" goto :ok
if "%CODE%"=="401" goto :ok401
if "%CODE%"=="000" goto :bad
goto :other

:ok
echo   [通]   %~1              HTTP %CODE%
exit /b

:ok401
echo   [通]   %~1              HTTP %CODE%  (已到达Gitee，正常)
exit /b

:bad
echo   [X]    %~1              HTTP %CODE%  连不上
exit /b

:other
echo   [?]    %~1              HTTP %CODE%
exit /b
