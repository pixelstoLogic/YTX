!define MUI_WELCOMEPAGE_TITLE "Install YTX Studio"
!define MUI_WELCOMEPAGE_TEXT "Preview online video, trim a selected range, then export video or audio.$\r$\n$\r$\nCopyright © 2026 ARYAN ARYA."
!define YTX_EXTENSION_UPDATE_URL "https://github.com/pixelstoLogic/YTX/releases/latest/download/updates.xml"

!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var YTXDialog
Var YTXPremiereBox
Var YTXAfterEffectsBox
Var YTXChromeBox
Var YTXEdgeBox
Var YTXBraveBox
Var YTXOperaBox
Var YTXVivaldiBox
Var YTXCepDebugBox
Var YTXInstallPremiere
Var YTXInstallAfterEffects
Var YTXInstallChrome
Var YTXInstallEdge
Var YTXInstallBrave
Var YTXInstallOpera
Var YTXInstallVivaldi
Var YTXEnableCepDebug
Var YTXDetectedPremiere
Var YTXDetectedAfterEffects
Var YTXDetectedChrome
Var YTXDetectedEdge
Var YTXDetectedBrave
Var YTXDetectedOpera
Var YTXDetectedVivaldi
Var YTXChoiceInitialized
Var YTXBadge
!endif

!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  Page custom YTXIntegrationsPageCreate YTXIntegrationsPageLeave
!macroend

