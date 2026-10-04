import { BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { isMac } from './util'

const WIDTH = 620
const MIN_HEIGHT = 120
const MAX_HEIGHT = 520

let win: BrowserWindow | null = null
let rendererUrl = ''
let ready = false

export function setLauncherUrl(url: string): void {
  rendererUrl = url
}

function place(w: BrowserWindow): void {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x, y, width, height } = d.workArea
  const [, h] = w.getSize()
  w.setBounds({ x: Math.round(x + (width - WIDTH) / 2), y: Math.round(y + height * 0.22), width: WIDTH, height: h })
}

function create(): BrowserWindow {
  const w = new BrowserWindow({
    width: WIDTH,
    height: 300,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Kumo',
    ...(isMac ? { type: 'panel' as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  w.setAlwaysOnTop(true, 'floating')
  w.setMenu(null)
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  w.on('blur', () => hideLauncher())
  w.on('closed', () => {
    win = null
    ready = false
  })
  w.webContents.once('did-finish-load', () => {
    ready = true
  })
  void w.loadURL(rendererUrl)
  return w
}

export function showLauncher(): void {
  if (!win || win.isDestroyed()) win = create()
  const w = win
  place(w)
  const reveal = (): void => {
    w.webContents.send('launcher:show')
    w.show()
    w.focus()
  }
  if (ready) reveal()
  else w.webContents.once('did-finish-load', reveal)
}

export function hideLauncher(): void {
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.webContents.send('launcher:hide')
    win.hide()
  }
}

export function toggleLauncher(): void {
  if (win && !win.isDestroyed() && win.isVisible()) hideLauncher()
  else showLauncher()
}

export function setLauncherHeight(h: number): void {
  if (!win || win.isDestroyed()) return
  const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(h)))
  const b = win.getBounds()
  if (b.height !== height) win.setBounds({ ...b, height })
}

export const launcherWindow = (): BrowserWindow | null => win
