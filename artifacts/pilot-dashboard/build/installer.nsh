; Custom NSIS for password-gated installation.
;
; IMPORTANT: The previous version put nsDialogs inside `customInit` (which is
; injected into `.onInit`). nsDialogs cannot be used in `.onInit` because the
; installer's main window doesn't exist yet — `nsDialogs::Create` returns
; "error" and the macro silently `Abort`s. The visible symptom was: user
; clicks Yes on UAC and the installer disappears with no message.
;
; This version moves the password prompt to a proper custom Page inserted
; after the directory-chooser page, where nsDialogs works correctly. Wrong
; password keeps the user on the same page so they can retry.

!ifndef INSTALL_PASSWORD
  !error "INSTALL_PASSWORD is required. Set the environment variable INSTALL_PASSWORD before running electron-builder."
!endif
!if "${INSTALL_PASSWORD}" == ""
  !error "INSTALL_PASSWORD must not be an empty string."
!endif

Var RjafPwdInput
Var RjafPwdEntered

!macro customHeader
  !include "nsDialogs.nsh"
  !include "LogicLib.nsh"
!macroend

; electron-builder injects this macro between MUI_PAGE_DIRECTORY and
; MUI_PAGE_INSTFILES. That's the right spot: window already exists, no
; files have been written yet.
!macro customPageAfterChangeDir
  Page custom RjafPwdPageShow RjafPwdPageLeave
!macroend

Function RjafPwdPageShow
  !insertmacro MUI_HEADER_TEXT "Installation Password" "Authorization required to continue."

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 36u "Enter the master installation password issued by the RJAF Super Admin:"
  Pop $1

  ${NSD_CreatePassword} 0 50u 100% 14u ""
  Pop $RjafPwdInput
  ${NSD_SetFocus} $RjafPwdInput

  nsDialogs::Show
FunctionEnd

Function RjafPwdPageLeave
  ${NSD_GetText} $RjafPwdInput $RjafPwdEntered
  ${If} $RjafPwdEntered != "${INSTALL_PASSWORD}"
    MessageBox MB_ICONSTOP|MB_OK "Incorrect installation password. Please try again, or close the installer to cancel."
    Abort  ; keeps the user on this page so they can retry
  ${EndIf}
FunctionEnd
