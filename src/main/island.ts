import { BrowserWindow, screen, type Display } from 'electron'
import path from 'node:path'
import type { IslandCommand, PointerInfo } from '../shared/api'
import type { DisplayInfo } from '../shared/types'
import { notchFor } from './notch'
import { captureActive, isFullscreenInFront } from './platform'
import { sessions } from './sessions'
import { settings } from './settings'
import { isMac, isWin, log } from './util'


const WIDTH = 760
const HEIGHT = 640

let win: BrowserWindow | null = null
let hit: { x: number; y: number; w: number; h: number } | null = null
let ignoring = true
let timer: NodeJS.Timeout | null = null
let fsTimer: NodeJS.Timeout | null = null
let lastPointer = { x: -1, y: -1, inside: false }
let display: DisplayInfo | null = null
let currentDisplayId = 0
let hiddenForFullscreen = false
let expanded = false
let compact = false
let painted = false
let capturedAt = 0

function captureSoon(): void {
  if (Date.now() - capturedAt < 1500) return
  capturedAt = Date.now()
  void captureActive()
}
const COMPACT_W = 480

function windowSize(): { w: number; h: number } {
  if (compact && display) return { w: COMPACT_W, h: display.top + Math.max(display.notchHeight, 36) + 14 }
  return { w: WIDTH, h: HEIGHT }
}

export const islandWindow = (): BrowserWindow | null => win

function pickDisplay(): Display {
  const pref = settings.get().display
  const all = screen.getAllDisplays()
  if (pref !== 'auto' && pref !== 'primary') {
    const d = all.find((x) => String(x.id) === pref)
    if (d) return d
  }
  if (pref === 'auto' && isMac) {
    const notched = all.find((d) => notchFor(d).hasNotch)
    if (notched) return notched
  }
  return screen.getPrimaryDisplay()
}

function computeDisplay(d: Display): DisplayInfo {
  const notch = notchFor(d)
  const menuBar = d.workArea.y - d.bounds.y
  const mode: DisplayInfo['mode'] = notch.hasNotch ? 'notch' : 'floating'
  const top = mode === 'notch' ? 0 : isMac ? Math.max(menuBar, 24) + 6 : Math.max(0, d.workArea.y - d.bounds.y) + 8
  return {
    mode,
    platform: process.platform as DisplayInfo['platform'],
    notchWidth: notch.width,
    notchHeight: notch.height || (isMac ? menuBar : 0),
    width: WIDTH,
    height: HEIGHT,
    top,
    scale: d.scaleFactor,
  }
}

export function place(): void {
  if (!win) return
  const d = pickDisplay()
  currentDisplayId = d.id
  display = computeDisplay(d)
  applySize(d)
  win.webContents.send('island:display', display)
}

function applySize(d?: Display): void {
  if (!win || win.isDestroyed()) return
  const disp = d || screen.getAllDisplays().find((x) => x.id === currentDisplayId) || screen.getPrimaryDisplay()
  const { w, h } = windowSize()
  win.setBounds({ x: Math.round(disp.bounds.x + disp.bounds.width / 2 - w / 2), y: disp.bounds.y, width: w, height: h })
}

export function setCompact(v: boolean): void {
  if (v === compact) return
  compact = v
  applySize()
}

