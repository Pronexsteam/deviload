!include "${__FILEDIR__}\locales\ru.nsh"

; Deviload installs for the current user without administrator rights, and so do its updates.
; A folder the user cannot write to (anything inside Program Files) used to fail halfway through
; the copy with a cryptic NSIS error, so the folder is checked before a single file is copied.
; The texts follow the installer language: Russian (1049), Spanish (1034), English otherwise.

!macro DEVILOAD_TEXT VAR EN RU ES
  StrCpy ${VAR} "${EN}"
  StrCmp $LANGUAGE 1049 0 +2
    StrCpy ${VAR} "${RU}"
  StrCmp $LANGUAGE 1034 0 +2
    StrCpy ${VAR} "${ES}"
!macroend

!macro NSIS_HOOK_PREINSTALL
  ClearErrors
  CreateDirectory "$INSTDIR"
  FileOpen $R0 "$INSTDIR\.deviload-write-test" w
  IfErrors 0 deviload_writable
    !insertmacro DEVILOAD_TEXT $R1 \
      "Deviload can't write to this folder:$\r$\n$INSTDIR$\r$\n$\r$\nIt needs administrator rights, like any folder inside Program Files, and Deviload installs and updates without them.$\r$\n$\r$\nRun the installer again and keep the suggested folder, or pick your own, for example D:\Apps\Deviload." \
      "${DEVILOAD_RU_0}" \
      "Deviload no puede escribir en esta carpeta:$\r$\n$INSTDIR$\r$\n$\r$\nNecesita permisos de administrador, como cualquier carpeta dentro de Program Files, y Deviload se instala y se actualiza sin ellos.$\r$\n$\r$\nVuelve a ejecutar el instalador y deja la carpeta sugerida, o elige otra, por ejemplo D:\Apps\Deviload."
    MessageBox MB_ICONSTOP|MB_OK "$R1" /SD IDOK
    Abort
  deviload_writable:
  FileClose $R0
  Delete "$INSTDIR\.deviload-write-test"

  ; Writable inside Program Files means the installer runs as administrator; updates will not.
  StrLen $R3 "$INSTDIR"
  StrCpy $R2 0
  deviload_scan:
    IntCmp $R2 $R3 deviload_checked 0 deviload_checked
    StrCpy $R4 "$INSTDIR" 13 $R2
    StrCmp $R4 "Program Files" deviload_program_files
    IntOp $R2 $R2 + 1
    Goto deviload_scan
  deviload_program_files:
    !insertmacro DEVILOAD_TEXT $R1 \
      "This folder is inside Program Files:$\r$\n$INSTDIR$\r$\n$\r$\nDeviload will install, but its automatic updates run without administrator rights and will not be able to replace it here.$\r$\n$\r$\nInstall here anyway? Choose No to stop and pick another folder." \
      "${DEVILOAD_RU_1}" \
      "Esta carpeta está dentro de Program Files:$\r$\n$INSTDIR$\r$\n$\r$\nDeviload se instalará, pero sus actualizaciones automáticas funcionan sin permisos de administrador y no podrán reemplazarlo aquí.$\r$\n$\r$\n¿Instalar aquí de todos modos? Elige No para detener la instalación y escoger otra carpeta."
    MessageBox MB_ICONEXCLAMATION|MB_YESNO "$R1" /SD IDYES IDYES deviload_checked
    Abort
  deviload_checked:
!macroend

; On a first install, and only then, the installer asks how Deviload will be used. The answer waits in a
; small file that the app takes on its first start. Updates and silent installs never ask: by then the
; app's data folder already exists.
!macro NSIS_HOOK_POSTINSTALL
  IfSilent deviload_mode_done
  IfFileExists "$LOCALAPPDATA\com.deviload.desktop\*.*" deviload_mode_done
  IfFileExists "$APPDATA\com.deviload.desktop\*.*" deviload_mode_done
    !insertmacro DEVILOAD_TEXT $R1 \
      "How will you use Deviload?$\r$\n$\r$\nYes - only Devil Music: a music player and nothing else around it.$\r$\nNo - everything: music, downloads, Cinema, Cut and Convert.$\r$\n$\r$\nYou can change this later in music settings." \
      "${DEVILOAD_RU_2}" \
      "¿Cómo usarás Deviload?$\r$\n$\r$\nSí - solo Devil Music: un reproductor de música y nada más.$\r$\nNo - todo: música, descargas, Cinema, Cut y Convert.$\r$\n$\r$\nPuedes cambiarlo más tarde en los ajustes de música."
    StrCpy $R2 "all"
    MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON2 "$R1" /SD IDNO IDNO deviload_mode_write
    StrCpy $R2 "music"
  deviload_mode_write:
    CreateDirectory "$LOCALAPPDATA\com.deviload.desktop"
    ClearErrors
    FileOpen $R0 "$LOCALAPPDATA\com.deviload.desktop\install-mode" w
    IfErrors deviload_mode_done
    FileWrite $R0 "$R2"
    FileClose $R0
  deviload_mode_done:
!macroend
