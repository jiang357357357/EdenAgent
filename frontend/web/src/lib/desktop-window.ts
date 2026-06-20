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
    aspectRatio: 7 / 16,
    heightRatio: 0.5,
  },
} as const;

export type DesktopWindowMode = keyof typeof WINDOW_SIZES;
export type DesktopViewMode = 'chatWithCharacter' | 'character';
export type PetDock = 'left' | 'center' | 'right';
export type PetInputMode = 'compact' | 'panel' | 'hidden';

export interface PetSettings {
  alwaysOnTop: boolean;
  transparentWindow: boolean;
  clickThrough: boolean;
  characterDraggable: boolean;
  showInput: boolean;
  notifyOnWake: boolean;
  petScale: number;
  windowOpacity: number;
  inputOpacity: number;
  dock: PetDock;
  inputMode: PetInputMode;
  inputWidth: number;
  inputHeight: number;
  windowX: number | null;
  windowY: number | null;
}

export const DEFAULT_PET_SETTINGS: PetSettings = {
  alwaysOnTop: true,
  transparentWindow: true,
  clickThrough: false,
  characterDraggable: false,
  showInput: true,
  notifyOnWake: false,
  petScale: 100,
  windowOpacity: 92,
  inputOpacity: 78,
  dock: 'center',
  inputMode: 'compact',
  inputWidth: 78,
  inputHeight: 20,
  windowX: null,
  windowY: null,
};

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
        mode,
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

export async function closeDesktopWindow() {
  const bridge = getDesktopBridge();
  if (!bridge) return;

  try {
    await bridge.invoke('close_current_window');
  } catch {
    window.close();
  }
}

export async function openDesktopPetWindow() {
  const bridge = getDesktopBridge();
  if (!bridge) return false;

  try {
    await bridge.invoke('open_pet_window');
    return true;
  } catch {
    return false;
  }
}

export async function getDesktopPetSettings() {
  const bridge = getDesktopBridge();
  if (!bridge) return DEFAULT_PET_SETTINGS;

  try {
    return { ...DEFAULT_PET_SETTINGS, ...(await bridge.invoke<Partial<PetSettings>>('get_pet_settings')) };
  } catch {
    return DEFAULT_PET_SETTINGS;
  }
}

export async function applyDesktopPetSettings(settings: PetSettings) {
  const bridge = getDesktopBridge();
  if (!bridge) return settings;

  try {
    return { ...settings, ...(await bridge.invoke<Partial<PetSettings>>('apply_pet_settings', { settings })) };
  } catch {
    return settings;
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

export async function listenDesktopPetSettings(onSettings: (settings: PetSettings) => void) {
  const bridge = getDesktopBridge();
  if (!bridge?.onPetSettings) return undefined;

  try {
    return bridge.onPetSettings((settings) => {
      onSettings({ ...DEFAULT_PET_SETTINGS, ...settings });
    });
  } catch {
    return undefined;
  }
}

export async function listenDesktopOpenSettings(onOpen: () => void) {
  const bridge = getDesktopBridge();
  if (!bridge?.onOpenSettings) return undefined;

  try {
    return bridge.onOpenSettings(onOpen);
  } catch {
    return undefined;
  }
}