export function createIsland(): BrowserWindow {
  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    roundedCorners: false,
    thickFrame: false,
    title: 'Kumo',
    ...(isMac ? { type: 'panel' as const, enableLargerThanScreen: true } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  if (isMac) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.setIgnoreMouseEvents(true, { forward: true })
  ignoring = true
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.on('render-process-gone', (_e, details) => {
    log('island renderer gone', details.reason)
    setTimeout(() => win && !win.isDestroyed() && win.reload(), 600)
  })
  place()
  win.once('ready-to-show', () => {
    painted = true
    if (settings.get().presence !== 'tray') win?.showInactive()
    startTracking()
  })
  win.on('closed', () => {
    stopTracking()
    painted = false
    win = null
  })
  return win
}

export function loadIsland(url: string): void {
  if (win) void win.loadURL(url)
}

export function currentDisplay(): DisplayInfo | null {
  return display
}

export function setHitRect(r: typeof hit): void {
  hit = r
}

export function setExpanded(v: boolean): void {
  if (settings.get().debug) log('island expanded:', v)
  if (v && !expanded) captureSoon()
  expanded = v
  applyPresence()
}

let presenceTimer: NodeJS.Timeout | null = null

export function applyPresence(): void {
  if (!win || win.isDestroyed() || !painted) return
  const trayOnly = settings.get().presence === 'tray'
  const wanted = !trayOnly || expanded || sessions.approvals().length > 0
  if (presenceTimer) {
    clearTimeout(presenceTimer)
    presenceTimer = null
  }
  if (wanted) {
    const insist = expanded || sessions.approvals().length > 0
    if (insist) hiddenForFullscreen = false
    if (!win.isVisible() && !hiddenForFullscreen) {
      win.showInactive()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
    return
  }
  presenceTimer = setTimeout(() => {
    if (win && !win.isDestroyed() && settings.get().presence === 'tray' && !expanded && sessions.approvals().length === 0) win.hide()
  }, 450)
}

export function setFocusable(focus: boolean): void {
  if (!win) return
  if (focus) {
    if (!win.isFocused()) captureSoon()
    win.setFocusable(true)
    if (!win.isVisible()) {
      hiddenForFullscreen = false
      win.show()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
    if (isMac) win.focus()
    else {
      win.focus()
      win.webContents.focus()
    }
  } else if (win.isFocusable()) {
    if (win.isFocused()) win.blur()
    win.setFocusable(false)
  }
}

export function send(cmd: IslandCommand): void {
  win?.webContents.send('island:command', cmd)
}

function startTracking(): void {
  stopTracking()
  timer = setInterval(track, 33)
  fsTimer = setInterval(checkFullscreen, 1500)
}

function stopTracking(): void {
  if (timer) clearInterval(timer)
  if (fsTimer) clearInterval(fsTimer)
  timer = fsTimer = null
}

function track(): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return
  const p = screen.getCursorScreenPoint()
  const b = win.getBounds()
  const x = p.x - b.x
  const y = p.y - b.y
  const inside = !!hit && x >= hit.x - 2 && x <= hit.x + hit.w + 2 && y >= hit.y - 2 && y <= hit.y + hit.h + 4
  if (inside === ignoring) {
    ignoring = !inside
    win.setIgnoreMouseEvents(ignoring, { forward: true })
  }
  if (inside && !lastPointer.inside && !expanded) captureSoon()
  if (x === lastPointer.x && y === lastPointer.y && inside === lastPointer.inside) return
  lastPointer = { x, y, inside }
  const cx = hit ? hit.x + Math.min(hit.w, 60) / 2 : b.width / 2
  const cy = hit ? hit.y + Math.min(hit.h, 40) / 2 : 20
  const info: PointerInfo = { x, y, inside, gx: x - cx, gy: y - cy }
  win.webContents.send('island:pointer', info)
}

function checkFullscreen(): void {
  if (!win || win.isDestroyed() || !isWin) return
  const d = screen.getAllDisplays().find((x) => x.id === currentDisplayId)
  if (!d) return
  const phys = screen.dipToScreenRect(null, d.bounds)
  const full = isFullscreenInFront(phys) && sessions.approvals().length === 0 && !expanded
  if (full && !hiddenForFullscreen) {
    hiddenForFullscreen = true
    win.hide()
  } else if (!full && hiddenForFullscreen && painted) {
    hiddenForFullscreen = false
    if (settings.get().presence !== 'tray' || expanded) {
      win.showInactive()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
  }
}

export function reassert(): void {
  if (!win || win.isDestroyed() || !painted) return
  place()
  win.setAlwaysOnTop(true, 'screen-saver')
  if (!win.isVisible() && !hiddenForFullscreen && settings.get().presence !== 'tray') win.showInactive()
  applyPresence()
}
