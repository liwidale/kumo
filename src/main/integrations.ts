import { app } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HookPreview, InstalledAgents, IntegrationId, IntegrationStatus } from '../shared/types'
import { detectInstalled } from './detect'
import { sessions } from './sessions'
import { ensureDir, isWin, kumoHome, log, stamp } from './util'


type Id = IntegrationId
const MARKER = 'kumo-hook'

export const relayPath = (): string => kumoHome('bin', isWin ? 'kumo-hook.exe' : 'kumo-hook')

function relayCommandPath(): string {
  const p = relayPath().replace(/\\/g, '/')
  return /\s/.test(p) ? `"${p}"` : p
}

export function relayCommand(agent: string, event = '<Event>'): string {
  return `${relayCommandPath()} --agent ${agent} ${event}`
}

interface HookEvent {
  name: string
  timeout: number
  matcher?: string
}

const CLAUDE_EVENTS: HookEvent[] = [
  { name: 'SessionStart', timeout: 10 },
  { name: 'SessionEnd', timeout: 10 },
  { name: 'UserPromptSubmit', timeout: 10 },
  { name: 'PreToolUse', timeout: 10 },
  { name: 'PostToolUse', timeout: 10 },
  { name: 'PostToolUseFailure', timeout: 10 },
  { name: 'PermissionRequest', timeout: 600 },
  { name: 'Notification', timeout: 10 },
  { name: 'Stop', timeout: 10 },
  { name: 'StopFailure', timeout: 10 },
  { name: 'SubagentStart', timeout: 10 },
  { name: 'SubagentStop', timeout: 10 },
]

const CODEX_EVENTS: HookEvent[] = [
  { name: 'SessionStart', timeout: 10 },
  { name: 'SessionEnd', timeout: 10 },
  { name: 'UserPromptSubmit', timeout: 10 },
  { name: 'PreToolUse', timeout: 10 },
  { name: 'PostToolUse', timeout: 10 },
  { name: 'PermissionRequest', timeout: 600 },
  { name: 'Stop', timeout: 10 },
  { name: 'SubagentStart', timeout: 10 },
  { name: 'SubagentStop', timeout: 10 },
]

const GEMINI_EVENTS: HookEvent[] = [
  { name: 'SessionStart', timeout: 10_000 },
  { name: 'SessionEnd', timeout: 10_000 },
  { name: 'BeforeAgent', timeout: 10_000 },
  { name: 'AfterAgent', timeout: 10_000 },
  { name: 'BeforeTool', timeout: 620_000, matcher: '*' },
  { name: 'AfterTool', timeout: 10_000, matcher: '*' },
  { name: 'Notification', timeout: 10_000 },
]

const CURSOR_EVENTS: HookEvent[] = [
  { name: 'sessionStart', timeout: 10 },
  { name: 'sessionEnd', timeout: 10 },
  { name: 'beforeSubmitPrompt', timeout: 10 },
  { name: 'preToolUse', timeout: 10 },
  { name: 'postToolUse', timeout: 10 },
  { name: 'postToolUseFailure', timeout: 10 },
  { name: 'beforeShellExecution', timeout: 620 },
  { name: 'beforeMCPExecution', timeout: 620 },
  { name: 'afterAgentResponse', timeout: 10 },
  { name: 'stop', timeout: 10 },
  { name: 'subagentStart', timeout: 10 },
  { name: 'subagentStop', timeout: 10 },
]

const AGY_TOOL_EVENTS = ['PreToolUse', 'PostToolUse']
const AGY_FLAT_EVENTS = ['PreInvocation', 'PostInvocation', 'Stop']

const home = (...p: string[]): string => path.join(os.homedir(), ...p)

const CONFIG: Record<Id, () => string> = {
  'claude-code': () => home('.claude', 'settings.json'),
  antigravity: () => home('.gemini', 'config', 'hooks.json'),
  codex: () => home('.codex', 'hooks.json'),
  gemini: () => home('.gemini', 'settings.json'),
  cursor: () => home('.cursor', 'hooks.json'),
}
const configPath = (which: Id): string => CONFIG[which]()

type Json = Record<string, unknown>

function readStrict(file: string): { value: Json; bytes: Buffer } {
  let bytes: Buffer
  try {
    bytes = fs.readFileSync(file)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { value: {}, bytes: Buffer.alloc(0) }
    throw new Error(`Kumo can't read ${file}: ${(e as Error).message}`)
  }
  const text = bytes.toString('utf8').replace(/^﻿/, '')
  if (!text.trim()) return { value: {}, bytes }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new Error(`${file} isn't valid JSON (${(e as Error).message}). Fix it first - Kumo won't overwrite it.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} isn't a JSON object - Kumo won't touch it.`)
  return { value: parsed as Json, bytes }
}

