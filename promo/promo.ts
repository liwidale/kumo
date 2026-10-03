import antigravitySvg from '../src/renderer/assets/logos/antigravity.svg'
import claudeSvg from '../src/renderer/assets/logos/claudecode.svg'
import codexSvg from '../src/renderer/assets/logos/codex.svg'
import cursorSvg from '../src/renderer/assets/logos/cursor.svg'
import geminiSvg from '../src/renderer/assets/logos/geminicli.svg'
import { Animator, drawKumo, type Pose } from '../src/renderer/shared/character'
import type { Mood } from '../src/shared/types'

const V = new URLSearchParams(location.search).get('fmt') === 'reel'
const W = V ? 1080 : 1920
const H = V ? 1920 : 1080
const cx = W / 2
const cy = H / 2
const FPS = 30
const DURATION = 34.4

const canvas = document.getElementById('c') as HTMLCanvasElement
canvas.width = W
canvas.height = H
const ctx = canvas.getContext('2d', { willReadFrequently: true })!

const C = {
  bg: '#000000',
  white: '#f5f5f7',
  dim: 'rgba(245,245,247,0.6)',
  faint: 'rgba(245,245,247,0.32)',
  card: '#0d0d0f',
  line: 'rgba(255,255,255,0.16)',
  amber: '#ffb547',
  green: '#3ad37e',
  red: '#ff5c58',
  blue: '#4c9dff',
  violet: '#b98cff',
  pink: '#ff8fa3',
  cyan: '#62d6f5',
  clay: '#e0865f',
}
const DISPLAY = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif'
const MONO = '"Cascadia Code", "Cascadia Mono", Consolas, monospace'
const font = (size: number, weight = 600, family = DISPLAY): string => `${weight} ${size}px ${family}`

const TAU = Math.PI * 2
const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v))
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
const prog = (t: number, a: number, b: number): number => clamp((t - a) / (b - a))
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3)
const easeIn = (t: number): number => t * t * t
const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeBack = (t: number): number => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
const easeBounce = (x: number): number => {
  const n = 7.5625
  const d = 2.75
  if (x < 1 / d) return n * x * x
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375
  return n * (x -= 2.625 / d) * x + 0.984375
}
const bump = (t: number, a: number, b: number): number => Math.sin(prog(t, a, b) * Math.PI)
const hash = (i: number, j: number): number => {
  const s = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453
  return s - Math.floor(s)
}
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

let T = 0
let A = 1
const ga = (a: number): void => {
  ctx.globalAlpha = clamp(a) * A
}

