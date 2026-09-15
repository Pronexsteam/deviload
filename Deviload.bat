@echo off
rem Deviload.bat  - kept for compatibility; it just hands over to the console-free Deviload.vbs launcher.
rem The cmd window of this .bat closes immediately; double-click Deviload.vbs directly to avoid even that flash.
wscript //B //Nologo "%~dp0Deviload.vbs"
