@echo off
echo =======================================
echo Cleaning Temporary Files and History...
echo =======================================

:: Clear User Temp Folder
echo Clearing User Temp Folder...
del /f /s /q "%TEMP%\*.*" >nul 2>&1
for /d %%x in ("%TEMP%\*") do rd /s /q "%%x" >nul 2>&1

:: Clear Windows Temp Folder
echo Clearing Windows Temp Folder...
del /f /s /q "C:\Windows\Temp\*.*" >nul 2>&1
for /d %%x in ("C:\Windows\Temp\*") do rd /s /q "%%x" >nul 2>&1

:: Clear Internet Explorer / Legacy Internet Cache
echo Clearing Internet Explorer Cache...
RunDll32.exe InetCpl.cpl,ClearMyTracksByProcess 255

:: Clear Microsoft Edge Cache and History
echo Clearing Microsoft Edge Data...
taskkill /F /IM msedge.exe >nul 2>&1
rd /s /q "%LocalAppData%\Microsoft\Edge\User Data\Default\Cache" >nul 2>&1
del /f /q "%LocalAppData%\Microsoft\Edge\User Data\Default\History" >nul 2>&1

:: Clear Google Chrome Cache and History
echo Clearing Google Chrome Data...
taskkill /F /IM chrome.exe >nul 2>&1
rd /s /q "%LocalAppData%\Google\Chrome\User Data\Default\Cache" >nul 2>&1
del /f /q "%LocalAppData%\Google\Chrome\User Data\Default\History" >nul 2>&1

:: Flush DNS Cache
echo Flushing DNS Cache...
ipconfig /flushdns

echo.
echo Cleanup Complete.
pause