!ifndef BUILD_UNINSTALLER
Function YTXIntegrationsPageCreate
  nsDialogs::Create 1018
  Pop $YTXDialog
  ${If} $YTXDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 20u "Choose where YTX should connect"
  Pop $YTXBadge
  ${NSD_CreateLabel} 0 22u 100% 26u "Detected apps start selected. Uncheck anything you do not want; unavailable apps stay disabled."
  Pop $YTXBadge

  StrCpy $YTXDetectedPremiere 0
  IfFileExists "$PROGRAMFILES64\Adobe\Adobe Premiere Pro 2026\Adobe Premiere Pro.exe" ytx_premiere_detected
  IfFileExists "$PROGRAMFILES64\Adobe\Adobe Premiere Pro 2025\Adobe Premiere Pro.exe" ytx_premiere_detected
  IfFileExists "$PROGRAMFILES64\Adobe\Adobe Premiere Pro 2024\Adobe Premiere Pro.exe" ytx_premiere_detected
  Goto ytx_premiere_detection_done
  ytx_premiere_detected:
  StrCpy $YTXDetectedPremiere 1
  ytx_premiere_detection_done:
  StrCpy $YTXDetectedAfterEffects 0
  IfFileExists "$PROGRAMFILES64\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe" ytx_aftereffects_detected
  IfFileExists "$PROGRAMFILES64\Adobe\Adobe After Effects 2025\Support Files\AfterFX.exe" ytx_aftereffects_detected
  IfFileExists "$PROGRAMFILES64\Adobe\Adobe After Effects 2024\Support Files\AfterFX.exe" ytx_aftereffects_detected
  Goto ytx_aftereffects_detection_done
  ytx_aftereffects_detected:
  StrCpy $YTXDetectedAfterEffects 1
  ytx_aftereffects_detection_done:

  StrCpy $YTXDetectedChrome 0
  IfFileExists "$LOCALAPPDATA\Google\Chrome\Application\chrome.exe" ytx_chrome_detected
  IfFileExists "$PROGRAMFILES64\Google\Chrome\Application\chrome.exe" ytx_chrome_detected
  IfFileExists "$PROGRAMFILES32\Google\Chrome\Application\chrome.exe" ytx_chrome_detected
  Goto ytx_chrome_detection_done
  ytx_chrome_detected:
  StrCpy $YTXDetectedChrome 1
  ytx_chrome_detection_done:
  StrCpy $YTXDetectedEdge 0
  IfFileExists "$LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe" ytx_edge_detected
  IfFileExists "$PROGRAMFILES64\Microsoft\Edge\Application\msedge.exe" ytx_edge_detected
  IfFileExists "$PROGRAMFILES32\Microsoft\Edge\Application\msedge.exe" ytx_edge_detected
  Goto ytx_edge_detection_done
  ytx_edge_detected:
  StrCpy $YTXDetectedEdge 1
  ytx_edge_detection_done:
  StrCpy $YTXDetectedBrave 0
  IfFileExists "$LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe" ytx_brave_detected
  IfFileExists "$PROGRAMFILES64\BraveSoftware\Brave-Browser\Application\brave.exe" ytx_brave_detected
  IfFileExists "$PROGRAMFILES32\BraveSoftware\Brave-Browser\Application\brave.exe" ytx_brave_detected
  Goto ytx_brave_detection_done
  ytx_brave_detected:
  StrCpy $YTXDetectedBrave 1
  ytx_brave_detection_done:
  StrCpy $YTXDetectedOpera 0
  IfFileExists "$LOCALAPPDATA\Programs\Opera\launcher.exe" ytx_opera_detected
  IfFileExists "$PROGRAMFILES64\Opera\launcher.exe" ytx_opera_detected
  IfFileExists "$PROGRAMFILES32\Opera\launcher.exe" ytx_opera_detected
  Goto ytx_opera_detection_done
  ytx_opera_detected:
  StrCpy $YTXDetectedOpera 1
  ytx_opera_detection_done:
  StrCpy $YTXDetectedVivaldi 0
  IfFileExists "$LOCALAPPDATA\Vivaldi\Application\vivaldi.exe" ytx_vivaldi_detected
  IfFileExists "$PROGRAMFILES64\Vivaldi\Application\vivaldi.exe" ytx_vivaldi_detected
  IfFileExists "$PROGRAMFILES32\Vivaldi\Application\vivaldi.exe" ytx_vivaldi_detected
  Goto ytx_vivaldi_detection_done
  ytx_vivaldi_detected:
  StrCpy $YTXDetectedVivaldi 1
  ytx_vivaldi_detection_done:

  ${If} $YTXChoiceInitialized != 1
    StrCpy $YTXInstallPremiere ${BST_UNCHECKED}
    StrCpy $YTXInstallAfterEffects ${BST_UNCHECKED}
    StrCpy $YTXInstallChrome ${BST_UNCHECKED}
    StrCpy $YTXInstallEdge ${BST_UNCHECKED}
    StrCpy $YTXInstallBrave ${BST_UNCHECKED}
    StrCpy $YTXInstallOpera ${BST_UNCHECKED}
    StrCpy $YTXInstallVivaldi ${BST_UNCHECKED}
    ${If} $YTXDetectedPremiere == 1
      StrCpy $YTXInstallPremiere ${BST_CHECKED}
    ${EndIf}
    ${If} $YTXDetectedAfterEffects == 1
      StrCpy $YTXInstallAfterEffects ${BST_CHECKED}
    ${EndIf}
    ${If} $YTXDetectedChrome == 1
      StrCpy $YTXInstallChrome ${BST_CHECKED}
    ${EndIf}
    ${If} $YTXDetectedEdge == 1
      StrCpy $YTXInstallEdge ${BST_CHECKED}
    ${EndIf}
    ${If} $YTXDetectedBrave == 1
      StrCpy $YTXInstallBrave ${BST_CHECKED}
    ${EndIf}
    ${If} $YTXDetectedOpera == 1
      StrCpy $YTXInstallOpera ${BST_CHECKED}
    ${EndIf}
    ${If} $YTXDetectedVivaldi == 1
      StrCpy $YTXInstallVivaldi ${BST_CHECKED}
    ${EndIf}
    StrCpy $YTXEnableCepDebug ${BST_UNCHECKED}
    ${If} $YTXDetectedPremiere == 1
    ${OrIf} $YTXDetectedAfterEffects == 1
      StrCpy $YTXEnableCepDebug ${BST_CHECKED}
    ${EndIf}
    StrCpy $YTXChoiceInitialized 1
  ${EndIf}

  ${NSD_CreateGroupBox} 0 53u 100% 92u "Adobe video apps"
  Pop $YTXBadge
  ${NSD_CreateLabel} 12u 68u 22u 22u "Pr"
  Pop $YTXBadge
  SetCtlColors $YTXBadge "FFFFFF" "7038B0"
  ${NSD_CreateCheckBox} 42u 68u 85% 22u "Adobe Premiere Pro    ·    Detected"
  Pop $YTXPremiereBox
  ${If} $YTXDetectedPremiere != 1
    ${NSD_SetText} $YTXPremiereBox "Adobe Premiere Pro    ·    Not detected"
    EnableWindow $YTXPremiereBox 0
  ${ElseIf} $YTXInstallPremiere == ${BST_CHECKED}
    ${NSD_Check} $YTXPremiereBox
  ${EndIf}
  ${NSD_CreateLabel} 12u 96u 22u 22u "Ae"
  Pop $YTXBadge
  SetCtlColors $YTXBadge "FFFFFF" "5D35A8"
  ${NSD_CreateCheckBox} 42u 96u 85% 22u "Adobe After Effects    ·    Detected"
  Pop $YTXAfterEffectsBox
  ${If} $YTXDetectedAfterEffects != 1
    ${NSD_SetText} $YTXAfterEffectsBox "Adobe After Effects    ·    Not detected"
    EnableWindow $YTXAfterEffectsBox 0
  ${ElseIf} $YTXInstallAfterEffects == ${BST_CHECKED}
    ${NSD_Check} $YTXAfterEffectsBox
  ${EndIf}
  ${NSD_CreateCheckBox} 12u 119u 94% 20u "Enable Adobe CEP developer mode for this Windows user (needed for unsigned YTX Bridge)"
  Pop $YTXCepDebugBox
  ${If} $YTXDetectedPremiere != 1
  ${AndIf} $YTXDetectedAfterEffects != 1
    EnableWindow $YTXCepDebugBox 0
  ${ElseIf} $YTXEnableCepDebug == ${BST_CHECKED}
    ${NSD_Check} $YTXCepDebugBox
  ${EndIf}

  ${NSD_CreateGroupBox} 0 151u 100% 150u "Browser extensions"
  Pop $YTXBadge
  ${NSD_CreateLabel} 12u 165u 22u 22u "Ch"
  Pop $YTXBadge
  SetCtlColors $YTXBadge "FFFFFF" "315ECC"
  ${NSD_CreateCheckBox} 42u 165u 85% 22u "Google Chrome    ·    Detected"
  Pop $YTXChromeBox
  ${If} $YTXDetectedChrome != 1
    ${NSD_SetText} $YTXChromeBox "Google Chrome    ·    Not detected"
    EnableWindow $YTXChromeBox 0
  ${ElseIf} $YTXInstallChrome == ${BST_CHECKED}
    ${NSD_Check} $YTXChromeBox
  ${EndIf}
  ${NSD_CreateLabel} 12u 190u 22u 22u "Ed"
  Pop $YTXBadge
  SetCtlColors $YTXBadge "FFFFFF" "2578C8"
  ${NSD_CreateCheckBox} 42u 190u 85% 22u "Microsoft Edge    ·    Detected"
  Pop $YTXEdgeBox
  ${If} $YTXDetectedEdge != 1
    ${NSD_SetText} $YTXEdgeBox "Microsoft Edge    ·    Not detected"
    EnableWindow $YTXEdgeBox 0
  ${ElseIf} $YTXInstallEdge == ${BST_CHECKED}
    ${NSD_Check} $YTXEdgeBox
  ${EndIf}
  ${NSD_CreateLabel} 12u 215u 22u 22u "Br"
  Pop $YTXBadge
  SetCtlColors $YTXBadge "FFFFFF" "252525"
  ${NSD_CreateCheckBox} 42u 215u 85% 22u "Brave    ·    Detected"
  Pop $YTXBraveBox
  ${If} $YTXDetectedBrave != 1
    ${NSD_SetText} $YTXBraveBox "Brave    ·    Not detected"
    EnableWindow $YTXBraveBox 0
  ${ElseIf} $YTXInstallBrave == ${BST_CHECKED}
    ${NSD_Check} $YTXBraveBox
  ${EndIf}
  ${NSD_CreateLabel} 12u 240u 22u 22u "Op"
  Pop $YTXBadge
  SetCtlColors $YTXBadge "FFFFFF" "B83A27"
  ${NSD_CreateCheckBox} 42u 240u 85% 22u "Opera    ·    Detected"
  Pop $YTXOperaBox
  ${If} $YTXDetectedOpera != 1
    ${NSD_SetText} $YTXOperaBox "Opera    ·    Not detected"
    EnableWindow $YTXOperaBox 0
  ${ElseIf} $YTXInstallOpera == ${BST_CHECKED}
    ${NSD_Check} $YTXOperaBox
  ${EndIf}
  ${NSD_CreateLabel} 12u 265u 22u 22u "Vi"
  Pop $YTXBadge
  SetCtlColors $YTXBadge "FFFFFF" "596575"
  ${NSD_CreateCheckBox} 42u 265u 85% 22u "Vivaldi    ·    Detected"
  Pop $YTXVivaldiBox
  ${If} $YTXDetectedVivaldi != 1
    ${NSD_SetText} $YTXVivaldiBox "Vivaldi    ·    Not detected"
    EnableWindow $YTXVivaldiBox 0
  ${ElseIf} $YTXInstallVivaldi == ${BST_CHECKED}
    ${NSD_Check} $YTXVivaldiBox
  ${EndIf}
  ${NSD_CreateLabel} 0 305u 100% 22u "Browser setup opens each selected extension page. Enable Developer mode and load the YTX folder once."
  Pop $YTXBadge
  nsDialogs::Show
