; installer.nsh — Custom NSIS page for file-association opt-out
; Included by electron-builder via nsis.include in package.json
;
; Adds a "File Associations" page between the directory-selection page and
; the install page. The checkbox is checked by default; if the user unchecks
; it, the registry entries created by electron-builder are deleted after install.

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var FileAssocDialog
Var FileAssocCheckbox
Var FileAssocChecked   ; ${BST_CHECKED} or ${BST_UNCHECKED}

; ── Custom page — shown after directory selection ────────────────────────────

Page custom _FileAssocPageShow _FileAssocPageLeave

Function _FileAssocPageShow
  !insertmacro MUI_HEADER_TEXT \
    "File Associations" \
    "Choose whether MoilStack .md should open Markdown files by default."

  nsDialogs::Create 1018
  Pop $FileAssocDialog
  ${If} $FileAssocDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0u 100% 24u \
    "Associate .md, .markdown and .txt files with MoilStack .md so they open directly when double-clicked."
  Pop $0

  ${NSD_CreateCheckbox} 0 32u 100% 10u \
    "Register file associations (recommended)"
  Pop $FileAssocCheckbox
  ${NSD_Check} $FileAssocCheckbox   ; checked by default

  nsDialogs::Show
FunctionEnd

Function _FileAssocPageLeave
  ${NSD_GetState} $FileAssocCheckbox $FileAssocChecked
FunctionEnd

; ── Post-install: honour the user's choice ───────────────────────────────────

!macro customInstall
  ${If} $FileAssocChecked != ${BST_CHECKED}
    ; Remove the registry keys electron-builder just wrote
    DeleteRegKey HKCU "Software\Classes\.md"
    DeleteRegKey HKCU "Software\Classes\.markdown"
    DeleteRegKey HKCU "Software\Classes\.txt"
    DeleteRegKey HKCU "Software\Classes\MoilStack .mdFile"

    ; Notify the shell so Explorer refreshes icons immediately
    System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
  ${EndIf}
!macroend

; ── Uninstall: always clean up associations ──────────────────────────────────

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\.md"
  DeleteRegKey HKCU "Software\Classes\.markdown"
  DeleteRegKey HKCU "Software\Classes\.txt"
  DeleteRegKey HKCU "Software\Classes\MoilStack .mdFile"
  System::Call 'Shell32::SHChangeNotify(i 0x08000000, i 0x0000, p 0, p 0)'
!macroend
