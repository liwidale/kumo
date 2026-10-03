import { clipboard, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ActiveWindow, LaunchRequest, Result, Session } from '../../shared/types'
import { context, describeForAgent } from '../context'
import { antigravityExe, cursorExe, detectInstalled } from '../detect'
import { settings } from '../settings'
import { exists, isMac, isWin, log, which } from '../util'
import * as mac from './darwin'
import * as win from './win32'


let lastActive: ActiveWindow | null = null

export async function captureActive(): Promise<ActiveWindow | null> {
  if (!settings.get().privacy.windowContext) return null
  try {
    const w = isWin ? win.foregroundWindow(process.pid) : isMac ? await mac.frontmostApp(process.pid) : null
    if (w) lastActive = w
    if (settings.get().debug) log('active window:', w ? w.app : 'none (Kumo itself or desktop)')
    return w
  } catch (e) {
    log('active window failed', e)
    return null
  }
}

export function lastActiveWindow(): ActiveWindow | null {
  return settings.get().privacy.windowContext ? lastActive : null
}

export async function returnTo(w: ActiveWindow | null): Promise<Result> {
  if (!w) return { ok: false, error: 'Nothing to go back to.' }
  if (isWin && w.handle && win.focusHandle(w.handle)) return { ok: true }
  if (isWin && win.focusPids([w.pid])) return { ok: true }
  if (isMac && w.handle && (await mac.activateBundle(w.handle))) return { ok: true }
  if (isMac && (await mac.activateApp(w.app))) return { ok: true }
  return { ok: false, error: `${w.app} is no longer open.` }
}

export async function jumpTo(s: Session): Promise<Result> {
  const app = s.host.app
  try {
    if (isWin) {
      if (win.focusPids(s.host.pids)) return { ok: true }
      if (s.host.kind === 'desktop' && app === 'Claude' && win.focusApp(/^claude\.exe$/i)) return { ok: true }
      if (app === 'Antigravity' && win.focusApp(/^antigravity\.exe$/i)) return { ok: true }
      if (app === 'Cursor' && win.focusApp(/^cursor\.exe$/i)) return { ok: true }
    } else if (isMac) {
      if (await mac.focusHost(s.host)) return { ok: true }
    }
  } catch (e) {
    log('jump failed', e)
  }
  if (!s.alive) return { ok: false, error: `${app} for this session isn't open anymore.` }
  if (s.cwd && exists(s.cwd)) {
    const r = await openInEditor(s.cwd)
    if (r.ok) return { ok: true, error: `Couldn't find the ${app} window, opened the project instead.` }
  }
  return { ok: false, error: `Couldn't bring ${app} forward.` }
}

export async function openFolder(p: string): Promise<Result> {
  if (!p || !exists(p)) return { ok: false, error: 'That folder no longer exists.' }
  const err = await shell.openPath(p)
  return err ? { ok: false, error: err } : { ok: true }
}

function detached(cmd: string, args: string[], cwd?: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false, shell: false })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

export async function openInEditor(target: string, cwd?: string): Promise<Result> {
  const full = cwd && !path.isAbsolute(target) ? path.join(cwd, target) : target
  if (!exists(full)) return { ok: false, error: 'That file no longer exists.' }
  const pref = settings.get().editor
  const order = pref !== 'auto' && pref !== 'system' ? [pref] : pref === 'system' ? [] : ['code', 'cursor', 'zed', 'windsurf', 'antigravity']
  for (const ed of order) {
    const bin = which(ed)
    if (!bin) continue
    const isDir = fs.statSync(full).isDirectory()
    const args = isDir ? [full] : ed === 'zed' ? [full] : ['-g', full]
    const ok = isWin && /\.(cmd|bat)$/i.test(bin) ? await detached('cmd.exe', ['/c', bin, ...args]) : await detached(bin, args)
    if (ok) return { ok: true }
  }
  const err = await shell.openPath(full)
  return err ? { ok: false, error: err } : { ok: true }
}

