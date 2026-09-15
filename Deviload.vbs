' Deviload.vbs  - console-free launcher for YT-Downloader.ps1 (the recommended way to start the script version).
' WScript.Shell.Run with window style 0 creates the PowerShell host window hidden from the start, so nothing flashes.
Dim sh, dir
Set sh = CreateObject("WScript.Shell")
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & dir & "YT-Downloader.ps1""", 0, False