const fingerprint = (b: Buffer): string => createHash('sha256').update(b).digest('hex').slice(0, 24)

const isOurs = (h: unknown): boolean => {
  const o = (h || {}) as Json
  return typeof o.command === 'string' && o.command.includes(MARKER)
}

const entryIsOurs = (entry: unknown): boolean => {
  const e = (entry || {}) as Json
  return Array.isArray(e.hooks) ? (e.hooks as unknown[]).some(isOurs) : isOurs(e)
}


function nestedCommand(agent: string | null, event: string): string {
  return agent ? `${relayCommandPath()} --agent ${agent} ${event}` : `${relayCommandPath()} ${event}`
}

function nested(events: HookEvent[], agent: string | null, extra: Json = {}) {
  return {
    merged(cur: Json): Json {
      const root: Json = { ...cur }
      const hooks: Json = { ...((root.hooks as Json) || {}) }
      for (const ev of events) {
        const list = (Array.isArray(hooks[ev.name]) ? (hooks[ev.name] as unknown[]) : []).filter((e) => !entryIsOurs(e))
        const entry: Json = { hooks: [{ ...extra, type: 'command', command: nestedCommand(agent, ev.name), timeout: ev.timeout }] }
        if (ev.matcher) entry.matcher = ev.matcher
        list.push(entry)
        hooks[ev.name] = list
      }
      root.hooks = hooks
      return root
    },
    stripped(cur: Json): Json {
      const root: Json = { ...cur }
      if (!root.hooks || typeof root.hooks !== 'object') return root
      const out: Json = {}
      for (const [event, v] of Object.entries(root.hooks as Json)) {
        if (!Array.isArray(v)) {
          out[event] = v
          continue
        }
        const kept = v.filter((e) => !entryIsOurs(e))
        if (kept.length) out[event] = kept
      }
      if (Object.keys(out).length) root.hooks = out
      else delete root.hooks
      return root
    },
    has(cur: Json): { any: boolean; current: boolean } {
      const hooks = (cur.hooks as Json) || {}
      let any = false
      let current = true
      for (const ev of events) {
        const list = Array.isArray(hooks[ev.name]) ? (hooks[ev.name] as Json[]) : []
        const ours = list.flatMap((e) => (Array.isArray(e.hooks) ? (e.hooks as Json[]) : [e])).filter(isOurs)
        if (ours.length) any = true
        if (!ours.some((h) => h.command === nestedCommand(agent, ev.name))) current = false
      }
      return { any, current: any && current }
    },
  }
}


function flat(events: HookEvent[], agent: string) {
  return {
    merged(cur: Json): Json {
      const root: Json = { version: 1, ...cur }
      const hooks: Json = { ...((root.hooks as Json) || {}) }
      for (const ev of events) {
        const list = (Array.isArray(hooks[ev.name]) ? (hooks[ev.name] as unknown[]) : []).filter((e) => !isOurs(e))
        list.push({ command: nestedCommand(agent, ev.name), timeout: ev.timeout })
        hooks[ev.name] = list
      }
      root.hooks = hooks
      return root
    },
    stripped(cur: Json): Json {
      const root: Json = { ...cur }
      if (!root.hooks || typeof root.hooks !== 'object') return root
      const out: Json = {}
      for (const [event, v] of Object.entries(root.hooks as Json)) {
        if (!Array.isArray(v)) {
          out[event] = v
          continue
        }
        const kept = v.filter((e) => !isOurs(e))
        if (kept.length) out[event] = kept
      }
      root.hooks = out
      return root
    },
    has(cur: Json): { any: boolean; current: boolean } {
      const hooks = (cur.hooks as Json) || {}
      let any = false
      let current = true
      for (const ev of events) {
        const ours = (Array.isArray(hooks[ev.name]) ? (hooks[ev.name] as Json[]) : []).filter(isOurs)
        if (ours.length) any = true
        if (!ours.some((h) => h.command === nestedCommand(agent, ev.name))) current = false
      }
      return { any, current: any && current }
    },
  }
}