const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`
const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

function promptWithContext(req: LaunchRequest): string {
  const items = context.get(req.contextIds)
  if (!items.length) return req.prompt.trim()
  const refs = items.filter((i) => i.path).map((i) => `@${i.path && req.cwd && i.path.startsWith(req.cwd) ? path.relative(req.cwd, i.path) : i.path}`)
  const snippets = items.filter((i) => i.kind === 'text')
  const head = req.prompt.trim()
  return [head, refs.join(' '), snippets.length ? describeForAgent(snippets) : ''].filter(Boolean).join('\n\n')
}

async function inTerminal(cwd: string, argv: string[]): Promise<boolean> {
  const pref = settings.get().terminal
  if (isWin) {
    const wt = which('wt')
    if (wt && (pref === 'auto' || pref === 'wt')) return detached(wt, ['-d', cwd, ...argv.map((a) => a.replace(/;/g, '\\;'))])
    const line = argv.map((a) => (/[\s"&|<>^]/.test(a) ? q(a) : a)).join(' ')
    return detached('cmd.exe', ['/c', 'start', '""', '/D', cwd, 'cmd.exe', '/k', line])
  }
  if (isMac) {
    const line = `cd ${sq(cwd)} && ${argv.map(sq).join(' ')}`
    const app = pref === 'iTerm' && exists('/Applications/iTerm.app') ? 'iTerm' : 'Terminal'
    const script =
      app === 'iTerm'
        ? `tell application "iTerm"\nactivate\ncreate window with default profile command ${JSON.stringify(`/bin/zsh -lc ${sq(line + '; exec zsh -l')}`)}\nend tell`
        : `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(line)}\nend tell`
    return detached('/usr/bin/osascript', ['-e', script])
  }
  return detached('x-terminal-emulator', ['-e', ...argv], cwd)
}

export async function launch(req: LaunchRequest): Promise<Result<string>> {
  if (!req.cwd || !exists(req.cwd)) return { ok: false, error: 'Pick a project folder first.' }
  const prompt = promptWithContext(req)
  const inst = detectInstalled()
  switch (req.target) {
    case 'claude-cli': {
      if (!inst.claudeCli) return { ok: false, error: 'Claude Code CLI was not found on PATH.' }
      const ok = await inTerminal(req.cwd, prompt ? ['claude', prompt] : ['claude'])
      return ok ? { ok: true, value: 'Started Claude Code in a new terminal.' } : { ok: false, error: 'Could not open a terminal.' }
    }
    case 'agy-cli': {
      if (!inst.agyCli) return { ok: false, error: 'Antigravity CLI (agy) was not found on PATH.' }
      if (prompt) clipboard.writeText(prompt)
      const ok = await inTerminal(req.cwd, ['agy'])
      return ok ? { ok: true, value: prompt ? 'Started agy - your prompt is on the clipboard.' : 'Started agy.' } : { ok: false, error: 'Could not open a terminal.' }
    }
    case 'claude-desktop': {
      if (prompt) clipboard.writeText(prompt)
      let ok = false
      if (isMac) ok = await mac.activateApp('Claude')
      else if (isWin) ok = win.focusApp(/^claude\.exe$/i) || (await detached('explorer.exe', ['shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude']))
      return ok ? { ok: true, value: prompt ? 'Claude is open - paste your prompt (it’s on the clipboard).' : 'Claude is open.' } : { ok: false, error: 'Claude Desktop could not be opened.' }
    }
    case 'codex-cli': {
      if (!inst.codexCli) return { ok: false, error: 'Codex CLI was not found on PATH.' }
      const ok = await inTerminal(req.cwd, prompt ? ['codex', prompt] : ['codex'])
      return ok ? { ok: true, value: 'Started Codex in a new terminal.' } : { ok: false, error: 'Could not open a terminal.' }
    }
    case 'gemini-cli': {
      if (!inst.geminiCli) return { ok: false, error: 'Gemini CLI was not found on PATH.' }
      const ok = await inTerminal(req.cwd, prompt ? ['gemini', '-i', prompt] : ['gemini'])
      return ok ? { ok: true, value: 'Started Gemini CLI in a new terminal.' } : { ok: false, error: 'Could not open a terminal.' }
    }
    case 'cursor': {
      if (prompt) clipboard.writeText(prompt)
      const exe = cursorExe()
      let ok = false
      if (isMac) ok = await new Promise<boolean>((r) => spawn('/usr/bin/open', ['-a', 'Cursor', req.cwd]).once('exit', (c) => r(c === 0)).once('error', () => r(false)))
      else if (exe) ok = await detached(exe, [req.cwd])
      return ok ? { ok: true, value: prompt ? 'Cursor is opening the project - your prompt is on the clipboard.' : 'Cursor is opening the project.' } : { ok: false, error: 'Cursor could not be opened.' }
    }
    case 'antigravity-desktop': {
      if (prompt) clipboard.writeText(prompt)
      const exe = antigravityExe()
      let ok = false
      if (isMac) ok = await new Promise<boolean>((r) => spawn('/usr/bin/open', ['-a', 'Antigravity', req.cwd]).once('exit', (c) => r(c === 0)).once('error', () => r(false)))
      else if (exe) ok = await detached(exe, [req.cwd])
      return ok ? { ok: true, value: prompt ? 'Antigravity is opening the project - your prompt is on the clipboard.' : 'Antigravity is opening the project.' } : { ok: false, error: 'Antigravity could not be opened.' }
    }
  }
  return { ok: false, error: 'Unknown target.' }
}

export function isFullscreenInFront(physical: { x: number; y: number; width: number; height: number }): boolean {
  if (!isWin) return false
  try {
    return win.foregroundFullscreen(process.pid, physical)
  } catch {
    return false
  }
}
