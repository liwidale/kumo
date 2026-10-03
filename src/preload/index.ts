import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { KumoApi } from '../shared/api'

const on =
  <T>(channel: string) =>
  (cb: (v: T) => void): (() => void) => {
    const fn = (_e: IpcRendererEvent, v: T): void => cb(v)
    ipcRenderer.on(channel, fn)
    return () => ipcRenderer.removeListener(channel, fn)
  }

const api: KumoApi = {
  platform: process.platform as KumoApi['platform'],
  snapshot: () => ipcRenderer.invoke('snapshot'),
  onSnapshot: on('snapshot'),
  settings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  onSettings: on('settings'),
  theme: () => ipcRenderer.invoke('theme'),
  onTheme: on('theme'),

  display: () => ipcRenderer.invoke('island:display'),
  onDisplay: on('island:display'),
  onPointer: on('island:pointer'),
  onCommand: on('island:command'),
  onAlert: on('island:alert'),
  setHitRect: (r) => ipcRenderer.send('island:hit', r),
  setFocusable: (f) => ipcRenderer.send('island:focusable', f),
  setExpanded: (v) => ipcRenderer.send('island:expanded', v),
  setCompact: (v) => ipcRenderer.send('island:compact', v),
  goodbyeDone: () => ipcRenderer.send('island:goodbye-done'),
  activeWindow: () => ipcRenderer.invoke('island:active-window'),
  returnToWindow: () => ipcRenderer.invoke('island:return'),

  decide: (d) => ipcRenderer.invoke('approval:decide', d),
  jump: (k) => ipcRenderer.invoke('session:jump', k),
  dismiss: (k) => ipcRenderer.invoke('session:dismiss', k),
  openFolder: (p) => ipcRenderer.invoke('open:folder', p),
  openInEditor: (p, cwd) => ipcRenderer.invoke('open:editor', p, cwd),
  git: (cwd) => ipcRenderer.invoke('git:info', cwd),
  gitDiff: (cwd, p) => ipcRenderer.invoke('git:diff', cwd, p),
  launch: (req) => ipcRenderer.invoke('launch', req),
  pickFolder: () => ipcRenderer.invoke('pick:folder'),
  pickFiles: () => ipcRenderer.invoke('pick:files'),

  queueMessage: (k, t) => ipcRenderer.invoke('session:queue', k, t),
  unqueueMessage: (k, i) => ipcRenderer.invoke('session:unqueue', k, i),
  stopSession: (k, f) => ipcRenderer.invoke('session:stop', k, f),
  revertFile: (cwd, p) => ipcRenderer.invoke('git:revert', cwd, p),
  decisions: () => ipcRenderer.invoke('history:decisions'),
  clearDecisions: () => ipcRenderer.invoke('history:clear-decisions'),
  days: () => ipcRenderer.invoke('history:days'),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  addContext: (paths, chat) => ipcRenderer.invoke('context:add', paths, chat),
  pasteContext: (chat) => ipcRenderer.invoke('context:paste', chat),
  addText: (t) => ipcRenderer.invoke('context:text', t),
  captureWindow: () => ipcRenderer.invoke('context:capture'),
  removeContext: (id) => ipcRenderer.invoke('context:remove', id),
  clearContext: () => ipcRenderer.invoke('context:clear'),
  bindContext: (ids, key) => ipcRenderer.invoke('context:bind', ids, key),
  copyText: (t) => ipcRenderer.invoke('clipboard:write', t),

  providers: () => ipcRenderer.invoke('chat:providers'),
  models: (p) => ipcRenderer.invoke('chat:models', p),
  conversations: () => ipcRenderer.invoke('chat:list'),
  conversation: (id) => ipcRenderer.invoke('chat:get', id),
  deleteConversation: (id) => ipcRenderer.invoke('chat:delete', id),
  send: (req) => ipcRenderer.invoke('chat:send', req),
  stop: (id) => ipcRenderer.invoke('chat:stop', id),
  onChat: on('chat'),

  integrations: () => ipcRenderer.invoke('integrations'),
  previewHooks: (id, install) => ipcRenderer.invoke('hooks:preview', id, install),
  applyHooks: (id, install, fp) => ipcRenderer.invoke('hooks:apply', id, install, fp),
  setSecret: (p, k) => ipcRenderer.invoke('secret:set', p, k),
  hasSecret: (p) => ipcRenderer.invoke('secret:has', p),
  relayCommand: (a) => ipcRenderer.invoke('relay:command', a),

  displays: () => ipcRenderer.invoke('displays'),
  openSettings: (s) => ipcRenderer.send('app:settings', s),
  onSection: on('settings:section'),
  openExternal: (u) => ipcRenderer.invoke('app:external', u),
  openDataFolder: () => ipcRenderer.invoke('app:data'),
  clearHistory: () => ipcRenderer.invoke('app:clear-history'),
  quit: () => ipcRenderer.send('app:quit'),
  playTestSound: () => ipcRenderer.send('app:test-sound'),
}

contextBridge.exposeInMainWorld('kumo', api)
ipcRenderer.on('island:test-sound', () => window.dispatchEvent(new Event('kumo:test-sound')))
