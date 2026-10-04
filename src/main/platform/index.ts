import { clipboard, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { ActiveWindow, LaunchRequest, Result, Session } from '../../shared/types'
import { context, describeForAgent } from '../context'
import { antigravityExe, cursorExe, detectInstalled, editorApp, macApp, windsurfExe } from '../detect'
import { settings } from '../settings'
import { exists, isMac, isWin, log, which } from '../util'
import * as mac from './darwin'
import * as win from './win32'
import { tr } from '../i18n'


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
  if (!w) return { ok: false, error: tr('Nothing to go back to.') }
  if (isWin && w.handle && win.focusHandle(w.handle)) return { ok: true }
  if (isWin && win.focusPids([w.pid])) return { ok: true }
  if (isMac && w.handle && (await mac.activateBundle(w.handle))) return { ok: true }
  if (isMac && (await mac.activateApp(w.app))) return { ok: true }
  return { ok: false, error: tr('{0} is no longer open.', w.app) }
}

export async function jumpTo(s: Session): Promise<Result> {
  const app = s.host.app
  try {
    if (isWin) {
      if (win.focusPids(s.host.pids)) return { ok: true }
      if (s.host.kind === 'desktop' && app === 'Claude' && win.focusApp(/^claude\.exe$/i)) return { ok: true }
      if (app === 'Antigravity' && win.focusApp(/^antigravity\.exe$/i)) return { ok: true }
      if (app === 'Cursor' && win.focusApp(/^cursor\.exe$/i)) return { ok: true }
      if (app === 'Windsurf' && win.focusApp(/^windsurf\.exe$/i)) return { ok: true }
    } else if (isMac) {
      if (await mac.focusHost(s.host, s.cwd)) return { ok: true }
    }
  } catch (e) {
    log('jump failed', e)
  }
  if (!s.alive) return { ok: false, error: tr('{0} for this session isn\'t open anymore.', app) }
  if (s.cwd && exists(s.cwd)) {
    const r = await openInEditor(s.cwd)
    if (r.ok) return { ok: true, error: tr('Couldn\'t find the {0} window, opened the project instead.', app) }
  }
  return { ok: false, error: tr('Couldn\'t bring {0} forward.', app) }
}

export async function openFolder(p: string): Promise<Result> {
  if (!p || !exists(p)) return { ok: false, error: tr('That folder no longer exists.') }
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

function openApp(args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/open', args, { stdio: 'ignore' })
    child.once('exit', (c) => resolve(c === 0))
    child.once('error', () => resolve(false))
  })
}

export async function openInEditor(target: string, cwd?: string): Promise<Result> {
  const full = cwd && !path.isAbsolute(target) ? path.join(cwd, target) : target
  if (!exists(full)) return { ok: false, error: tr('That file no longer exists.') }
  const pref = settings.get().editor
  const order = pref !== 'auto' && pref !== 'system' ? [pref] : pref === 'system' ? [] : ['code', 'cursor', 'zed', 'windsurf', 'antigravity']
  for (const ed of order) {
    const bin = which(ed)
    const app = bin ? null : editorApp(ed)
    if (app && (await openApp(['-a', app, full]))) return { ok: true }
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
    const shell = process.env.SHELL || '/bin/zsh'
    const line = `cd ${sq(cwd)} && ${argv.map(sq).join(' ')}`
    const ghostty = pref === 'Ghostty' ? macApp('Ghostty') : null
    if (ghostty) {
      const command = argv.map(sq).join(' ')
      if (await mac.ghosttyWindow(cwd, command)) return true
      return openApp(['-na', ghostty, '--args', `--working-directory=${cwd}`, `--input=raw:${command.replace(/\\/g, '\\\\')}\\n`])
    }
    const app = pref === 'iTerm' && macApp('iTerm') ? 'iTerm' : 'Terminal'
    const script =
      app === 'iTerm'
        ? `tell application "iTerm"\nactivate\ncreate window with default profile command ${JSON.stringify(`${shell} -lc ${sq(`${line}; exec ${sq(shell)} -l`)}`)}\nend tell`
        : `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(line)}\nend tell`
    return detached('/usr/bin/osascript', ['-e', script])
  }
  return detached('x-terminal-emulator', ['-e', ...argv], cwd)
}

const CLIS: Record<'copilot-cli' | 'qwen-cli' | 'opencode-cli' | 'kiro-cli' | 'amp-cli' | 'aider-cli', { name: string; bin: string; installed: 'copilotCli' | 'qwenCli' | 'opencodeCli' | 'kiroCli' | 'ampCli' | 'aiderCli'; base?: string[]; prompt?: (p: string) => string[] }> = {
  'copilot-cli': { name: 'Copilot CLI', bin: 'copilot', installed: 'copilotCli', prompt: (p) => ['-i', p] },
  'qwen-cli': { name: 'Qwen Code', bin: 'qwen', installed: 'qwenCli', prompt: (p) => ['-i', p] },
  'opencode-cli': { name: 'OpenCode', bin: 'opencode', installed: 'opencodeCli', prompt: (p) => ['--prompt', p] },
  'kiro-cli': { name: 'Kiro CLI', bin: 'kiro-cli', installed: 'kiroCli', base: ['chat'], prompt: (p) => ['chat', p] },
  'amp-cli': { name: 'Amp', bin: 'amp', installed: 'ampCli' },
  'aider-cli': { name: 'Aider', bin: 'aider', installed: 'aiderCli' },
}