const antigravityImpl = {
  merged(cur: Json): Json {
    const base = relayCommandPath()
    const kumo: Json = { enabled: true }
    for (const ev of AGY_TOOL_EVENTS) {
      kumo[ev] = [{ matcher: '*', hooks: [{ type: 'command', command: `${base} --agent antigravity ${ev}`, timeout: ev === 'PreToolUse' ? 620 : 10 }] }]
    }
    for (const ev of AGY_FLAT_EVENTS) kumo[ev] = [{ type: 'command', command: `${base} --agent antigravity ${ev}`, timeout: 10 }]
    return { ...cur, kumo }
  },
  stripped(cur: Json): Json {
    const root: Json = { ...cur }
    delete root.kumo
    return root
  },
  has(cur: Json): { any: boolean; current: boolean } {
    const k = cur.kumo as Json | undefined
    if (!k) return { any: false, current: false }
    const text = JSON.stringify(k)
    return { any: true, current: text.includes(relayCommandPath().replace(/"/g, '\\"')) && k.enabled !== false }
  },
}


interface Impl {
  name: string
  merged(cur: Json): Json
  stripped(cur: Json): Json
  has(cur: Json): { any: boolean; current: boolean }
  installed(inst: InstalledAgents): { cli: boolean; desktop: boolean }
}

const impl: Record<Id, Impl> = {
  'claude-code': { name: 'Claude Code', ...nested(CLAUDE_EVENTS, null), installed: (i) => ({ cli: i.claudeCli, desktop: i.claudeDesktop }) },
  antigravity: { name: 'Antigravity', ...antigravityImpl, installed: (i) => ({ cli: i.agyCli, desktop: i.antigravityDesktop }) },
  codex: { name: 'Codex', ...nested(CODEX_EVENTS, 'codex'), installed: (i) => ({ cli: i.codexCli, desktop: false }) },
  gemini: { name: 'Gemini CLI', ...nested(GEMINI_EVENTS, 'gemini', { name: 'kumo' }), installed: (i) => ({ cli: i.geminiCli, desktop: false }) },
  cursor: { name: 'Cursor', ...flat(CURSOR_EVENTS, 'cursor'), installed: (i) => ({ cli: false, desktop: i.cursorApp }) },
}

export const INTEGRATIONS: Id[] = ['claude-code', 'antigravity', 'codex', 'gemini', 'cursor']


const statusTee = (): string => `${relayCommandPath()} --tee --agent claude-code StatusLine`
const statusSolo = (): string => `${relayCommandPath()} --agent claude-code StatusLine`

const limitsImpl = {
  merged(cur: Json): Json {
    const root: Json = { ...limitsImpl.stripped(cur) }
    const sl = (root.statusLine && typeof root.statusLine === 'object' ? root.statusLine : null) as Json | null
    if (sl && typeof sl.command === 'string' && sl.command.trim()) root.statusLine = { ...sl, command: `${statusTee()} | ${sl.command}` }
    else root.statusLine = { type: 'command', command: statusSolo() }
    return root
  },
  stripped(cur: Json): Json {
    const root: Json = { ...cur }
    const sl = (root.statusLine && typeof root.statusLine === 'object' ? root.statusLine : null) as Json | null
    const cmd = sl && typeof sl.command === 'string' ? sl.command : ''
    if (!cmd.includes(MARKER)) return root
    const pipe = cmd.indexOf('StatusLine | ')
    if (pipe >= 0) root.statusLine = { ...sl, command: cmd.slice(pipe + 'StatusLine | '.length) }
    else delete root.statusLine
    return root
  },
  has(cur: Json): boolean {
    const sl = cur.statusLine as Json | undefined
    return Boolean(sl && typeof sl.command === 'string' && sl.command.includes(MARKER))
  },
}

type Target = Id | 'claude-limits'
const fileFor = (t: Target): string => (t === 'claude-limits' ? configPath('claude-code') : configPath(t))
const transform = (t: Target, install: boolean, cur: Json): Json =>
  t === 'claude-limits' ? (install ? limitsImpl.merged(cur) : limitsImpl.stripped(cur)) : install ? impl[t].merged(cur) : impl[t].stripped(cur)

export function status(which: Id): IntegrationStatus {
  const file = configPath(which)
  const installed = impl[which].installed(detectInstalled())
  const base = { id: which, name: impl[which].name, configPath: file, installed, lastEventAt: sessions.lastEventAt[which] }
  if (!fs.existsSync(relayPath())) return { ...base, state: 'error', detail: 'The Kumo relay is missing. Reinstall Kumo to repair it.' }
  let cur: Json
  try {
    cur = readStrict(file).value
  } catch (e) {
    return { ...base, state: 'error', detail: (e as Error).message }
  }
  const h = impl[which].has(cur)
  if (which === 'claude-code') Object.assign(base, { limits: limitsImpl.has(cur) })
  if (h.current) return { ...base, state: 'connected', detail: 'Sessions, approvals and context are live.' }
  if (h.any) return { ...base, state: 'outdated', detail: 'Kumo moved since you connected. Reconnect to update the hooks.' }
  if (!installed.cli && !installed.desktop) return { ...base, state: 'unavailable', detail: `${impl[which].name} doesn't seem to be installed.` }
  return { ...base, state: 'disconnected', detail: 'Not connected yet.' }
}

export function allStatus(): IntegrationStatus[] {
  return INTEGRATIONS.map(status)
}

export function preview(which: Target, install: boolean): HookPreview {
  const file = fileFor(which)
  const { value, bytes } = readStrict(file)
  const next = transform(which, install, value)
  return {
    integration: which,
    install,
    diff: unifiedDiff(bytes.length ? JSON.stringify(value, null, 2) : '', JSON.stringify(next, null, 2)),
    configPath: file,
    backupPath: `${file}.kumo-backup-${stamp()}`,
    fingerprint: fingerprint(bytes),
  }
}

export function apply(which: Target, install: boolean, fp: string): string {
  const file = fileFor(which)
  ensureDir(path.dirname(file))
  const { value, bytes } = readStrict(file)
  if (fingerprint(bytes) !== fp) throw new Error(`${path.basename(file)} changed since you reviewed it. Nothing was written - review the new changes.`)
  let backup = ''
  if (bytes.length) {
    backup = `${file}.kumo-backup-${stamp()}`
    fs.writeFileSync(backup, bytes)
  }
  const next = transform(which, install, value)
  let real = file
  try {
    real = fs.realpathSync(file)
  } catch {
  }
  const tmp = `${real}.kumo-${process.pid}`
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(tmp, real)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw new Error(`Couldn't write ${file}: ${(e as Error).message}`)
  }
  log(`${install ? 'connected' : 'disconnected'} ${which}`, backup ? `backup ${backup}` : '')
  return backup
}

export function ensureRelay(): void {
  const dest = relayPath()
  const name = path.basename(dest)
  const candidates = [
    path.join(process.resourcesPath || '', 'relay', name),
    path.join(app.getAppPath(), 'resources', 'relay', name),
    path.join(app.getAppPath(), 'relay', 'target', 'release', name),
  ]
  const src = candidates.find((c) => fs.existsSync(c))
  if (!src) {
    log('relay binary not found in', candidates.join(', '))
    return
  }
  try {
    ensureDir(path.dirname(dest))
    const a = fs.readFileSync(src)
    const same = fs.existsSync(dest) && fs.readFileSync(dest).equals(a)
    if (same) return
    const tmp = `${dest}.new-${process.pid}`
    fs.writeFileSync(tmp, a, { mode: 0o755 })
    try {
      fs.renameSync(tmp, dest)
    } catch {
      try {
        fs.renameSync(dest, `${dest}.old-${Date.now()}`)
        fs.renameSync(tmp, dest)
      } catch {
        fs.rmSync(tmp, { force: true })
      }
    }
    for (const f of fs.readdirSync(path.dirname(dest))) {
      if (f.includes('.old-')) fs.rmSync(path.join(path.dirname(dest), f), { force: true })
    }
  } catch (e) {
    log('relay install failed', e)
  }
}

export function unifiedDiff(before: string, after: string): string {
  const a = before ? before.split('\n') : []
  const b = after.split('\n')
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`)
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push(`- ${a[i++]}`)
    else out.push(`+ ${b[j++]}`)
  }
  while (i < n) out.push(`- ${a[i++]}`)
  while (j < m) out.push(`+ ${b[j++]}`)
  const changed = out.map((l, k) => (l[0] !== ' ' ? k : -1)).filter((k) => k >= 0)
  if (!changed.length) return 'No changes.'
  const keep = new Array<boolean>(out.length).fill(false)
  for (const k of changed) for (let x = Math.max(0, k - 3); x < Math.min(out.length, k + 4); x++) keep[x] = true
  const res: string[] = []
  let gap = false
  out.forEach((l, k) => {
    if (keep[k]) {
      res.push(l)
      gap = false
    } else if (!gap) {
      res.push('  …')
      gap = true
    }
  })
  return res.join('\n')
}
