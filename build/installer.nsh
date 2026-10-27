!include "nsDialogs.nsh"

!ifndef BUILD_UNINSTALLER
  Var coviDesktopShortcut
  Var coviStartMenuShortcut
  Var coviDesktopShortcutState
  Var coviStartMenuShortcutState

  !macro customInit
    StrCpy $coviDesktopShortcutState ${BST_CHECKED}
    StrCpy $coviStartMenuShortcutState ${BST_CHECKED}
  !macroend

  !macro customPageAfterChangeDir
    Page custom coviShortcutsPageCreate coviShortcutsPageLeave
  !macroend

  Function coviShortcutsPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 20u "Selecione os atalhos que deseja criar:"
    Pop $0

    ${NSD_CreateCheckbox} 0 34u 100% 14u "Área de trabalho"
    Pop $coviDesktopShortcut
    ${NSD_Check} $coviDesktopShortcut

    ${NSD_CreateCheckbox} 0 56u 100% 14u "Menu Iniciar"
    Pop $coviStartMenuShortcut
    ${NSD_Check} $coviStartMenuShortcut

    nsDialogs::Show
  FunctionEnd

  Function coviShortcutsPageLeave
    ${NSD_GetState} $coviDesktopShortcut $coviDesktopShortcutState
    ${NSD_GetState} $coviStartMenuShortcut $coviStartMenuShortcutState
  FunctionEnd

  !macro customInstall
    ${If} $coviDesktopShortcutState != ${BST_CHECKED}
      Delete "$newDesktopLink"
    ${EndIf}
    ${If} $coviStartMenuShortcutState != ${BST_CHECKED}
      Delete "$newStartMenuLink"
      !ifdef MENU_FILENAME
        RMDir "$SMPROGRAMS\${MENU_FILENAME}"
      !endif
    ${EndIf}
  !macroend
!endif
