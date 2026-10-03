import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Mood } from '../../shared/types'
import { Animator, drawKumo, type Palette } from './character'

export interface KumoHandle {
  nudge(): void
  look(x: number, y: number): void
}

interface Props {
  size: number
  mood: Mood
  palette: Palette
  reduced?: boolean
  paused?: boolean
  className?: string
  title?: string
}

export const Kumo = forwardRef<KumoHandle, Props>(function Kumo({ size, mood, palette, reduced, paused, className, title }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const anim = useRef<Animator>(new Animator())
  const pal = useRef(palette)
  pal.current = palette

  useImperativeHandle(ref, () => ({
    nudge: () => anim.current.nudge(),
    look: (x, y) => anim.current.look(x, y),
  }))

  useEffect(() => {
    anim.current.setMood(mood)
  }, [mood])

  useEffect(() => {
    anim.current.reduced = Boolean(reduced)
  }, [reduced])

  useEffect(() => {
    const el = canvas.current
    if (!el || paused) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    el.width = Math.round(size * dpr)
    el.height = Math.round(size * dpr)
    const ctx = el.getContext('2d')
    if (!ctx) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame)
      const dt = (now - last) / 1000
      last = now
      acc += dt
      if (acc < 1 / 40) return
      const pose = anim.current.step(acc)
      acc = 0
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size, size)
      drawKumo(ctx, size, pose, pal.current)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [size, paused])

  return <canvas ref={canvas} className={className} style={{ width: size, height: size, display: 'block' }} role="img" aria-label={title || `Kumo - ${mood}`} />
})
