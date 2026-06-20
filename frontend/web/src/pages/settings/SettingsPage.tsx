import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  ArrowLeft,
  Eye,
  Keyboard,
  Monitor,
  MousePointer2,
  Move,
  PanelBottom,
  Pin,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react"
import { motion } from "motion/react"
import type { CoreAssistant } from "../../lib/auth"
import {
  applyDesktopPetSettings,
  DEFAULT_PET_SETTINGS,
  getDesktopPetSettings,
  listenDesktopPetSettings,
  type PetSettings,
} from "../../lib/desktop-window"
import { cn } from "../../lib/utils"

const screenMotion = {
  initial: { opacity: 0, x: 18, filter: "blur(3px)" },
  animate: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: { opacity: 0, x: 26, filter: "blur(3px)" },
}

const transition = {
  duration: 0.28,
  ease: [0.16, 1, 0.3, 1],
} as const

interface SettingsPageProps {
  assistant?: CoreAssistant | null
  onBack?: () => void
}

interface ToggleRowProps {
  icon: typeof Settings
  label: string
  value: boolean
  onChange: (value: boolean) => void
}

interface SliderRowProps {
  icon: typeof Settings
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}

interface NumberRowProps {
  icon: typeof Settings
  label: string
  value: number | null
  placeholder?: string
  onChange: (value: number | null) => void
}

function ToggleRow({ icon: Icon, label, value, onChange }: ToggleRowProps) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-4 border-b border-border/70 py-2 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate text-sm text-text">{label}</span>
      </div>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          "flex h-7 w-12 shrink-0 items-center rounded-full border p-[3px] transition-colors",
          value ? "border-accent bg-accent" : "border-border bg-bg",
        )}
        aria-pressed={value}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            value ? "translate-x-[20px]" : "translate-x-0",
          )}
        />
      </button>
    </div>
  )
}

function SliderRow({ icon: Icon, label, value, min, max, step = 1, unit = "", onChange }: SliderRowProps) {
  return (
    <div className="border-b border-border/70 py-3 last:border-b-0">
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-accent">
            <Icon className="h-4 w-4" />
          </span>
          <span className="truncate text-sm text-text">{label}</span>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-bg px-3 py-1 text-xs text-text-muted">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-6 w-full accent-[var(--color-accent)]"
      />
    </div>
  )
}

function NumberRow({ icon: Icon, label, value, placeholder = "默认", onChange }: NumberRowProps) {
  return (
    <div className="flex min-h-[56px] items-center justify-between gap-4 border-b border-border/70 py-2 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <span className="truncate text-sm text-text">{label}</span>
      </div>
      <input
        type="number"
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(event) => {
          const nextValue = event.target.value.trim()
          const numericValue = Number(nextValue)
          onChange(nextValue === "" || !Number.isFinite(numericValue) ? null : numericValue)
        }}
        className="h-9 w-32 rounded-lg border border-border bg-bg px-3 text-right text-sm text-text outline-none transition-colors placeholder:text-text-lighter focus:border-accent/50"
      />
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Settings
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex h-14 items-center gap-3 border-b border-border px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-accent/25 bg-accent-dim text-accent">
          <Icon className="h-4 w-4" />
        </span>
        <div className="font-serif text-lg text-text">{title}</div>
      </div>
      <div className="px-4">{children}</div>
    </section>
  )
}

