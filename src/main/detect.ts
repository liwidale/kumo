import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { InstalledAgents } from '../shared/types'
import { exists, isMac, isWin, which } from './util'


let cache: { at: number; value: InstalledAgents } | null = null

export function macApp(name: string): string | null {
  for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    const p = path.join(dir, `${name}.app`)
    if (exists(p)) return p
  }
  return null
}

const EDITOR_APPS: Record<string, string> = { code: 'Visual Studio Code', cursor: 'Cursor', zed: 'Zed', windsurf: 'Windsurf', antigravity: 'Antigravity' }

/** On macOS an editor counts as installed with or without its shell command. */
export function editorApp(ed: string): string | null {
  return isMac && EDITOR_APPS[ed] ? macApp(EDITOR_APPS[ed]) : null
}

function claudeDesktop(): boolean {
  if (isMac) return Boolean(macApp('Claude'))
  if (isWin) {
    const local = process.env.LOCALAPPDATA || ''
    if (exists(path.join(local, 'AnthropicClaude'))) return true
    try {
      return fs.readdirSync(path.join(local, 'Packages')).some((d) => /^Claude_/i.test(d))
    } catch {
      return false
    }
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

export function detectInstalled(): InstalledAgents {
  if (cache && Date.now() - cache.at < 30_000) return cache.value
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
    editors,
    terminals,
  }
  cache = { at: Date.now(), value }
  return value
}

export function invalidateDetect(): void {
  cache = null
}
