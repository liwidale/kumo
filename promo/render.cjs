const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')

const args = process.argv.slice(2).filter((a) => !a.endsWith('render.cjs') && a !== '.')
const [ffmpeg, out] = args.filter((a) => !a.startsWith('--'))
const reel = args.includes('--reel')
const sheet = args.find((a) => a.startsWith('--sheet='))
const still = args.find((a) => a.startsWith('--still='))

app.whenReady().then(async () => {
  const W = reel ? 1080 : 1920
  const H = reel ? 1920 : 1080
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    webPreferences: { contextIsolation: false, backgroundThrottling: false },
  })
  await win.loadFile(path.join(__dirname, 'build', 'promo.html'), { query: reel ? { fmt: 'reel' } : {} })
  const info = await win.webContents.executeJavaScript('window.kumoPromo.init().then(() => ({ frames: window.kumoPromo.frames, fps: window.kumoPromo.fps }))')
  let frames = Array.from({ length: info.frames }, (_, i) => i)
  let ffArgs = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(info.fps), '-i', '-']
  if (still) {
    frames = [Math.round(Number(still.slice(8)) * info.fps)]
    ffArgs = [...ffArgs.slice(0, -4), '-r', '1', '-i', '-', '-frames:v', '1', out]
  } else if (sheet) {
    const [a, b] = sheet.slice(8).split('-').map(Number)
    frames = []
    for (let t = a; t < b - 1e-6; t += 0.2) frames.push(Math.round(t * info.fps))
    const cols = reel ? 10 : 5
    const rows = Math.ceil(frames.length / cols)
    ffArgs = [...ffArgs.slice(0, -4), '-r', '1', '-i', '-', '-vf', `scale=${reel ? 216 : 384}:-1,tile=${cols}x${rows}`, '-frames:v', '1', out]
  } else ffArgs.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out)
  const enc = spawn(ffmpeg, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] })
  const started = Date.now()
  for (let n = 0; n < frames.length; n++) {
    const buf = await win.webContents.executeJavaScript(`(() => { window.kumoPromo.frame(${frames[n]}); return window.kumoPromo.ctx.getImageData(0, 0, ${W}, ${H}).data })()`)
    if (!enc.stdin.write(Buffer.from(buf.buffer || buf))) await new Promise((r) => enc.stdin.once('drain', r))
    if (n % 150 === 0) process.stdout.write(`frame ${n}/${frames.length}\n`)
  }
  enc.stdin.end()
  await new Promise((r) => enc.on('close', r))
  process.stdout.write(`done in ${((Date.now() - started) / 1000).toFixed(1)}s -> ${out}\n`)
  app.quit()
})