type LogoName = 'claude' | 'antigravity' | 'codex' | 'gemini' | 'cursor'
const AGENTS: LogoName[] = ['claude', 'antigravity', 'codex', 'gemini', 'cursor']
const logos = {} as Record<LogoName, HTMLImageElement>
async function loadLogo(name: LogoName, svg: string): Promise<void> {
  const white = svg.replace(/currentColor/g, '#ffffff').replace(/width="1em"/, 'width="256"').replace(/height="1em"/, 'height="256"')
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(white)}`
  await img.decode()
  logos[name] = img
}

interface TextOpts {
  weight?: number
  color?: string | CanvasGradient
  align?: CanvasTextAlign
  alpha?: number
  family?: string
}

function text(str: string, x: number, y: number, size: number, o: TextOpts = {}): void {
  ctx.save()
  ctx.font = font(size, o.weight ?? 600, o.family ?? DISPLAY)
  ctx.textAlign = o.align ?? 'center'
  ctx.textBaseline = 'middle'
  ctx.globalAlpha *= clamp(o.alpha ?? 1)
  ctx.fillStyle = o.color ?? C.white
  ctx.fillText(str, x, y)
  ctx.restore()
}

const widths = new Map<string, number>()
function measure(str: string, size: number, weight = 600, family = DISPLAY): number {
  const key = `${size}|${weight}|${family}|${str}`
  let w = widths.get(key)
  if (w === undefined) {
    ctx.save()
    ctx.font = font(size, weight, family)
    w = ctx.measureText(str).width
    ctx.restore()
    widths.set(key, w)
  }
  return w
}

interface Fx {
  dx?: number
  dy?: number
  s?: number
  r?: number
  a?: number
  color?: string | CanvasGradient
}

function letters(str: string, x: number, y: number, size: number, o: TextOpts, fx: (i: number, n: number) => Fx): void {
  const weight = o.weight ?? 700
  const total = measure(str, size, weight)
  const left = o.align === 'left' ? x : x - total / 2
  const n = str.length
  for (let i = 0; i < n; i++) {
    const ch = str[i]
    if (ch === ' ') continue
    const gx = measure(str.slice(0, i), size, weight)
    const w = measure(str.slice(0, i + 1), size, weight) - gx
    const f = fx(i, n)
    const a = f.a ?? 1
    const s = f.s ?? 1
    if (a <= 0 || s <= 0) continue
    ctx.save()
    ctx.translate(left + gx + w / 2 + (f.dx ?? 0), y + (f.dy ?? 0))
    if (f.r) ctx.rotate(f.r)
    if (s !== 1) ctx.scale(s, s)
    text(ch, 0, 0, size, { weight, color: f.color ?? o.color, alpha: a })
    ctx.restore()
  }
}

function rise(str: string, x: number, y: number, size: number, p: number, o: TextOpts = {}): void {
  const k = easeOut(clamp(p))
  if (k <= 0) return
  ctx.save()
  ctx.beginPath()
  ctx.rect(x - 4000, y - size * 0.72, 8000, size * 1.44)
  ctx.clip()
  text(str, x, y + (1 - k) * size * 1.1, size, o)
  ctx.restore()
}

function wordsRise(str: string, x: number, y: number, size: number, t0: number, lt: number, o: TextOpts = {}, stagger = 0.05): void {
  const weight = o.weight ?? 600
  const total = measure(str, size, weight)
  const left = x - total / 2
  let at = 0
  str.split(' ').forEach((w, i) => {
    const start = measure(str.slice(0, at), size, weight)
    const ww = measure(w, size, weight)
    rise(w, left + start + ww / 2, y, size, prog(lt, t0 + i * stagger, t0 + i * stagger + 0.4), o)
    at += w.length + 1
  })
}

function rrect(x: number, y: number, w: number, h: number, r: number, fill?: string | CanvasGradient, stroke?: string, lw = 1.5): void {
  if (w <= 0 || h <= 0) return
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
  if (fill) {
    ctx.fillStyle = fill
    ctx.fill()
  }
  if (stroke) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = lw
    ctx.stroke()
  }
}

function logo(name: LogoName, x: number, y: number, size: number): void {
  ctx.drawImage(logos[name], x - size / 2, y - size / 2, size, size)
}

function tile(name: LogoName, x: number, y: number, s: number, alpha = 1): void {
  if (s <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  rrect(x - s / 2, y - s / 2, s, s, s * 0.26, '#17171a', 'rgba(255,255,255,0.14)')
  logo(name, x, y, s * 0.5)
  ctx.restore()
}

function pointer(x: number, y: number, s = 1, alpha = 1): void {
  if (alpha <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(0, 40)
  ctx.lineTo(10, 30)
  ctx.lineTo(18, 46)
  ctx.lineTo(25, 43)
  ctx.lineTo(17, 28)
  ctx.lineTo(30, 28)
  ctx.closePath()
  ctx.fillStyle = C.white
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 2.5
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.fill()
  ctx.restore()
}

function check(x: number, y: number, size: number, p: number, color: string, lw: number): void {
  if (p <= 0) return
  const L = Math.hypot(0.36, 0.36) * size + Math.hypot(0.64, 0.72) * size
  ctx.save()
  ctx.translate(x, y)
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([L * p, L])
  ctx.beginPath()
  ctx.moveTo(-0.5 * size, 0)
  ctx.lineTo(-0.14 * size, 0.36 * size)
  ctx.lineTo(0.5 * size, -0.36 * size)
  ctx.stroke()
  ctx.restore()
}

const kumos = new Map<string, Animator>()
function kumo(id: string, x: number, y: number, size: number, mood: Mood, extra: Partial<Pose> = {}, gaze: [number, number] = [0, 0], alpha = 1, scale = 1): void {
  let a = kumos.get(id)
  if (!a) {
    a = new Animator()
    kumos.set(id, a)
  }
  a.setMood(mood)
  a.look(gaze[0], gaze[1])
  const pose = { ...a.step(1 / FPS), ...extra }
  if (alpha <= 0 || scale <= 0) return
  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.translate(-size / 2, -size / 2)
  drawKumo(ctx, size, pose, { body: C.white, eye: '#000000', accent: mood === 'error' ? C.red : C.amber })
  ctx.restore()
}

interface Ripple {
  t: number
  x: number
  y: number
  color: string
  power: number
}
const ripples: Ripple[] = []
const G = 40
const gcols = Math.floor(W / G) + 1
const grows = Math.floor(H / G) + 1
const gox = (W - (gcols - 1) * G) / 2
const goy = (H - (grows - 1) * G) / 2
const RIPPLE_LIFE = 1.8

function background(): void {
  ctx.globalAlpha = 1
  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)
  const live = ripples.filter((r) => T >= r.t && T - r.t < RIPPLE_LIFE)
  const span = (W + H) * 0.7
  const band = ((T * 520) % (span + 900)) - 450
  for (let j = 0; j < grows; j++)
    for (let i = 0; i < gcols; i++) {
      const x = gox + i * G
      const y = goy + j * G
      let rip = 0
      let col = C.white
      let dx = 0
      let dy = 0
      for (const r of live) {
        const age = T - r.t
        const dd = Math.hypot(x - r.x, y - r.y)
        const off = (dd - age * 1400) / 80
        if (off > 3 || off < -3) continue
        const v = Math.exp(-off * off) * Math.pow(1 - age / RIPPLE_LIFE, 1.6) * r.power
        if (v > rip) {
          rip = v
          col = r.color
        }
        dx += ((x - r.x) / (dd || 1)) * v * 7
        dy += ((y - r.y) / (dd || 1)) * v * 7
      }
      rip = Math.min(1, rip)
      const sw = Math.exp(-Math.pow(((x + y) * 0.7 - band) / 170, 2))
      const ex = (x - cx) / (W / 2)
      const ey = (y - cy) / (H / 2)
      const edge = 1 - 0.6 * Math.min(1, (ex * ex + ey * ey) / 2)
      const tw = 0.5 + 0.5 * Math.sin(T * 1.6 + hash(i, j) * TAU)
      ctx.globalAlpha = Math.min(1, (0.07 + 0.035 * tw + 0.17 * sw + 0.8 * rip) * edge)
      ctx.fillStyle = rip > 0.12 ? col : C.white
      ctx.beginPath()
      ctx.arc(x + dx, y + dy, 1.5 + 0.7 * sw + 2.6 * rip, 0, TAU)
      ctx.fill()
    }
  ctx.globalAlpha = 1
}

type Tr = 'cut' | 'zoom' | 'up' | 'down' | 'left' | 'iris' | 'wipe' | 'blinds' | 'spin'
type Beat = [lt: number, x: number, y: number, power?: number, color?: string]
interface Scene {
  id: string
  at: number
  end: number
  tr: Tr
  accent: string
  draw: (lt: number, d: number) => void
  beats: Beat[]
  still: boolean
}

const GLITCH_FONTS = ['Georgia', 'Impact', '"Courier New"', '"Segoe Script"', 'Consolas', '"Segoe UI Black"', '"Comic Sans MS"', 'Bahnschrift', '"Palatino Linotype"', '"Lucida Console"']
const GLITCH_COLORS = [C.pink, C.amber, C.green, C.blue, C.violet, C.cyan, C.clay, '#ffe066', '#7cf0b0']

function introLayout(): { size: number; cs: number; kx: number; ky: number; wx: number; wy: number } {
  const size = V ? 190 : 150
  const cs = V ? 250 : 150
  const total = measure('Kumo', size, 650)
  if (V) return { size, cs, kx: cx, ky: cy - 190, wx: cx - total / 2, wy: cy + 100 }
  const gap = 34
  const all = cs + gap + total
  return { size, cs, kx: cx - all / 2 + cs / 2, ky: cy - 4, wx: cx - all / 2 + cs + gap, wy: cy }
}

function sIntro(lt: number): void {
  const { size, cs, kx, ky, wx, wy } = introLayout()
  const pop = easeBack(prog(lt, 0.05, 0.5))
  const since = Math.max(0, lt - 0.05)
  const land = Math.max(0, lt - 2.15)
  const stretch = 1 + 0.22 * Math.sin(since * 20) * Math.exp(-since * 6) - (lt > 2.15 ? 0.2 * Math.sin(land * 26) * Math.exp(-land * 8) : 0) + (lt > 1.52 && lt < 1.62 ? -0.12 : 0)
  const lift = -0.5 * bump(lt, 1.62, 2.15)
  kumo('intro', kx, ky, cs, lt < 1.45 ? 'attention' : 'success', { lift, stretch }, V ? [0, 0.5] : [0.5, 0], 1, pop)

  const word = 'Kumo'
  for (let i = 0; i < word.length; i++) {
    const ch = word[i]
    const gx = measure(word.slice(0, i), size, 650)
    const w = measure(word.slice(0, i + 1), size, 650) - gx
    const px = wx + gx + w / 2
    const settle = 0.8 + i * 0.12
    if (lt < settle) {
      if (lt < 0.12) continue
      const r = rng(Math.floor(lt * 15) * 31 + i * 977)
      ctx.save()
      ctx.translate(px + (r() - 0.5) * 30, wy + (r() - 0.5) * 30)
      ctx.rotate((r() - 0.5) * 0.5)
      ctx.scale(0.75 + r() * 0.6, 0.75 + r() * 0.6)
      ctx.font = `${r() > 0.5 ? 'italic ' : ''}${r() > 0.5 ? 800 : 400} ${size}px ${GLITCH_FONTS[Math.floor(r() * GLITCH_FONTS.length)]}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = GLITCH_COLORS[Math.floor(r() * GLITCH_COLORS.length)]
      ctx.fillText(ch, 0, 0)
      ctx.restore()
    } else {
      const k = prog(lt, settle, settle + 0.35)
      const hop = -34 * bump(lt, 1.7 + i * 0.06, 2.1 + i * 0.06)
      ctx.save()
      ctx.translate(px, wy + hop)
      const s = lerp(1.4, 1, easeBack(k))
      ctx.scale(s, s)
      text(ch, 0, 0, size, { weight: 650 })
      ctx.restore()
    }
  }
  wordsRise('Your AI agents, at a glance.', cx, V ? cy + 290 : cy + 150, V ? 46 : 38, 1.9, lt, { weight: 500, color: C.dim })
}

