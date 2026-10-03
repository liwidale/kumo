import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = (...p) => path.join(root, 'resources', ...p)
mkdirSync(out('tray'), { recursive: true })
mkdirSync(out('icons'), { recursive: true })

const bw = 0.7, bh = 0.54, bottom = 0.92, top = bottom - bh, left = 0.5 - bw / 2, r = Math.min(bw, bh) * 0.3
const eyeY = top + bh * 0.54, spread = bw * 0.2

function inRoundRect(x, y, x0, y0, w, h, rr) {
  if (x < x0 || x > x0 + w || y < y0 || y > y0 + h) return false
  const cx = Math.min(Math.max(x, x0 + rr), x0 + w - rr)
  const cy = Math.min(Math.max(y, y0 + rr), y0 + h - rr)
  return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr
}
function inTri(px, py, a, b, c) {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
  const p = [px, py]
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}
function inEar(x, y, side) {
  const baseY = top + bh * 0.16
  const a = [0.5 + side * bw * 0.1, baseY + 0.02]
  const b = [0.5 + side * bw * 0.43, top - bh * 0.6]
  const c = [0.5 + side * bw * 0.48, baseY + bh * 0.1]
  if (!inTri(x, y, a, b, c)) return false
  const tipR = 0.03
  const dy = y - b[1]
  if (dy < tipR * 1.2) {
    const cx = b[0] - side * tipR * 0.25
    const cy = b[1] + tipR * 1.15
    return (x - cx) ** 2 + (y - cy) ** 2 <= tipR * tipR * 1.4 || dy > tipR * 0.9
  }
  return true
}
function inEye(x, y, eyeScale) {
  const ew = bw * 0.105 * eyeScale, eh = bh * 0.3 * Math.min(eyeScale, 1.15)
  for (const side of [-1, 1]) if (inRoundRect(x, y, 0.5 + side * spread - ew / 2, eyeY - eh / 2, ew, eh, ew / 2)) return true
  return false
}
function kumo(x, y, eyeScale = 1) {
  if (inEye(x, y, eyeScale)) return 0
  return inRoundRect(x, y, left, top, bw, bh, r) || inEar(x, y, -1) || inEar(x, y, 1) ? 1 : 0
}

function render(size, paint) {
  const px = new Uint8ClampedArray(size * size * 4)
  const N = 4
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      let R = 0, G = 0, B = 0, A = 0
      for (let sj = 0; sj < N; sj++)
        for (let si = 0; si < N; si++) {
          const [cr, cg, cb, ca] = paint((i + (si + 0.5) / N) / size, (j + (sj + 0.5) / N) / size)
          R += cr * ca; G += cg * ca; B += cb * ca; A += ca
        }
      const k = (j * size + i) * 4
      const a = A / (N * N)
      px[k] = A ? R / A : 0; px[k + 1] = A ? G / A : 0; px[k + 2] = A ? B / A : 0; px[k + 3] = a * 255
    }
  return px
}

function png(size, px) {
  const crcTable = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c })
  const crc = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1) }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const squircle = (x, y, cx, cy, half) => Math.abs((x - cx) / half) ** 5 + Math.abs((y - cy) / half) ** 5 <= 1

function appIcon(size, pad) {
  const half = (1 - 2 * pad) / 2
  return render(size, (x, y) => {
    if (!squircle(x, y, 0.5, 0.5, half)) return [0, 0, 0, 0]
    const t = (y - pad) / (1 - 2 * pad)
    const bg = [28 - 14 * t, 28 - 14 * t, 31 - 15 * t]
    const s = 0.58 * (1 - 2 * pad)
    const kx = (x - 0.5) / s + 0.5
    const ky = (y - 0.5) / s + 0.5
    if (kx >= 0 && kx <= 1 && ky >= 0 && ky <= 1 && kumo(kx, ky)) return [246, 246, 248, 1]
    return [...bg, 1]
  })
}

function glyph(size, color, eyeScale, dot) {
  const m = size <= 18 ? 0.5 / size : 0.04
  const span = 0.86
  const s = (1 - 2 * m) / span
  const dx = 0.78, dy = 0.78, dr = 0.2, ring = 0.29
  return render(size, (x, y) => {
    if (dot) {
      const d = Math.hypot(x - dx, y - dy)
      if (d <= dr) return [...dot, 1]
      if (d <= ring) return [0, 0, 0, 0]
    }
    const kx = (x - 0.5) / s + 0.5
    const ky = (y - m) / s + 0.06
    return kx >= 0 && kx <= 1 && ky >= 0 && ky <= 1 && kumo(kx, ky, eyeScale) ? [...color, 1] : [0, 0, 0, 0]
  })
}

const write = (file, size, px) => writeFileSync(file, png(size, px))

write(out('tray', 'trayTemplate.png'), 18, glyph(18, [0, 0, 0], 1.35))
write(out('tray', 'trayTemplate@2x.png'), 36, glyph(36, [0, 0, 0], 1.25))
write(out('tray', 'tray-dark.png'), 32, glyph(32, [28, 28, 30], 1.3))
write(out('tray', 'tray-light.png'), 32, glyph(32, [250, 250, 250], 1.3))

const STATUS = { working: [76, 157, 255], waiting: [255, 181, 71], error: [255, 92, 88], done: [58, 211, 126] }
for (const [name, rgb] of Object.entries(STATUS)) {
  write(out('tray', `tray-dark-${name}.png`), 32, glyph(32, [28, 28, 30], 1.3, rgb))
  write(out('tray', `tray-light-${name}.png`), 32, glyph(32, [250, 250, 250], 1.3, rgb))
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const pngs = {}
for (const s of sizes) {
  pngs[s] = png(s, appIcon(s, s <= 32 ? 0.02 : 0.09))
}
writeFileSync(out('icons', 'icon.png'), pngs[1024])
writeFileSync(out('icons', 'icon-512.png'), pngs[512])

{
  const list = [16, 24, 32, 48, 64, 128, 256]
  const head = Buffer.alloc(6 + 16 * list.length)
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(list.length, 4)
  let offset = head.length
  list.forEach((s, i) => {
    const e = 6 + i * 16
    head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(pngs[s].length, e + 8); head.writeUInt32LE(offset, e + 12)
    offset += pngs[s].length
  })
  writeFileSync(out('icons', 'icon.ico'), Buffer.concat([head, ...list.map((s) => pngs[s])]))
}

{
  const entries = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]]
  const parts = entries.map(([t, s]) => {
    const h = Buffer.alloc(8); h.write(t, 0, 'ascii'); h.writeUInt32BE(pngs[s].length + 8, 4)
    return Buffer.concat([h, pngs[s]])
  })
  const body = Buffer.concat(parts)
  const h = Buffer.alloc(8); h.write('icns', 0, 'ascii'); h.writeUInt32BE(body.length + 8, 4)
  writeFileSync(out('icons', 'icon.icns'), Buffer.concat([h, body]))
}
console.log('icons written')