export function SettingsPage({ assistant, onBack }: SettingsPageProps) {
  const [settings, setSettings] = useState<PetSettings>(DEFAULT_PET_SETTINGS)
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const hydratedRef = useRef(false)
  const remoteUpdateRef = useRef(false)
  const syncTokenRef = useRef(0)
  const localRevisionRef = useRef(0)
  const displayName = assistant?.name || assistant?.character?.name || "默认助手"
  const { alwaysOnTop, transparentWindow, clickThrough, characterDraggable, showInput, petScale, inputOpacity, windowX, windowY, inputWidth, inputHeight } =
    settings

  const patchSettings = (patch: Partial<PetSettings>) => {
    localRevisionRef.current += 1
    hydratedRef.current = true
    setSaveState("idle")
    setSettings((current) => ({ ...current, ...patch }))
  }

  const summary = useMemo(
    () => [
      alwaysOnTop ? "置顶" : "非置顶",
      transparentWindow ? "透明" : "实底",
      showInput ? "输入开启" : "输入隐藏",
      `缩放 ${petScale}%`,
    ],
    [alwaysOnTop, petScale, showInput, transparentWindow],
  )

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    const initialRevision = localRevisionRef.current
    void getDesktopPetSettings().then((nextSettings) => {
      if (!disposed && localRevisionRef.current === initialRevision) {
        remoteUpdateRef.current = true
        setSettings(nextSettings)
        hydratedRef.current = true
      }
    })
    void listenDesktopPetSettings((nextSettings) => {
      if (!disposed) {
        remoteUpdateRef.current = true
        setSettings(nextSettings)
      }
    }).then((cleanup) => {
      unsubscribe = cleanup
      if (disposed) cleanup?.()
    })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!hydratedRef.current) return
    if (remoteUpdateRef.current) {
      remoteUpdateRef.current = false
      return
    }

    const token = syncTokenRef.current + 1
    syncTokenRef.current = token
    setSaveState("saving")

    const timer = window.setTimeout(() => {
      void applyDesktopPetSettings(settings).then((nextSettings) => {
        if (syncTokenRef.current !== token) return
        remoteUpdateRef.current = true
        setSettings(nextSettings)
        setSaveState("saved")
        window.setTimeout(() => {
          if (syncTokenRef.current === token) setSaveState("idle")
        }, 900)
      })
    }, 80)

    return () => window.clearTimeout(timer)
  }, [settings])

  const save = async () => {
    setSaveState("saving")
    const nextSettings = await applyDesktopPetSettings(settings)
    remoteUpdateRef.current = true
    setSettings(nextSettings)
    setSaveState("saved")
    window.setTimeout(() => setSaveState("idle"), 1200)
  }

  const reset = () => {
    setSaveState("idle")
    setSettings(DEFAULT_PET_SETTINGS)
  }

  return (
    <motion.div
      key="settings"
      {...screenMotion}
      transition={transition}
      className="fixed inset-0 z-10 flex h-[100vh] w-[100vw] flex-col overflow-hidden bg-bg font-sans text-text"
    >
      <header className="flex h-24 shrink-0 items-center justify-between border-b border-border bg-bg/88 px-8 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-4">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="rounded-lg p-2 text-text-muted transition-colors hover:bg-card hover:text-accent"
              aria-label="返回"
              title="返回"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          ) : null}
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-accent/25 bg-card text-accent shadow-sm">
            <Settings className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-serif text-2xl text-text">设置</h1>
            <p className="truncate text-sm text-text-muted">{summary.join(" · ")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-text-muted shadow-sm transition-colors hover:border-accent/35 hover:text-accent"
          >
            <RotateCcw className="h-4 w-4" />
            重置
          </button>
          <button
            type="button"
            onClick={() => void save()}
            className="flex items-center gap-2 rounded-full border border-accent/40 bg-accent px-4 py-2 text-sm text-white shadow-sm transition-colors hover:bg-accent/90"
          >
            <Save className="h-4 w-4" />
            保存
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto grid w-full max-w-[760px] gap-4 pb-2">
          <Section icon={Sparkles} title="桌宠">
            <div className="border-b border-border/70 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-accent">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm text-text">{displayName}</div>
                  <div className="mt-0.5 truncate text-xs text-text-muted">当前默认助手</div>
                </div>
              </div>
            </div>
            <SliderRow
              icon={SlidersHorizontal}
              label="角色缩放"
              value={petScale}
              min={70}
              max={140}
              unit="%"
              onChange={(value) => patchSettings({ petScale: value })}
            />
          </Section>

          <Section icon={Monitor} title="窗口">
            <ToggleRow icon={Pin} label="窗口置顶" value={alwaysOnTop} onChange={(value) => patchSettings({ alwaysOnTop: value })} />
            <ToggleRow icon={Eye} label="透明背景" value={transparentWindow} onChange={(value) => patchSettings({ transparentWindow: value })} />
            <ToggleRow icon={MousePointer2} label="点击穿透" value={clickThrough} onChange={(value) => patchSettings({ clickThrough: value })} />
            <ToggleRow
              icon={Move}
              label="拖动角色移动"
              value={characterDraggable}
              onChange={(value) => patchSettings(value ? { characterDraggable: true, clickThrough: false } : { characterDraggable: false })}
            />
            <NumberRow icon={Move} label="当前位置 X" value={windowX} onChange={(value) => patchSettings({ windowX: value })} />
            <NumberRow icon={Move} label="当前位置 Y" value={windowY} onChange={(value) => patchSettings({ windowY: value })} />
          </Section>

          <Section icon={Keyboard} title="输入">
            <ToggleRow icon={Keyboard} label="聊天框" value={showInput} onChange={(value) => patchSettings({ showInput: value })} />
            <SliderRow
              icon={PanelBottom}
              label="聊天框宽度"
              value={inputWidth}
              min={10}
              max={100}
              unit="%"
              onChange={(value) => patchSettings({ inputWidth: value })}
            />
            <SliderRow
              icon={PanelBottom}
              label="聊天框高度"
              value={inputHeight}
              min={12}
              max={32}
              unit="%"
              onChange={(value) => patchSettings({ inputHeight: value })}
            />
            <SliderRow
              icon={SlidersHorizontal}
              label="输入框不透明度"
              value={inputOpacity}
              min={30}
              max={95}
              unit="%"
              onChange={(value) => patchSettings({ inputOpacity: value })}
            />
          </Section>
        </div>
      </main>
    </motion.div>
  )
}