const PROJECTS = ['kumo-main', 'relay', 'web-app', 'api', 'docs', 'infra', 'mobile', 'design', 'billing', 'search', 'auth', 'cli']
const TONES = [C.blue, C.violet, C.amber, C.green, C.pink, C.cyan]

function sessionCard(x: number, y: number, w: number, h: number, n: number): void {
  const r = rng(n * 7919 + 13)
  const tone = TONES[Math.floor(r() * TONES.length)]
  rrect(x, y, w, h, 22, '#101012', 'rgba(255,255,255,0.10)')
  logo(AGENTS[Math.floor(r() * AGENTS.length)], x + 38, y + 40, 28)
  text(PROJECTS[Math.floor(r() * PROJECTS.length)], x + 64, y + 40, 22, { align: 'left', weight: 600 })
  ctx.beginPath()
  ctx.arc(x + w - 32, y + 40, 7 + 2 * Math.sin(T * 6 + n), 0, TAU)
  ctx.fillStyle = tone
  ctx.fill()
  for (let l = 0; l < 3; l++) rrect(x + 22, y + 78 + l * 24, (w - 44) * (0.45 + r() * 0.5), 10, 5, 'rgba(255,255,255,0.13)')
  rrect(x + 22, y + h - 32, w - 44, 8, 4, 'rgba(255,255,255,0.1)')
  const f = (T * 0.35 + r()) % 1
  rrect(x + 22, y + h - 32, (w - 44) * f, 8, 4, tone)
}

function sCollage(lt: number, d: number): void {
  const cw = V ? 300 : 340
  const ch = 200
  const gap = 24
  const cols = V ? 5 : 7
  const rows = V ? 12 : 8
  const spanY = rows * (ch + gap)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.13)
  const z = lerp(1.35, 0.95, easeOut(prog(lt, 0, d + 0.4)))
  ctx.scale(z, z)
  for (let j = 0; j < cols; j++) {
    const off = (j % 2 ? 1 : -1) * (lt * 230) + j * 60
    for (let r = 0; r < rows; r++) {
      const y = ((((r * (ch + gap) + off) % spanY) + spanY) % spanY) - spanY / 2
      const x = (j - (cols - 1) / 2) * (cw + gap) - cw / 2
      const dist = Math.hypot(x + cw / 2, y + ch / 2)
      const appear = easeOut(prog(lt, dist * 0.00035, dist * 0.00035 + 0.35))
      if (appear <= 0) continue
      ctx.save()
      ctx.translate(x + cw / 2, y + ch / 2)
      const s = lerp(0.5, 1, easeBack(appear))
      ctx.scale(s, s)
      ga(appear)
      sessionCard(-cw / 2, -ch / 2, cw, ch, j * rows + r)
      ctx.restore()
    }
  }
  ctx.restore()
}

function sOne(lt: number): void {
  const k = easeOut(prog(lt, 0, 0.22))
  const s = lerp(3, 1, k) + 0.05 * prog(lt, 0.22, 0.9)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(s, s)
  ga(prog(lt, 0, 0.08))
  text('One', 0, 0, V ? 230 : 190, { weight: 700 })
  ctx.restore()
}

function sIslandWord(lt: number): void {
  const size = V ? 120 : 110
  const tw = measure('island.', size, 700)
  const ph = size * 1.5
  const ks = size * 0.85
  const pw = 44 + ks + 30 + tw + 60
  const g = easeBack(prog(lt, 0, 0.42))
  const h = ph * Math.min(1, g * 4)
  const w = Math.max(h, pw * g)
  const x = cx - w / 2
  const y = cy - h / 2
  if (h <= 0) return
  rrect(x, y, w, h, h / 2, C.card, 'rgba(255,255,255,0.22)', 2.5)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, h / 2)
  ctx.clip()
  kumo('iw', cx - pw / 2 + 44 + ks / 2, cy, ks, 'idle', {}, [0.6, 0], 1, easeBack(prog(lt, 0.15, 0.45)))
  text('island.', cx - pw / 2 + 44 + ks + 30, cy + (1 - easeOut(prog(lt, 0.28, 0.6))) * size * 1.3, size, { align: 'left', weight: 700 })
  ctx.restore()
}

const RX = V ? 400 : 580
const RY = V ? 540 : 250
function orbit(i: number, t: number): { x: number; y: number; depth: number } {
  const a = -Math.PI / 2 + (i * TAU) / 5 + t * 1.2
  return { x: cx + Math.cos(a) * RX, y: cy + Math.sin(a) * RY, depth: Math.sin(a) }
}
const orbitSize = (depth: number): number => 112 * (0.8 + 0.2 * depth)
const orbitAlpha = (depth: number): number => 0.5 + 0.5 * ((depth + 1) / 2)

function everyText(fx: (i: number) => Fx): void {
  if (V) {
    letters('Every', cx, cy - 100, 170, { weight: 700 }, (i) => fx(i))
    letters('agent.', cx, cy + 90, 170, { weight: 700 }, (i) => fx(i + 5))
  } else letters('Every agent.', cx, cy, 120, { weight: 700 }, fx)
}

function sEvery(lt: number): void {
  AGENTS.map((n, i) => ({ n, i, o: orbit(i, T) }))
    .sort((a, b) => a.o.depth - b.o.depth)
    .forEach(({ n, i, o }) => {
      const app = easeBack(prog(lt, 0.15 + i * 0.06, 0.5 + i * 0.06))
      tile(n, o.x, o.y, orbitSize(o.depth) * app, orbitAlpha(o.depth))
    })
  everyText((i) => {
    const k = prog(lt, i * 0.03, i * 0.03 + 0.42)
    return { dy: -(1 - easeBack(k)) * 170, r: (1 - easeOut(k)) * (i % 2 ? 0.5 : -0.5), a: clamp(k * 4) }
  })
}

function sDock(lt: number): void {
  const out = prog(lt, 0, 0.3)
  everyText(() => ({ a: 1 - out, dy: -80 * easeIn(out) }))
  const size = 120
  const gap = 34
  const total = AGENTS.length * size + (AGENTS.length - 1) * gap
  const x0 = cx - total / 2
  const dockY = V ? cy - 60 : cy - 30
  const bw = (total + 60) * easeBack(prog(lt, 0.3, 0.7))
  rrect(cx - bw / 2, dockY - size / 2 - 26, bw, size + 52, 40, 'rgba(255,255,255,0.06)', 'rgba(255,255,255,0.12)')
  const from = sceneAt('dock')
  AGENTS.forEach((n, i) => {
    const o = orbit(i, from)
    const f = easeInOut(prog(lt, i * 0.05, 0.6 + i * 0.05))
    const b = bump(lt, 0.95 + i * 0.08, 1.3 + i * 0.08)
    const x = lerp(o.x, x0 + i * (size + gap) + size / 2, f)
    const y = lerp(o.y, dockY, f) - Math.sin(f * Math.PI) * 90 - 30 * b
    const s = lerp(orbitSize(o.depth), size, f) * (1 + 0.12 * b)
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate((1 - f) * (i % 2 ? 0.6 : -0.6))
    tile(n, 0, 0, s, lerp(orbitAlpha(o.depth), 1, f))
    ctx.restore()
  })
  const capY = dockY + size / 2 + 100
  if (V) {
    wordsRise('Claude Code · Antigravity · Codex', cx, capY, 36, 1.1, lt, { weight: 500, color: C.dim }, 0.04)
    wordsRise('Gemini CLI · Cursor', cx, capY + 54, 36, 1.25, lt, { weight: 500, color: C.dim }, 0.04)
  } else wordsRise('Claude Code · Antigravity · Codex · Gemini CLI · Cursor', cx, capY, 32, 1.1, lt, { weight: 500, color: C.dim }, 0.04)
}

