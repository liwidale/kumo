import type { Mood } from '../../shared/types'


export interface Pose {
  lift: number
  stretch: number
  tilt: number
  earL: number
  earR: number
  gx: number
  gy: number
  blink: number
  happy: number
  sleepy: number
  worry: number
  wide: number
  squint: number
  accent: number
}

export const NEUTRAL: Pose = {
  lift: 0,
  stretch: 1,
  tilt: 0,
  earL: 0,
  earR: 0,
  gx: 0,
  gy: 0,
  blink: 0,
  happy: 0,
  sleepy: 0,
  worry: 0,
  wide: 0,
  squint: 0,
  accent: 0,
}

export interface Palette {
  body: string
  eye: string
  accent: string
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

function mix(a: string, b: string, t: number): string {
  const pa = parse(a)
  const pb = parse(b)
  return `rgb(${Math.round(lerp(pa[0], pb[0], t))},${Math.round(lerp(pa[1], pb[1], t))},${Math.round(lerp(pa[2], pb[2], t))})`
}

const cache = new Map<string, [number, number, number]>()
function parse(c: string): [number, number, number] {
  const hit = cache.get(c)
  if (hit) return hit
  let r = 0
  let g = 0
  let b = 0
  const h = c.trim()
  if (h.startsWith('#')) {
    const n = h.length === 4 ? h.slice(1).replace(/./g, (x) => x + x) : h.slice(1, 7)
    r = parseInt(n.slice(0, 2), 16)
    g = parseInt(n.slice(2, 4), 16)
    b = parseInt(n.slice(4, 6), 16)
  } else {
    const m = /rgba?\(([^)]+)\)/.exec(h)
    if (m) [r, g, b] = m[1].split(',').map((x) => parseFloat(x)) as [number, number, number]
  }
  const v: [number, number, number] = [r, g, b]
  cache.set(c, v)
  return v
}

