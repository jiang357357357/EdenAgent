const WINDOW_SIZES = {
  login: {
    width: 960,
    height: 540,
  },
  chatWithCharacter: {
    width: 960,
    height: 540,
  },
  character: {
    aspectRatio: 9 / 16,
    heightRatio: 0.5,
  },
} as const;

export type DesktopWindowMode = keyof typeof WINDOW_SIZES;
export type DesktopViewMode = 'chatWithCharacter' | 'character';

function getDesktopBridge() {
  return window.monAgentDesktop;
}

export async function resizeDesktopWindow(mode: DesktopWindowMode) {
  const bridge = getDesktopBridge();
  if (!bridge) return;

  try {
    await bridge.invoke('set_window_size', {
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
  const bridge = getDesktopBridge();
  if (!bridge) return;

  try {
    await bridge.invoke('set_window_appearance', { mode });
  } catch {
    // Normal browser tabs cannot change their outer window appearance.
  }
}

export async function setDesktopViewModeState(mode: DesktopViewMode) {
  const bridge = getDesktopBridge();
  if (!bridge) return;

  try {
    await bridge.invoke('set_view_mode_state', { mode });
  } catch {
    // Browser dev mode has no tray menu to update.
  }
}

export async function startDesktopWindowDrag() {
  const bridge = getDesktopBridge();
  if (!bridge) return;

  try {
    await bridge.invoke('start_window_drag');
  } catch {
    // Browser dev mode and unsupported platforms cannot drag the outer window.
  }
}

export async function listenDesktopViewMode(onMode: (mode: DesktopViewMode) => void) {
  const bridge = getDesktopBridge();
  if (!bridge?.onViewMode) return undefined;

  try {
    return bridge.onViewMode((mode) => {
      if (mode === 'character' || mode === 'chatWithCharacter') {
        onMode(mode);
      }
    });
  } catch {
    return undefined;
  }
}