const ISLAND = { s: V ? 1.1 : 1.3, top: V ? 470 : 92, w: V ? 880 : 1120, h: 420 }

function sIsland(lt: number): void {
  const { s, top, w: wO, h: hO } = ISLAND
  ctx.save()
  ctx.translate(cx, top)
  ctx.scale(s, s)
  const y = lerp(-(top / s) - 120, 0, easeBack(prog(lt, 0, 0.45)))
  const o = prog(lt, 0.95, 1.55)
  const sp = easeBack(o)
  const w = lerp(470, wO, sp)
  const h = lerp(72, hO, sp)
  const x = -w / 2
  rrect(x, y, w, h, lerp(36, 40, clamp(sp)), C.card, C.line, 2)
  kumo('island', x + 46, y + 36, 50, o > 0 ? 'working' : 'idle', { stretch: 1 + 0.15 * bump(lt, 0.92, 1.12) }, [0.6, 0.3])
  text('3 sessions working', x + 84, y + 37, 26, { align: 'left', alpha: 1 - clamp(o * 3) })
  text('kumo-main · Editing Settings.tsx', x + 84, y + 37, 26, { align: 'left', alpha: clamp((o - 0.3) * 3) })
  ctx.save()
  ctx.translate(x + w - 48, y + 36)
  ctx.rotate(T * 6)
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(76,157,255,0.25)'
  ctx.beginPath()
  ctx.arc(0, 0, 13, 0, TAU)
  ctx.stroke()
  ctx.strokeStyle = C.blue
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(0, 0, 13, 0, Math.PI * 0.7)
  ctx.stroke()
  ctx.restore()

  if (o > 0.5) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 40)
    ctx.clip()
    ga(easeOut(prog(o, 0.5, 1)))
    const bx = x + 40
    const iw = w - 80
    let by = y + 96
    rrect(bx, by, iw, 220, 22, 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.10)')
    rrect(bx + 22, by + 20, 54, 28, 7, 'rgba(76,157,255,0.18)')
    text('TSX', bx + 49, by + 34, 15, { weight: 700, color: C.blue, family: MONO })
    text('Settings.tsx', bx + 92, by + 34, 22, { align: 'left', weight: 700, family: MONO })
    text('+3  −1', bx + iw - 24, by + 34, 20, { align: 'right', weight: 600, family: MONO, color: C.green })
    const lines: [string, string][] = [
      ['-', '<option value="light">Light</option>'],
      ['+', '<option value="auto">Auto (follow the system)</option>'],
      ['+', '<option value="light">Light</option>'],
      ['+', '<p className="hint">Auto switches with your OS.</p>'],
    ]
    by += 64
    lines.forEach(([sign, l], i) => {
      const shown = prog(lt, 1.55 + i * 0.2, 1.85 + i * 0.2)
      if (shown <= 0) return
      const sx = (1 - easeOut(shown)) * 40
      rrect(bx + 2 + sx, by + i * 36, iw - 4, 34, 0, sign === '+' ? 'rgba(58,211,126,0.13)' : 'rgba(255,92,88,0.13)')
      text(`${sign}  ${l.slice(0, Math.floor(l.length * shown))}`, bx + 24 + sx, by + i * 36 + 17, 21, { align: 'left', weight: 500, family: MONO, color: sign === '+' ? '#9de8bf' : '#ffb0ad' })
    })
    by = y + 350
    const bw = (iw - 40) / 2
    text('Plan 2/4 · Adding an Auto option', bx, by, 20, { align: 'left', weight: 500, color: C.dim })
    rrect(bx, by + 22, bw, 8, 4, 'rgba(255,255,255,0.1)')
    rrect(bx, by + 22, bw * lerp(0.25, 0.5, easeInOut(prog(lt, 1.8, 2.7))), 8, 4, C.white)
    text('Context 62%', bx + bw + 40, by, 20, { align: 'left', weight: 500, color: C.dim })
    rrect(bx + bw + 40, by + 22, bw, 8, 4, 'rgba(255,255,255,0.1)')
    rrect(bx + bw + 40, by + 22, bw * lerp(0.4, 0.62, easeInOut(prog(lt, 1.8, 2.7))), 8, 4, C.green)
    ctx.restore()
  }
  const mv = easeInOut(prog(lt, 0.4, 0.92))
  pointer(lerp(wO * 0.42, 70, mv), lerp(hO + 60, y + 44, mv), 1 - 0.12 * bump(lt, 0.88, 1.0), 1 - prog(lt, 1.3, 1.55))
  ctx.restore()
  rise('Watch every step.', cx, V ? top + hO * s + 170 : 905, V ? 76 : 64, prog(lt, 2.0, 2.45), { weight: 650 })
}

function sTracks(lt: number, d: number): void {
  const tw = V ? 880 : 1040
  const th = 56
  const gap = 18
  const y0 = V ? cy - 300 : cy - 220
  const left = cx - tw / 2
  const colors = [C.green, C.red, C.violet, C.amber]
  colors.forEach((col, i) => {
    const k = easeOut(prog(lt, i * 0.08, 0.5 + i * 0.08))
    const y = y0 + i * (th + gap)
    ctx.save()
    ctx.translate((i % 2 ? 1 : -1) * (1 - k) * W, 0)
    rrect(left, y, tw, th, 12, col)
    const r = rng(i * 101 + 5)
    for (let n = 0; left + 18 + n * 30 < left + tw - 18; n++) {
      const amp = 0.2 + 0.8 * Math.abs(Math.sin(T * 4.2 + n * 0.55 + i * 1.7)) * (0.4 + 0.6 * r())
      const hh = 6 + (th - 20) * amp
      rrect(left + 16 + n * 30, y + th / 2 - hh / 2, 6, hh, 3, 'rgba(0,0,0,0.38)')
    }
    ctx.restore()
  })
  const bottom = y0 + 4 * (th + gap)
  const px = left + tw * easeInOut(prog(lt, 0.5, d))
  ga(prog(lt, 0.45, 0.6))
  rrect(px - 2, y0 - 28, 4, bottom - y0 + 36, 2, C.white)
  ctx.beginPath()
  ctx.moveTo(px - 13, y0 - 40)
  ctx.lineTo(px + 13, y0 - 40)
  ctx.lineTo(px, y0 - 24)
  ctx.closePath()
  ctx.fillStyle = C.white
  ctx.fill()
  ga(1)
  const msg = 'Review every change.'
  const size = V ? 76 : 72
  const shown = msg.slice(0, Math.floor(msg.length * prog(lt, 0.6, 1.4)))
  const capY = bottom + (V ? 190 : 150)
  const g = ctx.createLinearGradient(cx - 380, 0, cx + 380, 0)
  g.addColorStop(0, C.violet)
  g.addColorStop(1, C.blue)
  text(shown, cx, capY, size, { weight: 650, color: g })
  if (lt > 0.6 && Math.floor(lt * 3) % 2 === 0) rrect(cx + measure(shown, size, 650) / 2 + 8, capY - size * 0.55, 5, size * 1.1, 2.5, C.white)
}

