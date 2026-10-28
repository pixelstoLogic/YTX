!define MUI_WELCOMEPAGE_TITLE "Install YTX Studio"
!define MUI_WELCOMEPAGE_TEXT "Preview online video, trim a selected range, then export video or audio.$\r$\n$\r$\nCopyright © 2026 ARYAN ARYA."

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro removeLegacyClipForge LEGACY_DIR
  StrCpy $R5 "${LEGACY_DIR}"
  IfFileExists "$R5\ClipForge Studio.exe" 0 +5
  DetailPrint "Removing previous ClipForge Studio install at $R5..."
  IfFileExists "$R5\uninstaller.exe" 0 +2
  ExecWait '"$R5\uninstaller.exe" /S _?=$R5' $0
  IfFileExists "$R5\ClipForge Studio.exe" 0 +2
  RMDir /r "$R5"
!macroend

!macro removeRegisteredClipForge REG_ROOT
  ReadRegStr $R4 ${REG_ROOT} "Software\com.aryanarya.clipforgestudio" InstallLocation
  ${If} $R4 != ""
    !insertmacro removeLegacyClipForge "$R4"
  ${EndIf}
!macroend

!macro customInstall
  SetDetailsPrint both
  DetailPrint "Replacing existing YTX installation and cleaning legacy ClipForge Studio installs..."
  !insertmacro removeRegisteredClipForge HKCU
  !insertmacro removeRegisteredClipForge HKLM
  !insertmacro removeLegacyClipForge "$LOCALAPPDATA\Programs\ClipForge Studio"
  !insertmacro removeLegacyClipForge "$PROGRAMFILES64\ClipForge Studio"
  !insertmacro removeLegacyClipForge "$PROGRAMFILES\ClipForge Studio"
  Delete "$SMPROGRAMS\ClipForge Studio\ClipForge Studio.lnk"
  Delete "$DESKTOP\ClipForge Studio.lnk"
  DetailPrint "Application files: YTX.exe and resources\app.asar"
  DetailPrint "Python bridge: resources\backend.py"
  DetailPrint "Bundled media tool: resources\ffmpeg\ffmpeg.exe"
  DetailPrint "Python bootstrap: resources\bootstrap\python-installer\python-3.12.10-amd64.exe"
  DetailPrint "Offline dependency: resources\bootstrap\python-wheels\yt-dlp wheel"
  DetailPrint "Third-party license notices: resources\THIRD_PARTY_NOTICES.txt"
  StrCpy $R2 "$INSTDIR\resources"
  CreateDirectory "$R2"
  FileOpen $R4 "$R2\ytx-write-test.tmp" w
  IfErrors python_use_user_folder
  FileClose $R4
  Delete "$R2\ytx-write-test.tmp"
  Goto python_install_root_ready
  python_use_user_folder:
  StrCpy $R2 "$LOCALAPPDATA\YTX"
  CreateDirectory "$R2"
  python_install_root_ready:

  StrCpy $R0 "$R2\python-runtime\python.exe"
  IfFileExists "$R0" python_runtime_ready
  DetailPrint "Installing bundled Python to $R2 (showing Python setup progress)..."
  ExecWait '"$INSTDIR\resources\bootstrap\python-installer\python-3.12.10-amd64.exe" /passive InstallAllUsers=0 "TargetDir=$R2\python-runtime" Include_pip=1 Include_test=0 Include_tcltk=0 Include_doc=0 Shortcuts=0 PrependPath=0 AppendPath=0 /log "$INSTDIR\python-install.log"' $0
  IfFileExists "$R2\python-runtime\python.exe" python_runtime_ready
  DetailPrint "Retrying Python installation in this user's local YTX folder..."
  StrCpy $R2 "$LOCALAPPDATA\YTX"
  CreateDirectory "$R2"
  IfFileExists "$R2\python-runtime\python.exe" python_runtime_ready
  ExecWait '"$INSTDIR\resources\bootstrap\python-installer\python-3.12.10-amd64.exe" /passive InstallAllUsers=0 "TargetDir=$R2\python-runtime" Include_pip=1 Include_test=0 Include_tcltk=0 Include_doc=0 Shortcuts=0 PrependPath=0 AppendPath=0 /log "$INSTDIR\python-install.log"' $0
  IfFileExists "$R2\python-runtime\python.exe" python_runtime_ready
  DetailPrint "Checking Python's standard per-user install location..."
  StrCpy $R0 "$LOCALAPPDATA\Programs\Python\Python312\python.exe"
  IfFileExists "$R0" python_runtime_ready
  StrCpy $R0 "$PROGRAMFILES64\Python312\python.exe"
  IfFileExists "$R0" python_runtime_ready
  MessageBox MB_ICONSTOP "Python setup failed (code $0). See $INSTDIR\python-install.log for details."
  Abort
  python_runtime_ready:
  IfFileExists "$R2\python-runtime\python.exe" ytx_select_managed_python
  Goto ytx_python_selected
  ytx_select_managed_python:
  StrCpy $R0 "$R2\python-runtime\python.exe"
  ytx_python_selected:

  IfFileExists "$R2\python-venv\Scripts\python.exe" python_venv_ready
  DetailPrint "Creating YTX's isolated Python environment in $R2 (details appear in the installer log)..."
  nsExec::ExecToLog '"$R0" -m venv "$R2\python-venv"'
  Pop $0
  IfFileExists "$R2\python-venv\Scripts\python.exe" python_venv_ready
  DetailPrint "Retrying virtual environment creation in this user's local YTX folder..."
  StrCpy $R2 "$LOCALAPPDATA\YTX"
  CreateDirectory "$R2"
  IfFileExists "$R2\python-venv\Scripts\python.exe" python_venv_ready
  nsExec::ExecToLog '"$R0" -m venv "$R2\python-venv"'
  Pop $0
  IfFileExists "$R2\python-venv\Scripts\python.exe" python_venv_ready
  MessageBox MB_ICONSTOP "The private Python environment could not be created (code $0). Python setup log: $INSTDIR\python-install.log. Check the installer details panel for the venv error."
  Abort
  python_venv_ready:

  DetailPrint "Installing yt-dlp from the bundled offline package..."
  ExecWait '"$R2\python-venv\Scripts\python.exe" -m pip install --disable-pip-version-check --no-index --find-links "$INSTDIR\resources\bootstrap\python-wheels" yt-dlp' $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "yt-dlp could not be installed from the bundled package (code $0). See $INSTDIR\python-install.log for setup details."
    Abort
  ${EndIf}
  DetailPrint "Installing YTX Bridge panels for Adobe Premiere Pro and After Effects..."
  CreateDirectory "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS"
  CreateDirectory "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\jsx"
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\CSXS\manifest.xml" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS"
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\index.html" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge"
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\panel.css" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge"
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\panel.js" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge"
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\jsx\host.jsx" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\jsx"
  DetailPrint "Preparing the optional YTX YouTube helper for Chrome and Edge..."
  CreateDirectory "$LOCALAPPDATA\YTX\browser-extension"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\manifest.json" "$LOCALAPPDATA\YTX\browser-extension"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\content.js" "$LOCALAPPDATA\YTX\browser-extension"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\README.txt" "$LOCALAPPDATA\YTX\browser-extension"
  DetailPrint "Open Chrome or Edge extensions, enable Developer mode, then choose Load unpacked and select $LOCALAPPDATA\YTX\browser-extension."
  DetailPrint "Adobe CEP developer mode was left unchanged; see YTX help to enable unsigned local panels if needed."
  RMDir /r "$INSTDIR\resources\bootstrap"
!macroend

!macro customUnInstall
  RMDir /r "$APPDATA\Adobe\CEP\extensions\YTX-Bridge"
!macroend

