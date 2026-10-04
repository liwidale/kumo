import { tr } from './i18n'
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, screen, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import type { ChatAttachment, ChatSendRequest, Decision, HookPreview, LaunchRequest, Settings, SettingsSection } from '../shared/types'
import { descriptors } from './agents/adapters'
import { asks } from './asks'
import { chat } from './chat/chat'
import { listModels, listProviders } from './chat/providers'
import { context } from './context'
import { detectInstalled, refreshDetect } from './detect'
import { gitDiff, gitInfo, revertFile } from './git'
import { history } from './history'
import { serverState } from './hookServer'
import * as integrations from './integrations'
import { currentDisplay, islandWindow, send, setCompact, setExpanded, setFocusable, setHitRect } from './island'
import { captureActive, jumpTo, lastActiveWindow, launch, openFolder, openInEditor, returnTo } from './platform'
import { hasSecret, setSecret } from './secrets'
import { sessions } from './sessions'
import { settings } from './settings'
import { openSettings, settingsWindow } from './settingsWindow'
import { hideLauncher, launcherWindow, setLauncherHeight } from './launcher'
import { updater } from './updater'
import { dataDir, debounce, exists, log } from './util'


async function clipboardBytes(format: string): Promise<Buffer | null> {
  try {
    if (!(await clipboard.has(format))) return null
    for (const item of await clipboard.read()) {
      try {
        const blob = await item.getType(format)
        if (blob instanceof Blob) return Buffer.from(await blob.arrayBuffer())
      } catch {
      }
    }
  } catch {
  }
  return null
}

