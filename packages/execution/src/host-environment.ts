import os from 'node:os'
import { windowsProcessEnvironment } from './windows-process.ts'
/** Host usability variables only; provider/realm credentials are still explicitly scoped. */
export function hostProcessEnvironment(): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = process.platform === 'win32' ? windowsProcessEnvironment() : { LANG: 'C.UTF-8', HOME: os.homedir() }
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    if (process.env[key] !== undefined) base[key] = process.env[key]
  }
  return base
}