const APPROVAL = { s: V ? 1.1 : 1.3, cy: V ? cy - 180 : 455, w: V ? 860 : 980, h: 380 }
const approveAt = (): [number, number] => [cx + (APPROVAL.w / 2 - 146) * APPROVAL.s, APPROVAL.cy + (-APPROVAL.h / 2 + 312) * APPROVAL.s]

function sApproval(lt: number): void {
  const { s, cy: ccy, w, h } = APPROVAL
  const k = prog(lt, 0, 0.55)
  ctx.save()
  ctx.translate(cx, ccy)
  ctx.scale(s, s)
  ctx.translate(0, lerp(-(ccy + h * s) / s - 40, 0, easeBack(k)))
  ctx.rotate((1 - easeOut(k)) * -0.14)
  const x = -w / 2
  const y = -h / 2
  rrect(x, y, w, h, 34, C.card, C.line, 2)
  const allowed = lt > 1.1
  kumo('approve', x + 54, y + 52, 58, allowed ? 'success' : 'waiting', { lift: -0.35 * bump(lt, 1.12, 1.42) }, [0.5, 0.2])
  text('Claude Code needs your OK', x + 100, y + 54, 26, { align: 'left', color: C.amber })
  text('Run a command', x + 46, y + 128, 40, { align: 'left', weight: 700 })
  rrect(x + 46, y + 166, w - 92, 74, 16, 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.10)')
  text('$ npm test -- --watch=false', x + 76, y + 204, 26, { align: 'left', family: MONO, weight: 500 })
  rrect(x + w - 410, y + 280, 160, 62, 31, 'rgba(255,255,255,0.10)')
  text('Deny', x + w - 330, y + 312, 26)
  const bx = x + w - 146
  const by = y + 312
  ctx.save()
  ctx.translate(bx, by)
  const bs = 1 - 0.08 * bump(lt, 1.0, 1.16) + 0.06 * bump(lt, 1.16, 1.4)
  ctx.scale(bs, bs)
  rrect(-100, -31, 200, 62, 31, allowed ? C.green : C.white)
  if (allowed) {
    check(-56, 1, 30, prog(lt, 1.12, 1.3), '#0b0b0c', 5)
    text('Allowed', 14, 1, 26, { weight: 650, color: '#0b0b0c' })
  } else text('Allow', 0, 1, 26, { weight: 650, color: '#0b0b0c' })
  ctx.restore()
  const rp = prog(lt, 1.08, 1.7)
  if (rp > 0 && rp < 1) {
    const g = 60 * easeOut(rp)
    ctx.save()
    ctx.globalAlpha *= 1 - rp
    rrect(bx - 100 - g, by - 31 - g, 200 + 2 * g, 62 + 2 * g, 31 + g, undefined, C.green, 3)
    ctx.restore()
  }
  const mv = easeInOut(prog(lt, 0.4, 0.98))
  pointer(lerp(x + w + 180, bx + 14, mv), lerp(y + h + 180, by + 8, mv), 1 - 0.15 * bump(lt, 1.0, 1.16), 1 - prog(lt, 1.5, 1.8))
  ctx.restore()
  rise('From anywhere on your screen.', cx, V ? ccy + (h / 2) * s + 200 : 910, V ? 56 : 54, prog(lt, 1.3, 1.7), { weight: 650 })
}

const VS = V ? 150 : 140

function vApprove(lt: number): void {
  letters('Approve it.', cx, cy - 30, VS, { weight: 700 }, (i) => {
    const k = prog(lt, i * 0.025, i * 0.025 + 0.32)
    return { s: easeBack(k), a: clamp(k * 3), dy: (1 - easeOut(k)) * 50 }
  })
  const s = 1 + 0.2 * bump(lt, 0.58, 0.78)
  ctx.save()
  ctx.translate(cx, cy + 130)
  ctx.scale(s, s)
  check(0, 0, 90, prog(lt, 0.32, 0.58), C.amber, 14)
  ctx.restore()
}

function vQueue(lt: number): void {
  letters('Queue it.', cx, cy - 70, VS, { weight: 700 }, (i) => {
    const k = prog(lt, i * 0.035, i * 0.035 + 0.4)
    return { dy: -(1 - easeBack(k)) * 240, a: clamp(k * 4), color: i < 5 ? C.blue : C.white }
  })
  const labels = ['Run the tests', 'Fix lint', 'Ship it']
  const ws = labels.map((l) => measure(l, 26, 600) + 56)
  const gap = 18
  const total = ws.reduce((a, b) => a + b, 0) + gap * (labels.length - 1)
  const shift = easeInOut(prog(lt, 0.78, 1.0))
  let x = cx - total / 2
  labels.forEach((l, j) => {
    const k = easeBack(prog(lt, 0.3 + j * 0.1, 0.62 + j * 0.1))
    let px = x + (1 - k) * 800
    let py = cy + 90
    let a = clamp(k * 3)
    if (j === 0) {
      py -= 60 * shift
      a *= 1 - shift
    } else px -= shift * (ws[0] + gap)
    ctx.save()
    ctx.globalAlpha *= a
    rrect(px, py - 30, ws[j], 60, 30, 'rgba(76,157,255,0.14)', C.blue, 2)
    text(l, px + ws[j] / 2, py + 1, 26)
    ctx.restore()
    x += ws[j] + gap
  })
}

function vStop(lt: number): void {
  const tw = measure('Stop it.', VS, 700)
  const sq = VS * 0.66
  const gap = 44
  const left = cx - (sq + gap + tw) / 2
  const slide = lerp(-W * 0.8, 0, easeOut(prog(lt, 0, 0.28)))
  const shake = lt > 0.36 ? Math.sin(lt * 95) * 16 * Math.exp(-(lt - 0.36) * 10) : 0
  ctx.save()
  ctx.translate(slide + shake, 0)
  text('Stop it.', left + sq + gap + tw / 2, cy, VS, { weight: 700 })
  ctx.restore()
  const sk = prog(lt, 0.2, 0.38)
  if (sk > 0) {
    ctx.save()
    ctx.translate(left + sq / 2 + shake, cy)
    ctx.rotate((1 - easeOut(sk)) * 0.8)
    const s = lerp(3, 1, easeOut(sk))
    ctx.scale(s, s)
    ctx.globalAlpha *= clamp(sk * 3)
    rrect(-sq / 2, -sq / 2, sq, sq, sq * 0.22, C.red)
    ctx.restore()
  }
}

