@echo off
REM Autoröntgen – käynnistys Windowsissa. Vaatii Node.js 18+ (https://nodejs.org, LTS-versio).
REM Tuplaklikkaa tätä tiedostoa. Valinnainen salasana: aseta ennen käynnistystä  set BASIC_AUTH=kayttaja:salasana
cd /d "%~dp0.."
where node >nul 2>nul || (echo Node.js puuttuu. Asenna https://nodejs.org ja aja uudelleen. & pause & exit /b 1)
if "%PORT%"=="" set PORT=8787
start "" http://localhost:%PORT%
node server.js
pause
