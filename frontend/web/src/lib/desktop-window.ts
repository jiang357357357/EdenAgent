const WINDOW_SIZES = {
  chatWithCharacter: {
    widthRatio: 0.56,
    heightRatio: 0.55,
    minWidth: 820,
    minHeight: 540,
    maxWidth: 1040,
    maxHeight: 640,
  },
  character: {
    aspectRatio: 9 / 16,
    heightRatio: 0.72,
    minWidth: 304,
    minHeight: 540,
    maxWidth: 428,
    maxHeight: 760,
  },
} as const;

export type DesktopWindowMode = keyof typeof WINDOW_SIZES;
export type DesktopViewMode = DesktopWindowMode;

export async function resizeDesktopWindow(mode: DesktopWindowMode) {
  if (!('__TAURI_INTERNALS__' in window)) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_window_size', {
      request: {
        ...WINDOW_SIZES[mode],
        center: true,
      },
    });
  } catch {
    // Normal browser tabs cannot resize their outer window; ignore that path.
  }
}

export async function setDesktopWindowAppearance(mode: DesktopWindowMode) {
  if (!('__TAURI_INTERNALS__' in window)) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_window_appearance', { mode });
  } catch {
    // Normal browser tabs cannot change their outer window appearance.
  }
}

export async function setDesktopViewModeState(mode: DesktopViewMode) {
  if (!('__TAURI_INTERNALS__' in window)) return;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_view_mode_state', { mode });
  } catch {
    // Browser dev mode has no tray menu to update.
  }
}

export async function startDesktopWindowDrag() {
  if (!('__TAURI_INTERNALS__' in window)) return;

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().startDragging();
    return;
  } catch {
    // Fall back to the local command for Tauri builds that do not expose the JS helper.
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('start_window_drag');
  } catch {
    // Browser dev mode and unsupported platforms cannot drag the outer window.
  }
}

export async function listenDesktopViewMode(onMode: (mode: DesktopViewMode) => void) {
  if (!('__TAURI_INTERNALS__' in window)) return undefined;

  try {
    const { listen } = await import('@tauri-apps/api/event');
    return listen<string>('opencode-view-mode', (event) => {
      if (event.payload === 'character' || event.payload === 'chatWithCharacter') {
        onMode(event.payload);
      }
    });
  } catch {
    return undefined;
  }
}