async function clipboardFiles(): Promise<string[]> {
  const uris = await clipboardBytes('text/uri-list')
  if (!uris) return []
  return uris
    .toString('utf8')
    .split(/\r?\n/)
    .map((l) => l.replace(/\0+$/, '').trim())
    .filter((l) => l.startsWith('file:'))
    .map((l) => {
      try {
        return fileURLToPath(l)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
}

export function snapshot() {
  return {
    sessions: sessions.list(),
    approvals: sessions.approvals(),
    context: context.list(),
    integrations: integrations.allStatus(),
    agents: descriptors(),
    installed: detectInstalled(),
    serverOk: serverState.ok,
    serverError: serverState.error,
    version: app.getVersion(),
    limits: sessions.limits(),
    asks: asks.list(),
    update: updater.state,
  }
}

function windows(): BrowserWindow[] {
  return [islandWindow(), settingsWindow(), launcherWindow()].filter((w): w is BrowserWindow => !!w && !w.isDestroyed())
}

export function broadcast(channel: string, payload: unknown): void {
  for (const w of windows()) w.webContents.send(channel, payload)
}

export function reloadWindows(): void {
  for (const w of windows()) w.webContents.reload()
}

export const pushSnapshot = debounce(() => broadcast('snapshot', snapshot()), 50)

export function resolvedTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

const str = (v: unknown, max = 10_000): string => (typeof v === 'string' ? v.slice(0, max) : '')

export function registerIpc(): void {
  ipcMain.handle('snapshot', () => snapshot())
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.on('settings:language', (e) => {
    e.returnValue = settings.get().language
  })
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => settings.set(patch && typeof patch === 'object' ? patch : {}))
  ipcMain.handle('theme', () => resolvedTheme())

  ipcMain.handle('island:display', () => currentDisplay())
  ipcMain.on('island:hit', (_e, r) => {
    if (r === null) return setHitRect(null)
    if (r && typeof r === 'object' && [r.x, r.y, r.w, r.h].every((n: unknown) => typeof n === 'number' && Number.isFinite(n))) setHitRect({ x: r.x, y: r.y, w: r.w, h: r.h })
  })
  ipcMain.on('island:focusable', (_e, v) => setFocusable(Boolean(v)))
  ipcMain.on('island:compact', (_e, v) => setCompact(Boolean(v)))
  ipcMain.on('island:expanded', (_e, v) => setExpanded(Boolean(v)))
  ipcMain.handle('island:active-window', () => lastActiveWindow())
  ipcMain.handle('island:return', async () => {
    const r = await returnTo(lastActiveWindow())
    return r
  })

  ipcMain.handle('approval:decide', (_e, d: Decision) => {
    if (!d || typeof d.id !== 'string' || (d.behavior !== 'allow' && d.behavior !== 'deny')) return { ok: false, error: tr('Invalid decision') }
    const ok = sessions.decide({ id: d.id, behavior: d.behavior, remember: typeof d.remember === 'string' ? d.remember : undefined, message: str(d.message, 500) || undefined })
    return ok ? { ok: true } : { ok: false, error: tr('That request is no longer waiting - it was answered or cancelled.') }
  })
  ipcMain.handle('session:jump', async (_e, key: string) => {
    const s = sessions.get(str(key))
    if (!s) return { ok: false, error: tr('That session is gone.') }
    return jumpTo(s)
  })
  ipcMain.handle('session:queue', (_e, key: string, text: string) => (sessions.queue(str(key), str(text, 4000)) ? { ok: true } : { ok: false, error: tr('That session is gone.') }))
  ipcMain.handle('session:unqueue', (_e, key: string, index: number) => sessions.unqueue(str(key), Number(index) || 0))
  ipcMain.handle('session:stop', (_e, key: string, force?: boolean) => sessions.requestStop(str(key), force === true))
  ipcMain.handle('git:revert', (_e, cwd: string, p: string) => revertFile(str(cwd), str(p, 4096)))
  ipcMain.handle('history:decisions', () => history.decisions())
  ipcMain.handle('history:clear-decisions', () => history.clearDecisions())
  ipcMain.handle('history:days', () => history.list())
  ipcMain.handle('session:dismiss', (_e, key: string) => sessions.dismiss(str(key)))
  ipcMain.handle('open:folder', (_e, p: string) => openFolder(str(p)))
  ipcMain.handle('open:editor', (_e, p: string, cwd?: string) => openInEditor(str(p), cwd ? str(cwd) : undefined))
  ipcMain.handle('git:info', (_e, cwd: string) => gitInfo(str(cwd)))
  ipcMain.handle('git:diff', (_e, cwd: string, p: string) => gitDiff(str(cwd), str(p)))
  ipcMain.handle('launch', async (_e, req: LaunchRequest) => {
    const r = await launch({ target: req.target, cwd: str(req.cwd), prompt: str(req.prompt, 20_000), contextIds: Array.isArray(req.contextIds) ? req.contextIds.map((x) => str(x)) : [] })
    if (r.ok && req.cwd) {
      const list = settings.get().recentProjects.filter((p) => p !== req.cwd)
      settings.set({ recentProjects: [req.cwd, ...list].slice(0, 12) })
    }
    return r
  })
  ipcMain.handle('pick:folder', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    setFocusable(true)
    const r = await (parent ? dialog.showOpenDialog(parent, { properties: ['openDirectory', 'createDirectory'] }) : dialog.showOpenDialog({ properties: ['openDirectory'] }))
    return r.canceled ? null : r.filePaths[0] || null
  })
  ipcMain.handle('pick:files', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender)
    setFocusable(true)
    const r = await (parent ? dialog.showOpenDialog(parent, { properties: ['openFile', 'multiSelections'] }) : dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }))
    return r.canceled ? [] : context.addPaths(r.filePaths)
  })

  ipcMain.handle('context:add', (_e, paths: string[], chat?: boolean) =>
    context.addPaths(Array.isArray(paths) ? paths.map((p) => str(p, 4096)).filter((p) => p && exists(p)) : [], chat === true),
  )
  ipcMain.handle('context:paste', async (_e, chat?: boolean) => {
    const paths = (await clipboardFiles()).filter((p) => exists(p))
    if (paths.length) return context.addPaths(paths, chat === true)
    const png = await clipboardBytes('image/png')
    if (png?.length) return [context.addImage(png, chat === true)]
    return []
  })
  ipcMain.handle('context:text', (_e, text: string) => context.addText(str(text, 100_000)))
  ipcMain.handle('context:capture', async () => {
    try {
      const w = lastActiveWindow() || (await captureActive())
      return { ok: true, value: await context.captureWindow(w) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('context:remove', (_e, id: string) => context.remove(str(id)))
  ipcMain.handle('context:clear', () => context.clear())
  ipcMain.handle('context:bind', (_e, ids: string[], key: string | null) => {
    if (key && !sessions.get(key)) return { ok: false, error: tr('That session is gone.') }
    context.bind(Array.isArray(ids) ? ids.map((x) => str(x)) : [], key ? str(key) : null)
    sessions.refreshContextCounts()
    return { ok: true }
  })
  ipcMain.handle('clipboard:write', (_e, t: string) => clipboard.writeText(str(t, 1_000_000)))

  ipcMain.handle('chat:providers', () => listProviders())
  ipcMain.handle('chat:models', (_e, p: string) => listModels(str(p)))
  ipcMain.handle('chat:list', () => chat.list())
  ipcMain.handle('chat:get', (_e, id: string) => chat.get(str(id)))
  ipcMain.handle('chat:delete', (_e, id: string) => chat.remove(str(id)))
  ipcMain.handle('chat:send', (_e, req: ChatSendRequest) => {
    const attachments: ChatAttachment[] = Array.isArray(req?.attachments)
      ? req.attachments.slice(0, 12).map((a) => {
          const item = context.get([str(a.id)])[0]
          return {
            id: str(a.id),
            kind: item?.kind || a.kind,
            name: item?.name || str(a.name, 200),
            path: item?.path,
            mime: item?.mime,
            thumb: item?.thumb,
            text: item?.kind === 'text' ? item.snippet : undefined,
          }
        })
      : []
    return chat.send({
      conversationId: req?.conversationId ? str(req.conversationId) : undefined,
      text: str(req?.text, 100_000),
      attachments,
      sessionKey: req?.sessionKey ? str(req.sessionKey) : undefined,
      provider: str(req?.provider),
      model: str(req?.model),
    })
  })
  ipcMain.handle('chat:stop', (_e, id: string) => chat.stop(str(id)))

  ipcMain.handle('integrations', () => integrations.allStatus())
  ipcMain.handle('hooks:preview', (_e, id: HookPreview['integration'], install: boolean) => {
    if (!integrations.validTarget(id)) return { ok: false, error: tr('Unknown integration') }
    try {
      integrations.ensureRelay()
      return { ok: true, value: integrations.preview(id, Boolean(install)) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('mcp:status', () => integrations.mcpStatus())
  ipcMain.handle('ask:answer', (_e, askId: string, text: string | null) => (asks.answer(str(askId), text === null ? null : str(text, 2000)) ? { ok: true } : { ok: false, error: tr('That question is no longer waiting.') }))
  ipcMain.handle('updates:check', () => updater.check())
  ipcMain.handle('updates:install', () => updater.install())
  ipcMain.handle('detect:refresh', () => refreshDetect())
  ipcMain.handle('hooks:apply', (_e, id: HookPreview['integration'], install: boolean, fp: string) => {
    if (!integrations.validTarget(id)) return { ok: false, error: tr('Unknown integration') }
    try {
      const backup = integrations.apply(id, Boolean(install), str(fp))
      pushSnapshot()
      return { ok: true, value: backup }
    } catch (e) {
      log('hooks apply failed', e)
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('secret:set', (_e, name: string, key: string) => {
    try {
      setSecret(`chat.${str(name, 40)}`, str(key, 500))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('secret:has', (_e, name: string) => hasSecret(`chat.${str(name, 40)}`))
  ipcMain.handle('relay:command', (_e, agent: string) => integrations.relayCommand(/^[a-z0-9-]{1,24}$/.test(String(agent)) ? agent : 'my-agent'))

  ipcMain.handle('displays', () => {
    const primary = screen.getPrimaryDisplay().id
    return screen.getAllDisplays().map((d, i) => ({ id: String(d.id), label: d.label || tr('Display {0}', i + 1), primary: d.id === primary }))
  })
  ipcMain.on('app:settings', (_e, section?: SettingsSection) => {
    send({ type: 'collapse' })
    openSettings(section)
  })
  ipcMain.handle('app:external', (_e, url: string) => {
    const u = str(url, 2000)
    if (/^https?:\/\//i.test(u)) return shell.openExternal(u)
  })
  ipcMain.handle('app:data', () => shell.openPath(dataDir()))
  ipcMain.handle('app:clear-history', () => {
    chat.clearAll()
    context.purge()
    history.clearAll()
  })
  ipcMain.on('launcher:hide', () => hideLauncher())
  ipcMain.on('launcher:height', (_e, h: number) => {
    if (typeof h === 'number' && Number.isFinite(h)) setLauncherHeight(h)
  })
  ipcMain.on('app:quit', () => app.quit())
  ipcMain.on('app:test-sound', () => islandWindow()?.webContents.send('island:test-sound'))
}
