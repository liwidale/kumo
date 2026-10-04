import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { InstalledAgents } from '../shared/types'
import { exists, isMac, isWin, log, refreshBinIndex, which } from './util'


let cache: { at: number; value: InstalledAgents } | null = null
let refreshing: Promise<InstalledAgents> | null = null
const STALE_MS = 60_000

export const detectEvents = new EventEmitter()

const listings = new Map<string, string[]>()

const listing = (dir: string): string[] => {
  const cached = listings.get(dir)
  if (cached) return cached
  try {
    const names = fs.readdirSync(dir)
    listings.set(dir, names)
    return names
  } catch {
    listings.set(dir, [])
    return []
  }
}

async function preload(dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((d) => fs.promises.readdir(d).then((n) => listings.set(d, n), () => listings.set(d, []))))
}

export function macApp(name: string): string | null {
  for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    const p = path.join(dir, `${name}.app`)
    if (exists(p)) return p
  }
  return null
}

const EDITOR_APPS: Record<string, string> = { code: 'Visual Studio Code', cursor: 'Cursor', zed: 'Zed', windsurf: 'Windsurf', antigravity: 'Antigravity' }

export function editorApp(ed: string): string | null {
  return isMac && EDITOR_APPS[ed] ? macApp(EDITOR_APPS[ed]) : null
}

function claudeDesktop(): boolean {
  if (isMac) return Boolean(macApp('Claude'))
  if (isWin) {
    const local = process.env.LOCALAPPDATA || ''
    if (exists(path.join(local, 'AnthropicClaude'))) return true
    return listing(path.join(local, 'Packages')).some((d) => /^Claude_/i.test(d))
  }
  return false
}

export function antigravityExe(): string | null {
  if (isMac) return macApp('Antigravity')
  if (isWin) {
    const p = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'Antigravity.exe')
    return exists(p) ? p : null
  }
  return which('antigravity')
}

export function cursorExe(): string | null {
  if (isMac) return macApp('Cursor')
  if (isWin) {
    const p = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe')
    if (exists(p)) return p
  }
  return which('cursor')
}

export function windsurfExe(): string | null {
  if (isMac) return macApp('Windsurf')
  if (isWin) {
    const p = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Windsurf', 'Windsurf.exe')
    if (exists(p)) return p
  }
  return which('windsurf')
}

const EXTENSION_DIRS = ['.vscode', '.vscode-insiders', '.cursor', '.windsurf', '.antigravity'].map((d) => path.join(os.homedir(), d, 'extensions'))

function hasExtension(prefix: string): boolean {
  return EXTENSION_DIRS.some((dir) => listing(dir).some((d) => d.toLowerCase().startsWith(prefix)))
}

export function detectInstalled(): InstalledAgents {
  if (!cache) cache = { at: Date.now(), value: compute() }
  else if (Date.now() - cache.at > STALE_MS) void refreshDetect()
  return cache.value
}

export function refreshDetect(): Promise<InstalledAgents> {
  if (refreshing) return refreshing
  const dirs = [...EXTENSION_DIRS, ...(isWin ? [path.join(process.env.LOCALAPPDATA || '', 'Packages')] : [])]
  refreshing = Promise.all([refreshBinIndex(), preload(dirs)])
    .then(() => {
      const prev = cache ? JSON.stringify(cache.value) : ''
      cache = { at: Date.now(), value: compute() }
      if (JSON.stringify(cache.value) !== prev) detectEvents.emit('change')
      return cache.value
    })
    .catch((e) => {
      log('agent detection failed', e)
      return cache?.value ?? compute()
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

function compute(): InstalledAgents {
  const editors = ['code', 'cursor', 'zed', 'windsurf', 'antigravity'].filter((e) => which(e) || editorApp(e))
  const terminals = isWin ? ['wt'].filter((t) => which(t)) : isMac ? ['Terminal', ...['iTerm', 'Ghostty'].filter((t) => macApp(t))] : []
  const value: InstalledAgents = {
    claudeCli: Boolean(which('claude')),
    claudeDesktop: claudeDesktop(),
    agyCli: Boolean(which('agy')),
    antigravityDesktop: Boolean(antigravityExe()),
    codexCli: Boolean(which('codex')),
    geminiCli: Boolean(which('gemini')),
    cursorApp: Boolean(cursorExe()),
    copilotCli: Boolean(which('copilot')),
    qwenCli: Boolean(which('qwen')),
    windsurfApp: Boolean(windsurfExe()),
    kiroCli: Boolean(which('kiro-cli')),
    opencodeCli: Boolean(which('opencode')),
    ampCli: Boolean(which('amp')),
    clineCli: Boolean(which('cline')),
    clineExt: hasExtension('saoudrizwan.claude-dev-'),
    rooExt: hasExtension('rooveterinaryinc.roo-cline-'),
    aiderCli: Boolean(which('aider')),
    editors,
    terminals,
  }
  return value
}

export function invalidateDetect(): void {
  void refreshDetect()
}