FunctionEnd

Function YTXIntegrationsPageLeave
  ${NSD_GetState} $YTXPremiereBox $YTXInstallPremiere
  ${NSD_GetState} $YTXAfterEffectsBox $YTXInstallAfterEffects
  ${NSD_GetState} $YTXChromeBox $YTXInstallChrome
  ${NSD_GetState} $YTXEdgeBox $YTXInstallEdge
  ${NSD_GetState} $YTXBraveBox $YTXInstallBrave
  ${NSD_GetState} $YTXOperaBox $YTXInstallOpera
  ${NSD_GetState} $YTXVivaldiBox $YTXInstallVivaldi
  ${NSD_GetState} $YTXCepDebugBox $YTXEnableCepDebug
  StrCpy $YTXChoiceInitialized 1
FunctionEnd
!endif

!ifndef BUILD_UNINSTALLER
Function YTXRegisterBrowserExtension
  Exch $R0
  Push $R1
  Push $R2
  Push $R8
  Push $R9
  StrCmp $R3 "" ytx_policy_done
  StrCpy $R1 1
  ytx_policy_loop:
  ReadRegStr $R2 HKCU "$R0\ExtensionInstallForcelist" "$R1"
  StrCmp $R2 "" ytx_policy_write
  StrCmp $R2 "$R3;${YTX_EXTENSION_UPDATE_URL}" ytx_policy_done
  IntOp $R1 $R1 + 1
  StrCmp $R1 60 ytx_policy_done
  Goto ytx_policy_loop
  ytx_policy_write:
  WriteRegStr HKCU "$R0\ExtensionInstallForcelist" "$R1" "$R3;${YTX_EXTENSION_UPDATE_URL}"
  WriteRegStr HKCU "Software\YTX\BrowserExtension\Policies\$R8" "Key" "$R0"
  WriteRegStr HKCU "Software\YTX\BrowserExtension\Policies\$R8" "ValueName" "$R1"
  DetailPrint "Registered the YTX extension policy for $R8 (rule $R1)."
  ytx_policy_done:
  Pop $R9
  Pop $R8
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd
!endif

