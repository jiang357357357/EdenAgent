const WINDOW_SIZES = {
  chatWithCharacter: {
    widthRatio: 0.56,
    heightRatio: 0.68,
    minWidth: 820,
    minHeight: 540,
    maxWidth: 1040,
    maxHeight: 760,
  },
  character: {
    widthRatio: 0.4,
    heightRatio: 0.68,
    minWidth: 560,
    minHeight: 540,
    maxWidth: 760,
    maxHeight: 760,
  },
} as const;

export type DesktopWindowMode = keyof typeof WINDOW_SIZES;

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
