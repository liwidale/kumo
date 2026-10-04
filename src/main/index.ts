import { app, globalShortcut, ipcMain, Notification, nativeTheme, powerMonitor, screen } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chat } from './chat/chat'
import { history } from './history'
import { context } from './context'
import { invalidateDetect } from './detect'
import { ensureRuntime, restartHookServer, startHookServer, stopHookServer } from './hookServer'
import { ensureRelay } from './integrations'
import { applyPresence, createIsland, islandWindow, loadIsland, reassert, send } from './island'
import { broadcast, pushSnapshot, registerIpc, reloadWindows, resolvedTheme } from './ipc'
import { sessions } from './sessions'
import { settings } from './settings'
import { openSettings, refreshSettingsChrome, setSettingsUrl } from './settingsWindow'
import { asks, type AgentNote } from './asks'
import { setLauncherUrl, toggleLauncher } from './launcher'
import { updater } from './updater'
import { createTray, refreshTray } from './tray'
import { adapterFor } from './agents/adapters'
import { loadShellPath } from './platform/darwin'
import { isMac, log } from './util'


const primary = app.requestSingleInstanceLock()
if (primary && process.argv.includes('--quit')) {
  app.exit(0)
}
if (!primary) {
  app.quit()
  process.exit(0)
}

app.setName('Kumo')
if (process.platform === 'win32') app.setAppUserModelId('app.kumo.desktop')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const rendererUrl = (page: string): string => {
  const dev = process.env.KUMO_DEV_URL
  if (dev) return `${dev}/${page}.html`
  return pathToFileURL(path.join(__dirname, '../renderer', `${page}.html`)).toString()
}

function applyTheme(): void {
  nativeTheme.themeSource = settings.get().theme
}

let registeredHotkey = ''
let registeredLauncher = ''
let approvalKeys = false

function registerLauncherHotkey(): void {
  const key = settings.get().launcherHotkey
  if (registeredLauncher === key) return
  if (registeredLauncher) globalShortcut.unregister(registeredLauncher)
  registeredLauncher = ''
  if (!key) return
  try {
    if (globalShortcut.register(key, () => toggleLauncher())) registeredLauncher = key
    else log('launcher hotkey taken:', key)
  } catch (e) {
    log('launcher hotkey invalid:', key, e)
  }
}

function registerHotkey(): void {
  const key = settings.get().hotkey
  if (registeredHotkey === key) return
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey)
  registeredHotkey = ''
  if (!key) return
  try {
    if (
      globalShortcut.register(key, () => {
        log('hotkey pressed')
        send({ type: 'toggle' })
      })
    ) {
      registeredHotkey = key
      log('hotkey registered:', key)
    } else log('hotkey taken:', key)
  } catch (e) {
    log('hotkey invalid:', key, e)
  }
}

const ALLOW_KEY = isMac ? 'Command+Alt+Y' : 'Control+Alt+Y'
const DENY_KEY = isMac ? 'Command+Alt+N' : 'Control+Alt+N'

function syncApprovalKeys(): void {
  const want = settings.get().approvals.globalKeys && sessions.approvals().length > 0
  if (want === approvalKeys) return
  approvalKeys = want
  if (want) {
    globalShortcut.register(ALLOW_KEY, () => send({ type: 'decide', behavior: 'allow' }))
    globalShortcut.register(DENY_KEY, () => send({ type: 'decide', behavior: 'deny' }))
  } else {
    globalShortcut.unregister(ALLOW_KEY)
    globalShortcut.unregister(DENY_KEY)
  }
}

function systemNote(title: string, body: string, onClick: () => void): void {
  if (!settings.get().approvals.notify || !Notification.isSupported()) return
  const n = new Notification({ title, body, silent: true })
  n.on('click', onClick)
  n.show()
}

function notifyApproval(key: string): void {
  const s = settings.get()
  if (!s.approvals.notify || !Notification.isSupported()) return
  const a = sessions.approvals().find((x) => x.sessionKey === key)
  if (!a) return
  const n = new Notification({ title: `${adapterFor(a.agent).descriptor.name} · ${a.project}`, body: `${a.title}\n${a.subject.slice(0, 140)}`, silent: true })
  n.on('click', () => send({ type: 'focus-approval' }))
  n.show()
}

