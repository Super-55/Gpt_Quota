; Install for the current user, including when the user is an administrator.
; Keep the standard electron-builder installer, shortcuts and uninstaller.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