!ifdef BUILD_UNINSTALLER
Function un.YTXRemoveBrowserExtensionPolicy
  Exch $R0
  Push $R1
  Push $R2
  Push $R8
  StrCmp $R3 "" ytx_remove_policy_done
  StrCpy $R1 1
  ytx_remove_policy_loop:
  ReadRegStr $R2 HKCU "$R0\ExtensionInstallForcelist" "$R1"
  StrCmp $R2 "" ytx_remove_policy_next
  StrCpy $R8 $R2 32
  StrCmp $R8 $R3 0 ytx_remove_policy_next
  DeleteRegValue HKCU "$R0\ExtensionInstallForcelist" "$R1"
  ytx_remove_policy_next:
  IntOp $R1 $R1 + 1
  StrCmp $R1 60 ytx_remove_policy_done
  Goto ytx_remove_policy_loop
  ytx_remove_policy_done:
  Pop $R8
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd
!endif

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
  StrCmp $YTXInstallPremiere ${BST_CHECKED} install_adobe_bridge
  StrCmp $YTXInstallAfterEffects ${BST_CHECKED} install_adobe_bridge browser_selection_start
  install_adobe_bridge:
  DetailPrint "Installing the YTX Bridge panel for selected Adobe host(s)..."
  CreateDirectory "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS"
  CreateDirectory "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\jsx"
  Delete "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS\manifest.xml"
  Delete "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS\manifest-premiere.xml"
  Delete "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS\manifest-aftereffects.xml"
  StrCmp $YTXInstallPremiere ${BST_CHECKED} 0 ytx_ae_manifest_only
  StrCmp $YTXInstallAfterEffects ${BST_CHECKED} 0 ytx_premiere_manifest_only
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\CSXS\manifest.xml" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS"
  Goto ytx_manifest_ready
  ytx_ae_manifest_only:
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\CSXS\manifest-aftereffects.xml" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS"
  Rename "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS\manifest-aftereffects.xml" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS\manifest.xml"
  Goto ytx_manifest_ready
  ytx_premiere_manifest_only:
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\CSXS\manifest-premiere.xml" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS"
  Rename "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS\manifest-premiere.xml" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\CSXS\manifest.xml"
  ytx_manifest_ready:
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\index.html" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge"
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\panel.css" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge"
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\panel.js" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge"
  CopyFiles /SILENT "$INSTDIR\resources\adobe-bridge\jsx\host.jsx" "$APPDATA\Adobe\CEP\extensions\YTX-Bridge\jsx"
  StrCmp $YTXEnableCepDebug ${BST_CHECKED} 0 ytx_cep_debug_done
  WriteRegStr HKCU "Software\Adobe\CSXS.9" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.10" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.11" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.12" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.13" "PlayerDebugMode" "1"
  WriteRegStr HKCU "Software\Adobe\CSXS.14" "PlayerDebugMode" "1"
  DetailPrint "Enabled Adobe CEP developer mode as an explicit installer selection."
  ytx_cep_debug_done:
  DetailPrint "YTX Bridge copied to the selected Adobe integration folder."
  browser_selection_start:
  StrCmp $YTXInstallChrome ${BST_CHECKED} copy_browser_extension
  StrCmp $YTXInstallEdge ${BST_CHECKED} copy_browser_extension
  StrCmp $YTXInstallBrave ${BST_CHECKED} copy_browser_extension
  StrCmp $YTXInstallOpera ${BST_CHECKED} copy_browser_extension
  StrCmp $YTXInstallVivaldi ${BST_CHECKED} copy_browser_extension skip_browser_extension
  copy_browser_extension:
  DetailPrint "Installing the signed YTX browser helper selected on the integrations page..."
  CreateDirectory "$LOCALAPPDATA\YTX\browser-extension"
  CreateDirectory "$LOCALAPPDATA\YTX\browser-extension\icons"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\manifest.json" "$LOCALAPPDATA\YTX\browser-extension"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\content.js" "$LOCALAPPDATA\YTX\browser-extension"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\README.txt" "$LOCALAPPDATA\YTX\browser-extension"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\updates.xml" "$LOCALAPPDATA\YTX\browser-extension"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\extension-id.txt" "$LOCALAPPDATA\YTX\browser-extension"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\ytx-extension.crx" "$LOCALAPPDATA\YTX\browser-extension"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\icons\icon-16.png" "$LOCALAPPDATA\YTX\browser-extension\icons"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\icons\icon-48.png" "$LOCALAPPDATA\YTX\browser-extension\icons"
  CopyFiles /SILENT "$INSTDIR\resources\browser-extension\icons\icon-128.png" "$LOCALAPPDATA\YTX\browser-extension\icons"
  StrCpy $R3 ""
  IfFileExists "$INSTDIR\resources\browser-extension\extension-id.txt" 0 ytx_extension_id_missing
  FileOpen $R4 "$INSTDIR\resources\browser-extension\extension-id.txt" r
  IfErrors ytx_extension_id_missing
  FileRead $R4 $R3
  FileClose $R4
  StrCpy $R3 $R3 32
  ytx_extension_id_missing:
  StrCmp $R3 "" ytx_browser_policy_skipped
  WriteRegStr HKCU "Software\YTX\BrowserExtension" "ExtensionId" "$R3"
  WriteRegStr HKCU "Software\YTX\BrowserExtension" "UpdateUrl" "${YTX_EXTENSION_UPDATE_URL}"
  StrCmp $YTXInstallChrome ${BST_CHECKED} 0 ytx_skip_chrome_policy
  StrCpy $R8 "chrome"
  Push "Software\Policies\Google\Chrome"
  Call YTXRegisterBrowserExtension
  ytx_skip_chrome_policy:
  StrCmp $YTXInstallEdge ${BST_CHECKED} 0 ytx_skip_edge_policy
  StrCpy $R8 "edge"
  Push "Software\Policies\Microsoft\Edge"
  Call YTXRegisterBrowserExtension
  ytx_skip_edge_policy:
  StrCmp $YTXInstallBrave ${BST_CHECKED} 0 ytx_skip_brave_policy
  StrCpy $R8 "brave"
  Push "Software\Policies\BraveSoftware\Brave"
  Call YTXRegisterBrowserExtension
  ytx_skip_brave_policy:
  StrCmp $YTXInstallVivaldi ${BST_CHECKED} 0 ytx_skip_vivaldi_policy
  StrCpy $R8 "vivaldi"
  Push "Software\Policies\Vivaldi"
  Call YTXRegisterBrowserExtension
  ytx_skip_vivaldi_policy:
  StrCmp $YTXInstallOpera ${BST_CHECKED} 0 ytx_skip_opera_policy
  StrCpy $R8 "opera"
  Push "Software\Policies\Opera Software\Opera"
  Call YTXRegisterBrowserExtension
  ytx_skip_opera_policy:
  DetailPrint "Browser extension policy installed for the selected Chromium browser(s)."
  MessageBox MB_OK|MB_ICONINFORMATION "YTX registered the signed browser helper for your selected browsers. Restart those browsers once and the YTX button will appear on YouTube—no Developer mode step. If your organization manages browser policies, the extension page can be used as a fallback."
  Goto skip_browser_extension
  ytx_browser_policy_skipped:
  MessageBox MB_OK|MB_ICONINFORMATION "The signed browser helper could not be registered automatically. Open the YTX browser-extension folder and use Load unpacked after turning on Developer mode."
  skip_browser_extension:
  CreateDirectory "$LOCALAPPDATA\YTX"
  FileOpen $R4 "$LOCALAPPDATA\YTX\install-complete.flag" w
  IfErrors +2
  FileClose $R4
  RMDir /r "$INSTDIR\resources\bootstrap"
