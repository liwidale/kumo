import { EventEmitter } from 'node:events'
import type { Settings } from '../shared/types'
import { dataDir, debounce, isMac, readJson, writeJson } from './util'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  motion: 'full',
  sounds: true,
  volume: 0.5,
  display: 'auto',
  idle: 'character',
  presence: 'island',
  showCompletion: true,
  autoCollapseSec: 30,
  awayMinutes: 5,
  hotkey: isMac ? 'Command+Alt+K' : 'Control+Alt+K',
  launchAtLogin: false,
  paused: false,
  approvals: {
    enabled: true,
    timeoutSec: 110,
    rules: [],
    antigravity: true,
    gemini: false,
    cursor: false,
    globalKeys: true,
    notify: false,
  },
  chat: {
    provider: '',
    model: '',
    includeContext: true,
    ollamaUrl: 'http://127.0.0.1:11434',
    lmstudioUrl: 'http://127.0.0.1:1234',
    customUrl: '',
    customName: 'Custom',
  },
  privacy: {
    keepChats: true,
    historyDays: 14,
    windowContext: true,
  },
  terminal: 'auto',
  editor: 'auto',
  aliases: {},
  recentProjects: [],
  onboarded: false,
  debug: false,
  settingsVersion: 2,
}

const file = (): string => dataDir('settings.json')

function merge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return base
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const b = out[k]
    if (b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v) && k !== 'aliases') {
      out[k] = merge(b, v)
    } else if (v !== undefined) {
      out[k] = v
    }
  }
  return out as T
}

class SettingsStore extends EventEmitter {
  private value: Settings = DEFAULT_SETTINGS
  private save = debounce(() => writeJson(file(), this.value), 250)

  load(): void {
    const stored = readJson<Partial<Settings>>(file(), {})
    this.value = merge(DEFAULT_SETTINGS, stored)
    if ((stored.settingsVersion ?? 1) < 2) {
      this.value = { ...this.value, approvals: { ...this.value.approvals, antigravity: true }, settingsVersion: 2 }
      this.save()
    }
  }

  get(): Settings {
    return this.value
  }

  set(patch: Partial<Settings>): Settings {
    const prev = this.value
    this.value = merge(prev, patch)
    this.save()
    this.emit('change', this.value, prev)
    return this.value
  }

  flush(): void {
    this.save.flush()
  }
}

export const settings = new SettingsStore()
