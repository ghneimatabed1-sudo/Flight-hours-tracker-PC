; Custom NSIS for password-gated installation.
;
; History:
;  v1: nsDialogs in customInit (.onInit) — silently aborted because the
;      installer's main window doesn't exist that early.
;  v2: moved to a custom Page via customPageAfterChangeDir, but referenced
;      MUI_HEADER_TEXT which isn't defined when this file is first parsed
;      (electron-builder !includes us BEFORE MUI2.nsh).
;  v3: include nsDialogs.nsh + LogicLib.nsh at the top so those macros are
;      available when the Function bodies are parsed; skip MUI_HEADER_TEXT
;      and use a plain label inside the dialog instead.

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!ifndef INSTALL_PASSWORD
  !error "INSTALL_PASSWORD is required. Set the environment variable INSTALL_PASSWORD before running electron-builder."
!endif
!if "${INSTALL_PASSWORD}" == ""
  !error "INSTALL_PASSWORD must not be an empty string."
!endif

Var RjafPwdInput
Var RjafPwdEntered

; electron-builder injects this macro between MUI_PAGE_DIRECTORY and
; MUI_PAGE_INSTFILES. Window already exists by then, so nsDialogs works.
!macro customPageAfterChangeDir
  Page custom RjafPwdPageShow RjafPwdPageLeave
!macroend

Function RjafPwdPageShow
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 16u "RJAF Squadron Ops — Installation Password"
  Pop $1

  ${NSD_CreateLabel} 0 22u 100% 30u "Enter the master installation password issued by the RJAF Super Admin to continue."
  Pop $2

  ${NSD_CreatePassword} 0 60u 100% 14u ""
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
