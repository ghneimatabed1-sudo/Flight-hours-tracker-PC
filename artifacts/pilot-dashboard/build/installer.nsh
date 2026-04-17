; Custom NSIS macros for password-protected installation.
; The master install password MUST be provided at build time via the
; INSTALL_PASSWORD environment variable. There is intentionally no default
; fallback — this prevents shipping an installer with a guessable password.

!ifndef INSTALL_PASSWORD
  !error "INSTALL_PASSWORD is required. Set the environment variable INSTALL_PASSWORD to the master install password before running electron-builder. Aborting build."
!endif

!ifdef INSTALL_PASSWORD
  !if "${INSTALL_PASSWORD}" == ""
    !error "INSTALL_PASSWORD must be a non-empty string."
  !endif
!endif

!macro customInit
  !define MUI_ABORTWARNING

  Var /GLOBAL InstallPwd
  StrCpy $InstallPwd ""

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Enter the master installation password issued by the RJAF Super Admin:"
  Pop $1
  ${NSD_CreatePassword} 0 30u 100% 12u ""
  Pop $2

  nsDialogs::Show

  ${NSD_GetText} $2 $InstallPwd
  ${If} $InstallPwd != "${INSTALL_PASSWORD}"
    MessageBox MB_ICONSTOP|MB_OK "Incorrect installation password. Installation aborted."
    Abort
  ${EndIf}
!macroend
