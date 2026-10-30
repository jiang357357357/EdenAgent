import type { WindowStateOutput } from '@trycua/cua-driver'
import type { NativeObservation, NativeWindow } from './contracts.ts'

/** Preserve capture quality and geometry; SDK frame coordinates belong to its desktop space. */
export function projectNativeObservation(window: NativeWindow, state: WindowStateOutput, screenshot = true): NativeObservation {
  return {
    window: { ...window, title: state.windowTitle ?? window.title, bounds: state.windowBounds ?? window.bounds },
    elements: (state.elements ?? []).map(e => ({
      token: e.elementToken ?? '', role: e.role, label: (e.label ?? '').slice(0, 1000), value: (e.value ?? '').slice(0, 16000),
      valueAvailable: e.value !== undefined, valueTruncated: (e.value?.length ?? 0) > 16000,
      labelTruncated: (e.label?.length ?? 0) > 1000, enabled: e.enabled ?? true, actions: e.actions ?? [],
      index: e.elementIndex.toString(), ...(e.parentIndex !== undefined ? { parent: e.parentIndex.toString() } : {}),
      ...(e.frame ? { frame: { x: e.frame.x, y: e.frame.y, width: e.frame.w, height: e.frame.h } } : {}),
    })),
    images: screenshot ? state.images.map(i => ({ mime: i.mimeType, data: i.dataBase64 })) : [],
    width: screenshot ? state.screenshotWidth ?? 0 : 0, height: screenshot ? state.screenshotHeight ?? 0 : 0,
    truncated: state.truncated ?? false, screenshotIncluded: screenshot && state.images.length > 0, ...captureQuality(state),
  }
}

function captureQuality(state: WindowStateOutput) {
  return {
    ...(state.screenshotScale !== undefined ? { scale: state.screenshotScale } : {}),
    ...(state.screenshotFrameValid !== undefined ? { frameValid: state.screenshotFrameValid } : {}),
    ...(state.degraded !== undefined ? { degraded: state.degraded } : {}),
    ...(state.degradedReason ? { degradedReason: state.degradedReason.slice(0, 1000) } : {}),
    ...(state.elementsComplete !== undefined ? { elementsComplete: state.elementsComplete } : {}),
    ...(state.truncationReason ? { truncationReason: state.truncationReason.slice(0, 1000) } : {}),
  }
}