function vReview(lt: number): void {
  const tw = measure('Review it.', VS, 700)
  const sweep = easeInOut(prog(lt, 0.05, 0.75))
  const g = ctx.createLinearGradient(cx - tw / 2, 0, cx + tw / 2, 0)
  g.addColorStop(0, C.green)
  g.addColorStop(clamp(sweep), C.green)
  g.addColorStop(clamp(sweep + 0.001), C.white)
  g.addColorStop(1, C.white)
  text('Review it.', cx, cy - 40, VS, { weight: 700, color: g })
  if (sweep > 0 && sweep < 1) rrect(cx - tw / 2 + tw * sweep - 2, cy - 40 - VS * 0.6, 4, VS * 1.2, 2, C.white)
  for (let i = 0; i < 4; i++) {
    const rw = 680 * easeOut(prog(lt, 0.1 + i * 0.08, 0.5 + i * 0.08))
    rrect(cx - rw / 2, cy + 80 + i * 30, rw, 16, 8, i === 1 ? 'rgba(255,92,88,0.7)' : 'rgba(58,211,126,0.7)')
  }
}

function vRevert(lt: number, d: number): void {
  const s = 'Revert it.'
  const t = lt / d
  const n = t < 0.32 ? Math.ceil(s.length * (t / 0.32)) : t < 0.58 ? Math.ceil(s.length * (1 - (t - 0.32) / 0.26)) : Math.ceil(s.length * clamp((t - 0.58) / 0.3))
  const shown = s.slice(0, Math.max(0, n))
  const rewinding = t > 0.32 && t < 0.58
  text(shown, cx, cy + 40, VS, { weight: 700, color: rewinding ? C.violet : C.white })
  rrect(cx + measure(shown, VS, 700) / 2 + 10, cy + 40 - VS * 0.5, 7, VS, 3.5, C.violet)
  const a0 = rewinding ? -lt * 14 : -lt * 4
  ctx.save()
  ctx.translate(cx, cy - 150)
  ctx.strokeStyle = C.violet
  ctx.lineWidth = 11
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(0, 0, 46, a0, a0 + Math.PI * 1.45)
  ctx.stroke()
  ctx.translate(Math.cos(a0) * 46, Math.sin(a0) * 46)
  ctx.rotate(a0 - Math.PI / 2)
  ctx.fillStyle = C.violet
  ctx.beginPath()
  ctx.moveTo(-18, 2)
  ctx.lineTo(18, 2)
  ctx.lineTo(0, -20)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function vAsk(lt: number): void {
  const s = 'Ask it.'
  const shown = s.slice(0, Math.floor(s.length * prog(lt, 0, 0.4)))
  text(shown, cx, cy - 90, VS, { weight: 700 })
  if (Math.floor(lt * 4) % 2 === 0 || lt < 0.4) rrect(cx + measure(shown, VS, 700) / 2 + 10, cy - 90 - VS * 0.45, 7, VS * 0.9, 3.5, C.amber)
  const q = 'Summarize what my agents did today'
  const qs = V ? 30 : 28
  const bw = measure(q, qs, 500) + 72
  const b = easeBack(prog(lt, 0.3, 0.6))
  if (b > 0) {
    ctx.save()
    ctx.translate(cx, cy + 90)
    ctx.scale(b, b)
    rrect(-bw / 2, -38, bw, 76, 38, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.16)')
    const words = q.split(' ')
    text(words.slice(0, Math.ceil(words.length * prog(lt, 0.45, 0.75))).join(' '), -bw / 2 + 36, 1, qs, { align: 'left', weight: 500 })
    ctx.restore()
  }
  const dots = prog(lt, 0.78, 0.85)
  for (let i = 0; i < 3 && dots > 0; i++) {
    ctx.save()
    ctx.globalAlpha *= dots
    ctx.beginPath()
    ctx.arc(cx - bw / 2 + 30 + i * 26, cy + 180 - 10 * Math.abs(Math.sin(lt * 12 - i * 0.8)), 8, 0, TAU)
    ctx.fillStyle = C.white
    ctx.fill()
    ctx.restore()
  }
}

function vTrack(lt: number): void {
  letters('Track it.', cx, V ? cy - 230 : cy - 70, VS, { weight: 700 }, (i) => {
    const k = prog(lt, i * 0.03, i * 0.03 + 0.3)
    return { dy: (1 - easeOut(k)) * 80, a: k }
  })
  const bars: [string, number, string][] = [
    ['5-hour', 0.42, C.green],
    ['Week', 0.18, C.green],
    ['Context', 0.62, C.amber],
  ]
  bars.forEach(([label, v, col], i) => {
    const k = easeOut(prog(lt, 0.15 + i * 0.08, 0.7 + i * 0.08))
    const bw = V ? 760 : 320
    const bx = V ? cx - bw / 2 : cx - 540 + i * 380
    const by = V ? cy - 20 + i * 150 : cy + 110
    ga(clamp(k * 2))
    text(label, bx, by - 34, V ? 34 : 26, { align: 'left', weight: 500, color: C.dim })
    text(`${Math.round(v * 100 * k)}%`, bx + bw, by - 34, V ? 34 : 26, { align: 'right', weight: 700 })
    rrect(bx, by, bw, 14, 7, 'rgba(255,255,255,0.12)')
    rrect(bx, by, bw * v * k, 14, 7, col)
    ga(1)
  })
}

function vDrop(lt: number): void {
  const tw = V ? 380 : 320
  const th = tw * 0.66
  const ty = V ? cy - 230 : cy - 160
  const f = prog(lt, 0, 0.5)
  const y = lerp(-th - 40, ty, easeBounce(f))
  ctx.save()
  ctx.translate(cx, y)
  ctx.rotate(lerp(0.5, -0.05, easeOut(f)))
  ctx.beginPath()
  ctx.roundRect(-tw / 2, -th / 2, tw, th, 20)
  ctx.save()
  ctx.clip()
  const sky = ctx.createLinearGradient(0, -th / 2, 0, th / 2)
  sky.addColorStop(0, '#6b5cff')
  sky.addColorStop(1, '#ff9f6b')
  ctx.fillStyle = sky
  ctx.fillRect(-tw / 2, -th / 2, tw, th)
  ctx.fillStyle = '#ffe08a'
  ctx.beginPath()
  ctx.arc(tw * 0.18, -th * 0.12, th * 0.14, 0, TAU)
  ctx.fill()
  ctx.fillStyle = '#1d1640'
  ctx.beginPath()
  ctx.moveTo(-tw / 2, th / 2)
  ctx.lineTo(-tw * 0.18, -th * 0.08)
  ctx.lineTo(tw * 0.1, th / 2)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#2b2160'
  ctx.beginPath()
  ctx.moveTo(-tw * 0.1, th / 2)
  ctx.lineTo(tw * 0.22, th * 0.05)
  ctx.lineTo(tw / 2, th / 2)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
  ctx.beginPath()
  ctx.roundRect(-tw / 2, -th / 2, tw, th, 20)
  ctx.strokeStyle = C.white
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.restore()
  letters('Drop it.', cx, V ? cy + 90 : cy + 110, VS, { weight: 700 }, (i) => {
    const k = prog(lt, 0.12 + i * 0.04, 0.6 + i * 0.04)
    return { dy: -(1 - easeBounce(k)) * 300, a: clamp(k * 5) }
  })
  const b = easeBack(prog(lt, 0.6, 0.85))
  if (b > 0) {
    ctx.save()
    ctx.translate(cx, V ? cy + 240 : cy + 250)
    ctx.scale(b, b)
    rrect(-150, -28, 300, 56, 28, 'rgba(58,211,126,0.15)', C.green, 2)
    text('+ Added to chat', 0, 1, 24, { color: C.green })
    ctx.restore()
  }
}

function sPrivacy(lt: number): void {
  const ly = V ? cy - 330 : cy - 270
  const size = V ? 112 : 104
  const pop = easeBack(prog(lt, 0, 0.35))
  if (pop > 0) {
    ctx.save()
    ctx.translate(cx, ly)
    ctx.scale(pop, pop)
    const shut = easeBack(prog(lt, 0.5, 0.75))
    const sy = -10 - lerp(28, 0, shut)
    ctx.strokeStyle = C.white
    ctx.lineWidth = 12
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(-28, sy + 22)
    ctx.lineTo(-28, sy)
    ctx.arc(0, sy, 28, Math.PI, 0)
    ctx.lineTo(28, sy + (shut > 0.5 ? 22 : 8))
    ctx.stroke()
    rrect(-50, -4, 100, 78, 18, C.white)
    ctx.beginPath()
    ctx.arc(0, 30, 9, 0, TAU)
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()
  }
  rise('No account.', cx, V ? cy - 90 : cy - 70, size, prog(lt, 0.1, 0.5), { weight: 700 })
  rise('No cloud.', cx, V ? cy + 40 : cy + 50, size, prog(lt, 0.3, 0.7), { weight: 700 })
  if (V) {
    wordsRise('Everything stays', cx, cy + 200, 46, 0.8, lt, { weight: 500, color: C.dim })
    wordsRise('on your computer.', cx, cy + 260, 46, 0.95, lt, { weight: 500, color: C.dim })
  } else wordsRise('Everything stays on your computer.', cx, cy + 175, 38, 0.8, lt, { weight: 500, color: C.dim })
}

function sNames(lt: number): void {
  const rows: [LogoName, string, string][] = [
    ['claude', 'Claude Code', C.clay],
    ['antigravity', 'Antigravity', C.blue],
    ['codex', 'Codex', C.white],
    ['gemini', 'Gemini CLI', C.cyan],
    ['cursor', 'Cursor', '#c9cdd6'],
  ]
  const lh = V ? 140 : 108
  const size = V ? 86 : 74
  const y0 = cy - ((rows.length - 1) * lh) / 2
  rows.forEach(([name, label, col], i) => {
    const k = easeBack(prog(lt, i * 0.1, i * 0.1 + 0.5))
    const dir = i % 2 ? 1 : -1
    const w = measure(label, size, 700)
    const x = cx - (w + 96) / 2 + dir * (1 - k) * W * 0.7 + dir * 14 * Math.sin(prog(lt, 0.6, 2.2) * Math.PI)
    const y = y0 + i * lh
    ctx.save()
    ctx.translate(x + 34, y)
    ctx.rotate((1 - easeOut(prog(lt, i * 0.1, i * 0.1 + 0.5))) * dir * Math.PI)
    logo(name, 0, 0, 68)
    ctx.restore()
    text(label, x + 96, y, size, { align: 'left', weight: 700, color: col })
  })
}

const FREE = ['Free.', 'Local.', 'Yours.']
const FREE_SIZE = V ? 190 : 124
function freeAt(i: number): [number, number] {
  if (V) return [cx, cy - 230 + i * 230]
  const all = FREE.join(' ')
  const left = cx - measure(all, FREE_SIZE, 700) / 2
  const before = FREE.slice(0, i).join(' ') + (i ? ' ' : '')
  return [left + measure(before, FREE_SIZE, 700) + measure(FREE[i], FREE_SIZE, 700) / 2, cy]
}

function sFree(lt: number): void {
  FREE.forEach((wd, i) => {
    const k = prog(lt, i * 0.38, i * 0.38 + 0.22)
    if (k <= 0) return
    const [x, y] = freeAt(i)
    ctx.save()
    ctx.translate(x, y)
    const s = lerp(1.6, 1, easeOut(k))
    ctx.scale(s, s)
    letters(wd, 0, 0, FREE_SIZE, { weight: 700 }, (j) => ({
      a: clamp(k * 3),
      dy: -22 * bump(lt, 1.45 + i * 0.15 + j * 0.03, 1.8 + i * 0.15 + j * 0.03),
      color: i === 2 ? C.amber : C.white,
    }))
    ctx.restore()
  })
}

function sEnd(lt: number, d: number): void {
  const cs = V ? 260 : 190
  const ky = V ? cy - 230 : cy - 120
  const pop = easeBack(prog(lt, 0, 0.45))
  const hide = prog(lt, d - 1.2, d - 0.65)
  if (hide < 1) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, ky + cs / 2 + 4)
    ctx.clip()
    const lift = -0.25 * bump(lt, 0.7, 1.05)
    kumo('end', cx, ky + easeInOut(hide) * (cs + 40), cs, hide > 0 ? 'sleeping' : lt > 0.6 ? 'success' : 'idle', { lift }, [0, 0.25], 1, pop)
    ctx.restore()
  }
  letters('Kumo', cx, V ? cy + 20 : cy + 70, V ? 150 : 120, { weight: 650 }, (i) => {
    const k = prog(lt, 0.25 + i * 0.05, 0.6 + i * 0.05)
    return { dy: (1 - easeBack(k)) * 70, a: k }
  })
  if (V) {
    wordsRise('A quiet companion', cx, cy + 170, 50, 0.6, lt, { weight: 500, color: C.dim })
    wordsRise('for your AI coding agents.', cx, cy + 235, 50, 0.75, lt, { weight: 500, color: C.dim })
  } else wordsRise('A quiet companion for your AI coding agents.', cx, cy + 170, 40, 0.6, lt, { weight: 500, color: C.dim })
  rise('Windows  ·  macOS', cx, V ? cy + 340 : cy + 250, V ? 34 : 28, prog(lt, 1.0, 1.4), { weight: 500, color: C.faint })
}