!macroend

!macro customUnInstall
  ReadRegStr $R3 HKCU "Software\YTX\BrowserExtension" "ExtensionId"
  IfFileExists "$INSTDIR\resources\browser-extension\extension-id.txt" 0 ytx_uninstall_extension_id_missing
  FileOpen $R4 "$INSTDIR\resources\browser-extension\extension-id.txt" r
  IfErrors ytx_uninstall_extension_id_missing
  FileRead $R4 $R3
  FileClose $R4
  StrCpy $R3 $R3 32
  ytx_uninstall_extension_id_missing:
  Push "Software\Policies\Google\Chrome"
  Call un.YTXRemoveBrowserExtensionPolicy
  Push "Software\Policies\Microsoft\Edge"
  Call un.YTXRemoveBrowserExtensionPolicy
  Push "Software\Policies\BraveSoftware\Brave"
  Call un.YTXRemoveBrowserExtensionPolicy
  Push "Software\Policies\Vivaldi"
  Call un.YTXRemoveBrowserExtensionPolicy
  Push "Software\Policies\Opera Software\Opera"
  Call un.YTXRemoveBrowserExtensionPolicy
  DeleteRegKey HKCU "Software\YTX\BrowserExtension"
  RMDir /r "$APPDATA\Adobe\CEP\extensions\YTX-Bridge"
  RMDir /r "$LOCALAPPDATA\YTX\browser-extension"
!macroend
