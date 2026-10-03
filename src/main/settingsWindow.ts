import { BrowserWindow, nativeTheme } from 'electron'
import path from 'node:path'
import type { SettingsSection } from '../shared/types'
import { settings } from './settings'
import { isMac, isWin } from './util'


let win: BrowserWindow | null = null
let rendererUrl = ''

export function setSettingsUrl(url: string): void {
  rendererUrl = url
}

function dark(): boolean {
  const t = settings.get().theme
  return t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors)
}

const winBackground = (): string => (dark() ? '#000000' : '#f3f3f3')

export function refreshSettingsChrome(): void {
  if (!win || win.isDestroyed() || !isWin) return
  try {
    win.setBackgroundColor(winBackground())
    win.setTitleBarOverlay({ color: '#00000000', symbolColor: dark() ? '#f2f2f2' : '#1c1c1e', height: 44 })
  } catch {
  }
}

export function openSettings(section?: SettingsSection): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (section) win.webContents.send('settings:section', section)
    return
  }
  win = new BrowserWindow({
    width: 820,
    height: 600,
    minWidth: 700,
    minHeight: 480,
    show: false,
    title: 'Kumo Settings',
    backgroundColor: isMac ? '#00000000' : winBackground(),
    autoHideMenuBar: true,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const, transparent: true, trafficLightPosition: { x: 18, y: 18 } }
      : isWin
        ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: dark() ? '#f2f2f2' : '#1c1c1e', height: 44 } }
        : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  win.setMenu(null)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  const url = section ? `${rendererUrl}#${section}` : rendererUrl
  void win.loadURL(url)
  win.once('ready-to-show', () => {
    win?.show()
    win?.focus()
  })
  win.on('closed', () => {
    win = null
  })
}

export const settingsWindow = (): BrowserWindow | null => win
