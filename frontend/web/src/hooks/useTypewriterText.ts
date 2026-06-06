import { useEffect, useRef, useState } from "react"

const revealedTextCache = new Map<string, string>()

function rememberRevealedText(key: string, value: string) {
  revealedTextCache.set(key, value)
  if (revealedTextCache.size <= 300) return
  const firstKey = revealedTextCache.keys().next().value
  if (firstKey) revealedTextCache.delete(firstKey)
}

export function useTypewriterText({
  active,
  cacheKey,
  target,
  onFrame,
}: {
  active: boolean
  cacheKey: string
  target: string
  onFrame?: () => void
}) {
  const [visible, setVisible] = useState(() => (active ? revealedTextCache.get(cacheKey) ?? "" : target))
  const visibleRef = useRef(visible)
  const targetRef = useRef(target)
  const activeRef = useRef(active)

  useEffect(() => {
    visibleRef.current = visible
    rememberRevealedText(cacheKey, visible)
  }, [cacheKey, visible])

  useEffect(() => {
    targetRef.current = target
  }, [target])

  useEffect(() => {
    activeRef.current = active
  }, [active])

  useEffect(() => {
    const cached = revealedTextCache.get(cacheKey)
    const next = active ? cached ?? "" : target
    visibleRef.current = next
    setVisible(next)
  }, [cacheKey])

  useEffect(() => {
    if (!target.startsWith(visibleRef.current)) {
      visibleRef.current = target
      setVisible(target)
      return
    }

    let frame = 0
    let lastTime = performance.now()
    let carry = 0

    const tick = (now: number) => {
      const current = visibleRef.current
      const latestTarget = targetRef.current
      const remaining = latestTarget.length - current.length
      if (remaining <= 0) return

      const elapsed = Math.max(now - lastTime, 0)
      lastTime = now
      const charsPerSecond = remaining > 600 ? 260 : remaining > 220 ? 170 : remaining > 80 ? 105 : 48
      carry += (elapsed / 1000) * charsPerSecond
      const step = Math.max(1, Math.floor(carry))

      if (step > 0) {
        carry = Math.max(carry - step, 0)
        setVisible((previous) => {
          if (!targetRef.current.startsWith(previous)) return targetRef.current
          const next = targetRef.current.slice(0, Math.min(targetRef.current.length, previous.length + step))
          if (next !== previous) {
            visibleRef.current = next
            onFrame?.()
          }
          return next
        })
      }

      if (visibleRef.current.length < targetRef.current.length || activeRef.current) {
        frame = requestAnimationFrame(tick)
      }
    }

    if (visibleRef.current.length < targetRef.current.length || active) {
      frame = requestAnimationFrame(tick)
    }

    return () => {
      if (frame) cancelAnimationFrame(frame)
    }
  }, [active, onFrame, target])

  return visible
}