const S: Scene[] = []
function sceneAt(id: string): number {
  return S.find((s) => s.id === id)!.at
}

function buildTimeline(): void {
  let cursor = 0
  const add = (id: string, dur: number, tr: Tr, accent: string, draw: Scene['draw'], beats: Beat[] = [], still = false): void => {
    S.push({ id, at: cursor, end: cursor + dur, tr, accent, draw, beats, still })
    cursor += dur
  }
  const intro = introLayout()
  add('intro', 2.9, 'cut', C.amber, sIntro, [
    [0.1, intro.kx, intro.ky, 1],
    [2.16, intro.kx, intro.ky + intro.cs / 2, 0.8, C.white],
  ])
  add('collage', 1.7, 'iris', C.blue, sCollage)
  add('one', 0.7, 'zoom', C.white, sOne, [[0.2, cx, cy, 1.2]])
  add('island-word', 0.95, 'up', C.white, sIslandWord)
  add('every', 1.3, 'left', C.violet, sEvery, [], true)
  add('dock', 1.8, 'cut', C.blue, sDock, [[0.62, cx, V ? cy - 60 : cy - 30, 1]], true)
  add('island', 3.1, 'blinds', C.green, sIsland, [[1.0, cx, ISLAND.top + 40, 1]])
  add('tracks', 2.0, 'wipe', C.violet, sTracks)
  add('approval', 2.0, 'up', C.amber, sApproval, [[1.1, ...approveAt(), 1, C.green]])
  add('approve', 1.05, 'zoom', C.amber, vApprove, [[0.5, cx, cy + 130, 0.9]])
  add('queue', 1.05, 'left', C.blue, vQueue)
  add('stop', 1.05, 'down', C.red, vStop, [[0.36, cx, cy, 1.1]])
  add('review', 1.05, 'blinds', C.green, vReview)
  add('revert', 1.05, 'spin', C.violet, vRevert)
  add('ask', 1.05, 'up', C.amber, vAsk)
  add('track', 1.05, 'iris', C.green, vTrack)
  add('drop', 1.05, 'wipe', C.pink, vDrop, [[0.18, cx, V ? cy - 230 : cy - 160, 1]])
  add('privacy', 2.1, 'zoom', C.white, sPrivacy, [[0.62, cx, V ? cy - 330 : cy - 270, 0.9, C.amber]])
  add('names', 1.8, 'left', C.blue, sNames)
  add('free', 2.6, 'blinds', C.amber, sFree, FREE.map((_, i) => [i * 0.38 + 0.18, ...freeAt(i), 1] as Beat))
  add('end', DURATION - cursor, 'iris', C.amber, sEnd, [[0.15, cx, V ? cy - 230 : cy - 120, 1]])

  for (const s of S) {
    if (s.tr !== 'cut') ripples.push({ t: s.at, x: cx, y: cy, color: s.accent, power: 0.7 })
    for (const [lt, x, y, power, color] of s.beats) ripples.push({ t: s.at + lt, x, y, power: power ?? 1, color: color ?? s.accent })
  }
}

