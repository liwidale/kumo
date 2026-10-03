import { app, Menu, nativeImage, nativeTheme, Tray } from 'electron'
import path from 'node:path'
import { send } from './island'
import { sessions } from './sessions'
import { settings } from './settings'
import { openSettings } from './settingsWindow'
import { isMac } from './util'

type Status = 'idle' | 'working' | 'waiting' | 'error' | 'done'

let tray: Tray | null = null
let blink: NodeJS.Timeout | null = null
let blinkOn = true
let lastKey = ''

function resource(...p: string[]): string {
  return app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(app.getAppPath(), 'resources', ...p)
}

function status(): Status {
  if (sessions.approvals().length) return 'waiting'
  const now = Date.now()
  const list = sessions.list().filter((s) => s.phase !== 'ended')
  if (list.some((s) => s.phase === 'question' || s.phase === 'waiting')) return 'waiting'
  if (list.some((s) => s.phase === 'error' && now - s.phaseSince < 10 * 60_000)) return 'error'
  if (list.some((s) => s.phase === 'working' || s.phase === 'thinking')) return 'working'
  if (list.some((s) => s.phase === 'done' && now - s.phaseSince < 10 * 60_000)) return 'done'
  return 'idle'
}

function icon(st: Status): Electron.NativeImage {
  if (isMac) {
    const img = nativeImage.createFromPath(resource('tray', 'trayTemplate.png'))
    img.setTemplateImage(true)
    return img
  }
  const tone = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'
  const showDot = st !== 'idle' && (st !== 'waiting' || blinkOn)
  return nativeImage.createFromPath(resource('tray', showDot ? `tray-${tone}-${st}.png` : `tray-${tone}.png`))
}

function macTitle(st: Status): string {
  const live = sessions.list().filter((s) => s.alive && s.phase !== 'ended').length
  if (st === 'waiting') return blinkOn ? ' !' : ' '
  if (st === 'working') return live > 1 ? ` ${live}` : ' ·'
  if (st === 'error') return ' ×'
  return ''
}

function tooltip(st: Status): string {
  const live = sessions.list().filter((s) => s.alive && s.phase !== 'ended').length
  const waiting = sessions.approvals().length
  if (waiting) return `Kumo - ${waiting} waiting for your OK`
  if (st === 'error') return 'Kumo - a session stopped with an error'
  if (st === 'working') return `Kumo - ${live} session${live === 1 ? '' : 's'} working`
  if (st === 'done') return 'Kumo - finished'
  return 'Kumo'
}

function menu(): Menu {
  const s = settings.get()
  const live = sessions.list().filter((x) => x.alive && x.phase !== 'ended')
  const approvals = sessions.approvals().length
  const trayOnly = s.presence === 'tray'
  return Menu.buildFromTemplate([
    { label: approvals ? `${approvals} waiting for your OK` : live.length ? `${live.length} session${live.length > 1 ? 's' : ''} running` : 'No agents running', enabled: false },
    ...live.slice(0, 5).map((x) => ({ label: `   ${x.project}`, sublabel: x.phase, enabled: false })),
    { type: 'separator' },
    { label: approvals ? 'Review request…' : 'Open Kumo', accelerator: s.hotkey, click: () => send({ type: approvals ? 'focus-approval' : 'expand' }) },
    { label: 'New Session…', click: () => send({ type: 'new-session' }) },
    { label: 'Chat', click: () => send({ type: 'chat' }) },
    { type: 'separator' },
    {
      label: isMac ? 'Menu Bar Only' : 'Tray Only',
      type: 'checkbox',
      checked: trayOnly,
      click: (item) => settings.set({ presence: item.checked ? 'tray' : 'island' }),
    },
    {
      label: 'Pause Notifications',
      type: 'checkbox',
      checked: s.paused,
      click: (item) => settings.set({ paused: item.checked }),
    },
    { label: 'Settings…', accelerator: isMac ? 'Command+,' : undefined, click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit Kumo', accelerator: isMac ? 'Command+Q' : undefined, click: () => app.quit() },
  ])
}

export function createTray(): void {
  tray = new Tray(icon('idle'))
  tray.setToolTip('Kumo')
  tray.on('click', () => {
    if (isMac) tray?.popUpContextMenu(menu())
    else send({ type: sessions.approvals().length ? 'focus-approval' : 'toggle' })
  })
  tray.on('right-click', () => tray?.popUpContextMenu(menu()))
  if (!isMac) tray.setContextMenu(null)
  refreshTray()
}

export function refreshTray(): void {
  if (!tray || tray.isDestroyed()) return
  const st = status()
  if (st === 'waiting' && !blink) {
    blink = setInterval(() => {
      blinkOn = !blinkOn
      paint(status())
    }, 700)
  } else if (st !== 'waiting' && blink) {
    clearInterval(blink)
    blink = null
    blinkOn = true
  }
  paint(st)
}

function paint(st: Status): void {
  if (!tray || tray.isDestroyed()) return
  const key = `${st}:${blinkOn}:${nativeTheme.shouldUseDarkColors}:${isMac ? macTitle(st) : ''}`
  if (key !== lastKey) {
    lastKey = key
    tray.setImage(icon(st))
    if (isMac) tray.setTitle(settings.get().presence === 'tray' ? macTitle(st) : '')
  }
  tray.setToolTip(tooltip(st))
}