export async function launch(req: LaunchRequest): Promise<Result<string>> {
  if (!req.cwd || !exists(req.cwd)) return { ok: false, error: tr('Pick a project folder first.') }
  const prompt = promptWithContext(req)
  const inst = detectInstalled()
  switch (req.target) {
    case 'claude-cli': {
      if (!inst.claudeCli) return { ok: false, error: tr('Claude Code CLI was not found on PATH.') }
      const ok = await inTerminal(req.cwd, prompt ? ['claude', prompt] : ['claude'])
      return ok ? { ok: true, value: tr('Started Claude Code in a new terminal.') } : { ok: false, error: tr('Could not open a terminal.') }
    }
    case 'agy-cli': {
      if (!inst.agyCli) return { ok: false, error: tr('Antigravity CLI (agy) was not found on PATH.') }
      if (prompt) clipboard.writeText(prompt)
      const ok = await inTerminal(req.cwd, ['agy'])
      return ok ? { ok: true, value: prompt ? tr('Started agy - your prompt is on the clipboard.') : tr('Started agy.') } : { ok: false, error: tr('Could not open a terminal.') }
    }
    case 'claude-desktop': {
      if (prompt) clipboard.writeText(prompt)
      let ok = false
      if (isMac) ok = await mac.activateApp('Claude')
      else if (isWin) ok = win.focusApp(/^claude\.exe$/i) || (await detached('explorer.exe', ['shell:AppsFolder\\Claude_pzs8sxrjxfjjc!Claude']))
      return ok ? { ok: true, value: prompt ? tr('Claude is open - paste your prompt (it’s on the clipboard).') : tr('Claude is open.') } : { ok: false, error: tr('Claude Desktop could not be opened.') }
    }
    case 'codex-cli': {
      if (!inst.codexCli) return { ok: false, error: tr('Codex CLI was not found on PATH.') }
      const ok = await inTerminal(req.cwd, prompt ? ['codex', prompt] : ['codex'])
      return ok ? { ok: true, value: tr('Started Codex in a new terminal.') } : { ok: false, error: tr('Could not open a terminal.') }
    }
    case 'gemini-cli': {
      if (!inst.geminiCli) return { ok: false, error: tr('Gemini CLI was not found on PATH.') }
      const ok = await inTerminal(req.cwd, prompt ? ['gemini', '-i', prompt] : ['gemini'])
      return ok ? { ok: true, value: tr('Started Gemini CLI in a new terminal.') } : { ok: false, error: tr('Could not open a terminal.') }
    }
    case 'cursor': {
      if (prompt) clipboard.writeText(prompt)
      const exe = cursorExe()
      let ok = false
      if (isMac) ok = await openApp(['-a', exe || 'Cursor', req.cwd])
      else if (exe) ok = await detached(exe, [req.cwd])
      return ok ? { ok: true, value: prompt ? tr('Cursor is opening the project - your prompt is on the clipboard.') : tr('Cursor is opening the project.') } : { ok: false, error: tr('Cursor could not be opened.') }
    }
    case 'windsurf': {
      if (prompt) clipboard.writeText(prompt)
      const exe = windsurfExe()
      let ok = false
      if (isMac) ok = await openApp(['-a', exe || 'Windsurf', req.cwd])
      else if (exe) ok = await detached(exe, [req.cwd])
      return ok ? { ok: true, value: prompt ? tr('Windsurf is opening the project - your prompt is on the clipboard.') : tr('Windsurf is opening the project.') } : { ok: false, error: tr('Windsurf could not be opened.') }
    }
    case 'copilot-cli':
    case 'qwen-cli':
    case 'opencode-cli':
    case 'kiro-cli':
    case 'amp-cli':
    case 'aider-cli': {
      const cli = CLIS[req.target]
      if (!inst[cli.installed]) return { ok: false, error: tr('{0} was not found on PATH.', cli.name) }
      const argv = prompt && cli.prompt ? [cli.bin, ...cli.prompt(prompt)] : [cli.bin, ...(cli.base || [])]
      if (prompt && !cli.prompt) clipboard.writeText(prompt)
      const ok = await inTerminal(req.cwd, argv)
      if (!ok) return { ok: false, error: tr('Could not open a terminal.') }
      return { ok: true, value: prompt && !cli.prompt ? tr('Started {0} - your prompt is on the clipboard.', cli.name) : tr('Started {0} in a new terminal.', cli.name) }
    }
    case 'antigravity-desktop': {
      if (prompt) clipboard.writeText(prompt)
      const exe = antigravityExe()
      let ok = false
      if (isMac) ok = await openApp(['-a', exe || 'Antigravity', req.cwd])
      else if (exe) ok = await detached(exe, [req.cwd])
      return ok ? { ok: true, value: prompt ? tr('Antigravity is opening the project - your prompt is on the clipboard.') : tr('Antigravity is opening the project.') } : { ok: false, error: tr('Antigravity could not be opened.') }
    }
  }
  return { ok: false, error: tr('Unknown target.') }
}

export function isFullscreenInFront(physical: { x: number; y: number; width: number; height: number }): boolean {
  if (!isWin) return false
  try {
    return win.foregroundFullscreen(process.pid, physical)
  } catch {
    return false
  }
}
