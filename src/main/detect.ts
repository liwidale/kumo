import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { InstalledAgents } from '../shared/types'
import { exists, isMac, isWin, which } from './util'


let cache: { at: number; value: InstalledAgents } | null = null

function claudeDesktop(): boolean {
  if (isMac) return exists('/Applications/Claude.app') || exists(path.join(os.homedir(), 'Applications', 'Claude.app'))
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
  if (isMac) {
    for (const p of ['/Applications/Antigravity.app', path.join(os.homedir(), 'Applications', 'Antigravity.app')]) if (exists(p)) return p
    return null
  }
  if (isWin) {
    const p = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'Antigravity.exe')
    return exists(p) ? p : null
  }
  return which('antigravity')
}

export function cursorExe(): string | null {
  if (isMac) {
    for (const p of ['/Applications/Cursor.app', path.join(os.homedir(), 'Applications', 'Cursor.app')]) if (exists(p)) return p
    return null
  }
  if (isWin) {
    const p = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe')
    if (exists(p)) return p
  }
  return which('cursor')
}

export function detectInstalled(): InstalledAgents {
  if (cache && Date.now() - cache.at < 30_000) return cache.value
  const editors = ['code', 'cursor', 'zed', 'windsurf', 'antigravity'].filter((e) => which(e))
  const terminals = isWin ? ['wt'].filter((t) => which(t)) : isMac ? ['Terminal', ...(exists('/Applications/iTerm.app') ? ['iTerm'] : []), ...(exists('/Applications/Ghostty.app') ? ['Ghostty'] : [])] : []
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