const TD = 0.42

function zoomAt(s: number): void {
  ctx.translate(cx, cy)
  ctx.scale(s, s)
  ctx.translate(-cx, -cy)
}

function withAlpha(a: number, fn: () => void): void {
  const prev = A
  A = prev * clamp(a)
  if (A > 0) fn()
  A = prev
}

function layer(fn: () => void, setup: () => void): void {
  ctx.save()
  setup()
  fn()
  ctx.restore()
}

function transition(tr: Tr, p: number, out: () => void, inn: () => void): void {
  const e = easeInOut(p)
  switch (tr) {
    case 'zoom':
      layer(() => withAlpha(1 - e * 1.6, out), () => zoomAt(1 + 0.7 * e))
      layer(() => withAlpha(e * 1.5, inn), () => zoomAt(0.7 + 0.3 * easeOut(p)))
      break
    case 'up':
    case 'down': {
      const dir = tr === 'up' ? -1 : 1
      layer(() => withAlpha(1 - e, out), () => ctx.translate(0, dir * H * 0.4 * e))
      layer(() => withAlpha(e, inn), () => ctx.translate(0, -dir * H * 0.4 * (1 - e)))
      break
    }
    case 'left':
      layer(out, () => ctx.translate(-W * e, 0))
      layer(inn, () => ctx.translate(W * (1 - e), 0))
      break
    case 'spin':
      layer(() => withAlpha(1 - e, out), () => {
        ctx.translate(cx, cy)
        ctx.rotate(0.35 * e)
        ctx.scale(1 - 0.5 * e, 1 - 0.5 * e)
        ctx.translate(-cx, -cy)
      })
      layer(() => withAlpha(e, inn), () => {
        ctx.translate(cx, cy)
        ctx.rotate(-0.35 * (1 - e))
        ctx.scale(1.5 - 0.5 * e, 1.5 - 0.5 * e)
        ctx.translate(-cx, -cy)
      })
      break
    case 'iris': {
      const r = e * Math.hypot(W, H) * 0.52
      layer(out, () => {
        ctx.beginPath()
        ctx.rect(0, 0, W, H)
        ctx.arc(cx, cy, r, 0, TAU)
        ctx.clip('evenodd')
      })
      layer(inn, () => {
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, TAU)
        ctx.clip()
      })
      ctx.save()
      ctx.globalAlpha = 0.7 * (1 - e)
      ctx.strokeStyle = C.white
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, TAU)
      ctx.stroke()
      ctx.restore()
      break
    }
    case 'wipe': {
      const skew = H * 0.35
      const x0 = lerp(-skew, W + skew, e)
      layer(out, () => {
        ctx.beginPath()
        ctx.moveTo(W + 10, -10)
        ctx.lineTo(x0 + skew, -10)
        ctx.lineTo(x0 - skew, H + 10)
        ctx.lineTo(W + 10, H + 10)
        ctx.closePath()
        ctx.clip()
        ctx.translate(80 * e, 0)
      })
      layer(inn, () => {
        ctx.beginPath()
        ctx.moveTo(-10, -10)
        ctx.lineTo(x0 + skew, -10)
        ctx.lineTo(x0 - skew, H + 10)
        ctx.lineTo(-10, H + 10)
        ctx.closePath()
        ctx.clip()
        ctx.translate(-80 * (1 - e), 0)
      })
      ctx.save()
      ctx.strokeStyle = C.white
      ctx.lineWidth = 4
      ctx.globalAlpha = 0.85
      ctx.beginPath()
      ctx.moveTo(x0 + skew, -10)
      ctx.lineTo(x0 - skew, H + 10)
      ctx.stroke()
      ctx.restore()
      break
    }
    case 'blinds': {
      const n = V ? 12 : 8
      const sh = H / n
      const strips = (): void => {
        for (let i = 0; i < n; i++) {
          const hh = sh * easeInOut(clamp(p * 1.7 - (i / (n - 1)) * 0.7))
          if (hh > 0) ctx.rect(0, i * sh + (sh - hh) / 2, W, hh)
        }
      }
      layer(out, () => {
        ctx.beginPath()
        ctx.rect(0, 0, W, H)
        strips()
        ctx.clip('evenodd')
      })
      layer(inn, () => {
        ctx.beginPath()
        strips()
        ctx.clip()
      })
      break
    }
    default:
      inn()
  }
}

function drawScene(s: Scene): void {
  const lt = T - s.at
  const d = s.end - s.at
  ctx.save()
  if (!s.still) zoomAt(1 + 0.04 * (lt / d))
  ctx.globalAlpha = A
  s.draw(lt, d)
  ctx.restore()
}

function frame(i: number): void {
  T = i / FPS
  A = 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  background()
  let idx = S.findIndex((x) => T >= x.at && T < x.end)
  if (idx < 0) idx = S.length - 1
  const cur = S[idx]
  const prev = S[idx - 1]
  const p = (T - cur.at) / TD
  if (prev && p < 1 && cur.tr !== 'cut') transition(cur.tr, p, () => drawScene(prev), () => drawScene(cur))
  else drawScene(cur)
  const fade = Math.min(clamp(T / 0.3), clamp((DURATION - T) / 0.6))
  if (fade < 1) {
    ctx.globalAlpha = 1 - fade
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 1
  }
}

async function init(): Promise<void> {
  await Promise.all([document.fonts.load(font(100, 650)), document.fonts.load(font(100, 700)), document.fonts.load(font(40, 500)), document.fonts.load(font(30, 500, MONO))])
  await Promise.all([loadLogo('claude', claudeSvg), loadLogo('antigravity', antigravitySvg), loadLogo('codex', codexSvg), loadLogo('gemini', geminiSvg), loadLogo('cursor', cursorSvg)])
  widths.clear()
  buildTimeline()
}

;(window as unknown as { kumoPromo: unknown }).kumoPromo = { init, frame, frames: Math.round(DURATION * FPS), fps: FPS, W, H, ctx }
