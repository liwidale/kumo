import { app, shell } from 'electron'
import { EventEmitter } from 'node:events'
import type { UpdateState } from '../shared/types'
import { settings } from './settings'
import { isWin, log } from './util'

const REPO = 'liwidale/kumo'
const EVERY = 6 * 60 * 60_000
const FIRST = 20_000

type AutoUpdater = import('electron-updater').AppUpdater

const newer = (a: string, b: string): boolean => {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number(x) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number(x) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

class Updater extends EventEmitter {
  state: UpdateState = { status: 'unsupported' }
  private au: AutoUpdater | null = null
  private timer: NodeJS.Timeout | null = null

  private set(next: UpdateState): void {
    this.state = next
    this.emit('change', next)
  }

  start(): void {
    if (!app.isPackaged) return
    this.set({ status: 'idle' })
    if (isWin) {
      try {
        const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
        this.au = autoUpdater
        autoUpdater.autoDownload = settings.get().updates.auto
        autoUpdater.autoInstallOnAppQuit = true
        autoUpdater.logger = null
        autoUpdater.on('checking-for-update', () => this.set({ ...this.state, status: 'checking', error: undefined }))
        autoUpdater.on('update-available', (i) => this.set({ status: autoUpdater.autoDownload ? 'downloading' : 'available', version: i.version, progress: 0, checkedAt: Date.now() }))
        autoUpdater.on('update-not-available', () => this.set({ status: 'latest', checkedAt: Date.now() }))
        autoUpdater.on('download-progress', (p) => this.set({ ...this.state, status: 'downloading', progress: Math.round(p.percent) }))
        autoUpdater.on('update-downloaded', (i) => this.set({ status: 'ready', version: i.version, checkedAt: Date.now() }))
        autoUpdater.on('error', (e) => {
          log('update failed', e)
          this.set({ ...this.state, status: 'error', error: (e as Error).message?.split('\n')[0] || 'Update failed' })
        })
      } catch (e) {
        log('updater unavailable', e)
        this.au = null
      }
    }
    setTimeout(() => this.auto(), FIRST)
    this.timer = setInterval(() => this.auto(), EVERY)
  }

  private auto(): void {
    if (settings.get().updates.auto && this.state.status !== 'ready' && this.state.status !== 'downloading') void this.check()
  }

  async check(): Promise<UpdateState> {
    if (this.state.status === 'unsupported') return this.state
    if (this.au) {
      this.au.autoDownload = settings.get().updates.auto
      try {
        await this.au.checkForUpdates()
      } catch (e) {
        this.set({ ...this.state, status: 'error', error: (e as Error).message?.split('\n')[0] || 'Update check failed' })
      }
      return this.state
    }
    this.set({ ...this.state, status: 'checking', error: undefined })
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Kumo' }, signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
      const tag = String(((await res.json()) as { tag_name?: string }).tag_name || '')
      const version = tag.replace(/^v/, '')
      if (version && newer(version, app.getVersion())) this.set({ status: 'available', version, manual: true, checkedAt: Date.now() })
      else this.set({ status: 'latest', checkedAt: Date.now() })
    } catch (e) {
      log('update check failed', e)
      this.set({ ...this.state, status: 'error', error: (e as Error).message || 'Update check failed' })
    }
    return this.state
  }

  async install(): Promise<void> {
    const s = this.state
    if (this.au && s.status === 'available') {
      this.set({ ...s, status: 'downloading', progress: 0 })
      try {
        await this.au.downloadUpdate()
      } catch (e) {
        this.set({ ...s, status: 'error', error: (e as Error).message?.split('\n')[0] || 'Download failed' })
      }
      return
    }
    if (this.au && s.status === 'ready') {
      setImmediate(() => this.au?.quitAndInstall(true, true))
      return
    }
    if (s.version) await shell.openExternal(`https://github.com/${REPO}/releases/tag/v${s.version}`)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

export const updater = new Updater()