export function drawKumo(ctx: CanvasRenderingContext2D, S: number, p: Pose, pal: Palette): void {
  const bw = S * 0.66 * (1 / Math.sqrt(p.stretch))
  const bh = S * 0.5 * p.stretch
  const cx = S / 2
  const bottom = S * 0.93 + p.lift * S
  const top = bottom - bh
  const left = cx - bw / 2
  const r = Math.min(bw, bh) * 0.3

  ctx.save()
  ctx.translate(cx, bottom)
  ctx.rotate(p.tilt)
  ctx.translate(-cx, -bottom)
  ctx.fillStyle = pal.body

  const ear = (side: -1 | 1, rot: number): void => {
    const baseIn = cx + side * bw * 0.1
    const baseOut = cx + side * bw * 0.48
    const baseY = top + bh * 0.16
    const tipX = cx + side * bw * (0.43 + 0.04 * rot)
    const tipY = top - bh * (0.6 + 0.06 * rot)
    const pivotX = (baseIn + baseOut) / 2
    ctx.save()
    ctx.translate(pivotX, baseY)
    ctx.rotate(side * rot * 0.22)
    ctx.translate(-pivotX, -baseY)
    ctx.beginPath()
    ctx.moveTo(baseIn, baseY)
    const tr = S * 0.035
    ctx.lineTo(tipX - side * tr * 0.9, tipY + tr * 1.4)
    ctx.quadraticCurveTo(tipX, tipY - tr * 0.2, tipX + side * tr * 0.5, tipY + tr * 1.2)
    ctx.lineTo(baseOut, baseY + bh * 0.1)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
  ear(-1, p.earL)
  ear(1, p.earR)

  ctx.beginPath()
  ctx.roundRect(left, top, bw, bh, r)
  ctx.fill()

  const eyeColor = p.accent > 0.01 ? mix(pal.eye, pal.accent, clamp(p.accent, 0, 1)) : pal.eye
  ctx.fillStyle = eyeColor
  ctx.strokeStyle = eyeColor
  const ey = top + bh * 0.54 + p.gy * bh * 0.09
  const spread = bw * 0.2
  const ew = bw * (0.105 + 0.02 * p.wide)
  const ehBase = bh * (0.3 + 0.08 * p.wide - 0.08 * p.squint)
  const gxOff = p.gx * bw * 0.075

  for (const side of [-1, 1] as const) {
    const ex = cx + side * spread + gxOff
    const open = 1 - clamp(p.blink, 0, 1)
    const happy = clamp(p.happy, 0, 1)
    const sleepy = clamp(p.sleepy, 0, 1)
    const worry = clamp(p.worry, 0, 1)
    const pill = 1 - Math.max(happy, sleepy)

    if (pill > 0.02) {
      const h = Math.max(ehBase * open * (1 - 0.35 * worry), ew * 0.32)
      ctx.save()
      ctx.globalAlpha = pill
      ctx.translate(ex, ey)
      ctx.rotate(side * -worry * 0.38)
      ctx.beginPath()
      ctx.roundRect(-ew / 2, -h / 2, ew, h, ew / 2)
      ctx.fill()
      ctx.restore()
    }
    if (happy > 0.02) {
      ctx.save()
      ctx.globalAlpha = happy
      ctx.lineWidth = ew * 0.72
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(ex, ey + ew * 0.55, ew * 0.95, Math.PI * 1.12, Math.PI * 1.88)
      ctx.stroke()
      ctx.restore()
    }
    if (sleepy > 0.02) {
      ctx.save()
      ctx.globalAlpha = sleepy
      ctx.lineWidth = ew * 0.55
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.arc(ex, ey - ew * 0.9, ew * 1.05, Math.PI * 0.2, Math.PI * 0.8)
      ctx.stroke()
      ctx.restore()
    }
  }
  ctx.restore()
}


class Spring {
  v = 0
  constructor(
    public x: number,
    private k = 170,
    private d = 22,
  ) {}
  step(target: number, dt: number): number {
    const a = this.k * (target - this.x) - this.d * this.v
    this.v += a * dt
    this.x += this.v * dt
    return this.x
  }
  set(k: number, d: number): void {
    this.k = k
    this.d = d
  }
}

const KEYS = Object.keys(NEUTRAL) as (keyof Pose)[]

export class Animator {
  private springs = Object.fromEntries(KEYS.map((k) => [k, new Spring(NEUTRAL[k])])) as Record<keyof Pose, Spring>
  private t = 0
  private nextBlink = 1.5
  private blinkT = -1
  private doubleBlink = false
  private hopT = -1
  private flickT = -1
  private mood: Mood = 'idle'
  private moodSince = 0
  private gaze = { x: 0, y: 0 }
  private poke = -1
  reduced = false

  constructor() {
    this.springs.gx.set(90, 16)
    this.springs.gy.set(90, 16)
    this.springs.blink.set(900, 50)
    this.springs.lift.set(260, 18)
    this.springs.stretch.set(320, 16)
  }

  setMood(m: Mood): void {
    if (m === this.mood) return
    const prev = this.mood
    this.mood = m
    this.moodSince = this.t
    if (m === 'success') this.hopT = this.t
    if (m === 'attention' || m === 'waiting') this.flickT = this.t
    if (prev === 'sleeping') this.blinkT = this.t
  }

  look(x: number, y: number): void {
    this.gaze.x = clamp(x, -1, 1)
    this.gaze.y = clamp(y, -1, 1)
  }

  nudge(): void {
    this.poke = this.t
    this.blinkT = this.t
  }

  step(dt: number): Pose {
    dt = Math.min(dt, 1 / 20)
    this.t += dt
    const t = this.t
    const m = this.mood
    const since = t - this.moodSince
    const target: Pose = { ...NEUTRAL }

    const breathe = this.reduced ? 0 : Math.sin(t * (m === 'sleeping' ? 1.4 : 2.2)) * (m === 'sleeping' ? 0.022 : 0.012)
    target.stretch = 1 + breathe

    target.gx = this.gaze.x
    target.gy = this.gaze.y

    switch (m) {
      case 'working': {
        target.gy = 0.35
        target.gx = this.reduced ? 0 : Math.sin(t * 1.6) * 0.55
        target.lift = this.reduced ? 0 : -Math.abs(Math.sin(t * 3.2)) * 0.012
        target.squint = 0.2
        break
      }
      case 'thinking':
        target.gx = 0.6
        target.gy = -0.7
        target.squint = 0.35
        target.tilt = 0.06
        target.earR = 0.4
        break
      case 'waiting': {
        target.wide = 1
        target.earL = target.earR = 0.9
        target.accent = 1
        const cycle = (t - this.moodSince) % 2.4
        if (!this.reduced && cycle < 0.36) {
          const k = Math.sin((cycle / 0.36) * Math.PI)
          target.lift = -0.07 * k
          target.stretch = 1 + 0.05 * k
        }
        break
      }
      case 'attention':
        target.wide = 0.8
        target.earL = target.earR = 1
        target.gx = this.gaze.x * 0.6
        target.gy = this.gaze.y * 0.6
        break
      case 'success':
        target.happy = since < 2.6 ? 1 : 0
        target.earL = target.earR = 0.6
        break
      case 'error':
        target.worry = 1
        target.earL = target.earR = -0.9
        target.gy = 0.4
        target.accent = 0.85
        target.tilt = since < 0.5 && !this.reduced ? Math.sin(since * 40) * 0.05 * (1 - since * 2) : 0
        break
      case 'sleeping':
        target.sleepy = 1
        target.earL = target.earR = -0.5
        target.gx = 0
        target.gy = 0.2
        target.lift = 0.02
        break
      default:
        break
    }

    if (this.flickT >= 0 && !this.reduced) {
      const ft = t - this.flickT
      if (ft < 0.5) {
        const k = Math.sin((ft / 0.25) * Math.PI)
        target.earL += 0.5 * k
        target.earR += 0.5 * k
      } else this.flickT = -1
    }

    if (this.hopT >= 0 && !this.reduced) {
      const ht = t - this.hopT
      if (ht < 0.55) {
        const k = Math.sin((ht / 0.55) * Math.PI)
        target.lift = -0.13 * k
        target.stretch = ht < 0.08 ? 0.9 : 1 + 0.06 * k
      } else this.hopT = -1
    }

    if (this.poke >= 0 && !this.reduced) {
      const pt = t - this.poke
      if (pt < 0.3) target.stretch *= 1 - 0.08 * Math.sin((pt / 0.3) * Math.PI)
      else this.poke = -1
    }

    if (m !== 'sleeping' && target.happy < 0.5) {
      if (this.blinkT < 0 && t >= this.nextBlink) {
        this.blinkT = t
        this.doubleBlink = Math.random() < 0.2
        this.nextBlink = t + 2.4 + Math.random() * 3.6
      }
      if (this.blinkT >= 0) {
        const bt = t - this.blinkT
        const dur = this.doubleBlink ? 0.42 : 0.16
        if (bt < dur) target.blink = this.doubleBlink ? (bt < 0.16 || (bt > 0.24 && bt < 0.4) ? 1 : 0) : 1
        else this.blinkT = -1
      }
    }

    const out = {} as Pose
    for (const k of KEYS) out[k] = this.springs[k].step(target[k], dt)
    return out
  }
}