app.whenReady().then(async () => {
  if (isMac && !process.env.TERM_PROGRAM) await loadShellPath().catch((e) => log('shell PATH unavailable', e))
  settings.load()
  applyTheme()
  context.load()
  history.load()
  ensureRelay()
  registerIpc()
  await startHookServer()
  sessions.start()

  setSettingsUrl(rendererUrl('settings'))
  setLauncherUrl(rendererUrl('launcher'))
  createIsland()
  loadIsland(rendererUrl('island'))
  createTray()
  registerHotkey()
  registerLauncherHotkey()
  updater.start()
  if (isMac) app.dock?.hide()
  if (app.getLoginItemSettings().openAtLogin !== settings.get().launchAtLogin) app.setLoginItemSettings({ openAtLogin: settings.get().launchAtLogin })

  sessions.on('change', () => {
    pushSnapshot()
    refreshTray()
    syncApprovalKeys()
    applyPresence()
  })
  sessions.on('alert', (kind: string, key: string) => {
    islandWindow()?.webContents.send('island:alert', { kind, sessionKey: key })
    if (kind === 'approval') notifyApproval(key)
  })
  asks.on('change', () => {
    pushSnapshot()
    refreshTray()
  })
  asks.on('alert', (a: { agent: string; project: string; question: string; sessionKey?: string }) => {
    islandWindow()?.webContents.send('island:alert', { kind: 'ask', sessionKey: a.sessionKey || '' })
    systemNote(`${adapterFor(a.agent).descriptor.name} · ${a.project}`, a.question.slice(0, 180), () => send({ type: 'focus-approval' }))
  })
  asks.on('resolved', (a: { sessionKey?: string }) => islandWindow()?.webContents.send('island:alert', { kind: 'resolved', sessionKey: a.sessionKey || '' }))
  asks.on('note', (n: AgentNote) => {
    islandWindow()?.webContents.send('island:alert', { kind: 'message', sessionKey: n.sessionKey || '', note: { ...n, agentName: adapterFor(n.agent).descriptor.name } })
    if (settings.get().presence === 'tray') systemNote(n.title || `${adapterFor(n.agent).descriptor.name} · ${n.project}`, n.text.slice(0, 200), () => send({ type: 'expand' }))
  })
  updater.on('change', () => {
    pushSnapshot()
    refreshTray()
  })
  context.on('change', () => pushSnapshot())
  chat.on('event', (e) => broadcast('chat', e))

  settings.on('change', (next, prev) => {
    broadcast('settings', next)
    if (next.theme !== prev.theme) applyTheme()
    if (next.hotkey !== prev.hotkey) registerHotkey()
    if (next.launcherHotkey !== prev.launcherHotkey) registerLauncherHotkey()
    if (next.language !== prev.language) reloadWindows()
    if (next.display !== prev.display) reassert()
    if (next.presence !== prev.presence) {
      applyPresence()
      if (next.presence === 'island') reassert()
    }
    if (next.launchAtLogin !== prev.launchAtLogin) app.setLoginItemSettings({ openAtLogin: next.launchAtLogin })
    if (JSON.stringify(next.aliases) !== JSON.stringify(prev.aliases)) sessions.refreshNames()
    if (next.approvals.globalKeys !== prev.approvals.globalKeys) syncApprovalKeys()
    refreshTray()
  })

  nativeTheme.on('updated', () => {
    broadcast('theme', resolvedTheme())
    refreshSettingsChrome()
    refreshTray()
  })

  const replace = (): void => {
    setTimeout(reassert, 300)
  }
  screen.on('display-added', replace)
  screen.on('display-removed', replace)
  screen.on('display-metrics-changed', replace)

  powerMonitor.on('resume', () => {
    log('resumed from sleep')
    ensureRuntime()
    invalidateDetect()
    sessions.revalidate()
    context.revalidate()
    setTimeout(reassert, 800)
  })
  powerMonitor.on('unlock-screen', () => setTimeout(reassert, 500))

  setInterval(() => {
    ensureRuntime()
    refreshTray()
  }, 30_000)

  if (!settings.get().onboarded) {
    setTimeout(() => send({ type: 'expand' }), 1800)
  }

  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--quit')) app.quit()
    else openSettings()
  })
  app.on('activate', () => openSettings())
})

app.on('window-all-closed', () => {
})

let quitting = false
app.on('before-quit', (e) => {
  e.preventDefault()
  if (quitting) return
  quitting = true
  globalShortcut.unregisterAll()
  sessions.stop()
  asks.stop()
  updater.stop()
  settings.flush()
  history.flush()
  for (const c of chat.list()) chat.stop(c.id)
  const island = islandWindow()
  const goodbye = new Promise<void>((resolve) => {
    if (!island || island.isDestroyed() || !island.isVisible()) {
      log('goodbye skipped: island not visible')
      return resolve()
    }
    const started = Date.now()
    const done = (): void => {
      log(`goodbye finished in ${Date.now() - started} ms`)
      resolve()
    }
    ipcMain.once('island:goodbye-done', done)
    setTimeout(done, 1600)
    send({ type: 'goodbye' })
  })
  Promise.all([goodbye, stopHookServer().catch(() => undefined)]).finally(() => app.exit(0))
})

process.on('uncaughtException', (e) => log('uncaught', e))
process.on('unhandledRejection', (e) => log('unhandled', e))

export { restartHookServer }
