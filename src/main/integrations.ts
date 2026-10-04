import { app } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { HookPreview, InstalledAgents, IntegrationId, IntegrationStatus, McpClientId, McpClientStatus } from '../shared/types'
import { detectInstalled } from './detect'
import { sessions } from './sessions'
import { ensureDir, isMac, isWin, kumoHome, log, stamp } from './util'
import { tr } from './i18n'


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

const QWEN_EVENTS: HookEvent[] = [
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

const COPILOT_EVENTS: HookEvent[] = [
  { name: 'sessionStart', timeout: 10 },
  { name: 'sessionEnd', timeout: 10 },
  { name: 'userPromptSubmitted', timeout: 10 },
  { name: 'preToolUse', timeout: 10 },
  { name: 'postToolUse', timeout: 10 },
  { name: 'postToolUseFailure', timeout: 10 },
  { name: 'permissionRequest', timeout: 620 },
  { name: 'agentStop', timeout: 10 },
  { name: 'subagentStart', timeout: 10 },
  { name: 'subagentStop', timeout: 10 },
  { name: 'errorOccurred', timeout: 10 },
  { name: 'notification', timeout: 10 },
]

const WINDSURF_EVENTS = ['pre_user_prompt', 'pre_read_code', 'post_read_code', 'pre_write_code', 'post_write_code', 'pre_run_command', 'post_run_command', 'pre_mcp_tool_use', 'post_mcp_tool_use', 'post_cascade_response']

const KIRO_EVENTS: HookEvent[] = [
  { name: 'SessionStart', timeout: 10 },
  { name: 'UserPromptSubmit', timeout: 10 },
  { name: 'PreToolUse', timeout: 620, matcher: '.*' },
  { name: 'PostToolUse', timeout: 10, matcher: '.*' },
  { name: 'Stop', timeout: 10 },
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
  copilot: () => path.join(process.env.COPILOT_HOME || home('.copilot'), 'hooks', 'kumo.json'),
  qwen: () => home('.qwen', 'settings.json'),
  windsurf: () => home('.codeium', 'windsurf', 'hooks.json'),
  kiro: () => home('.kiro', 'hooks', 'kumo.json'),
  opencode: () => home('.config', 'opencode', 'plugins', 'kumo.js'),
  amp: () => home('.config', 'amp', 'plugins', 'kumo.ts'),
  cline: () => home('.cline', 'plugins', 'kumo', 'index.js'),
  aider: () => home('.aider.conf.yml'),
}
const configPath = (which: Id): string => CONFIG[which]()

type Json = Record<string, unknown>

function readStrict(file: string): { value: Json; bytes: Buffer } {
  let bytes: Buffer
  try {
    bytes = fs.readFileSync(file)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { value: {}, bytes: Buffer.alloc(0) }
    throw new Error(tr('Kumo can\'t read {0}: {1}', file, (e as Error).message))
  }
  const text = bytes.toString('utf8').replace(/^﻿/, '')
  if (!text.trim()) return { value: {}, bytes }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new Error(tr('{0} isn\'t valid JSON ({1}). Fix it first - Kumo won\'t overwrite it.', file, (e as Error).message))
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(tr('{0} isn\'t a JSON object - Kumo won\'t touch it.', file))
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


const runtimeLoader = `const runtime = () => {
  try {
    const r = JSON.parse(readFileSync(join(homedir(), ".kumo", "runtime.json"), "utf8"))
    return r && r.port && r.token ? r : null
  } catch {
    return null
  }
}

async function send(agent, event, payload, wait) {
  const rt = runtime()
  if (!rt) return null
  try {
    const res = await fetch("http://127.0.0.1:" + rt.port + "/v1/hook", {
      method: "POST",
      headers: { "content-type": "application/json", "x-kumo-token": rt.token },
      body: JSON.stringify({ agent, event, payload }),
      signal: AbortSignal.timeout(wait ? 610000 : 4000),
    })
    if (!res.ok) return null
    const text = (await res.text()).trim()
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}`

const OPENCODE_PLUGIN = `import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

${runtimeLoader}

export const KumoPlugin = async ({ client, directory }) => {
  const base = (id) => ({ session_id: id || "default", cwd: directory })
  return {
    event: async ({ event }) => {
      const p = (event && event.properties) || {}
      const id = p.sessionID || (p.info && p.info.id) || p.id
      if (event.type === "session.created") await send("opencode", "session-start", base(id))
      else if (event.type === "session.deleted") await send("opencode", "session-end", base(id))
      else if (event.type === "session.error") await send("opencode", "error", { ...base(id), error: String((p.error && ((p.error.data && p.error.data.message) || p.error.message || p.error.name)) || "") })
      else if (event.type === "session.idle") {
        const r = await send("opencode", "stop", base(id))
        if (r && r.followup && client && client.session && client.session.prompt) {
          try {
            await client.session.prompt({ path: { id }, body: { parts: [{ type: "text", text: r.followup }] } })
          } catch {}
        }
      }
    },
    "chat.message": async (input, output) => {
      const parts = (output && output.parts) || []
      const text = parts.filter((x) => x && x.type === "text").map((x) => x.text).join("\\n")
      const r = await send("opencode", "prompt", { ...base(input && input.sessionID), prompt: text })
      if (r && r.context && Array.isArray(output && output.parts)) output.parts.push({ type: "text", text: r.context, synthetic: true })
    },
    "tool.execute.before": async (input, output) => {
      const r = await send("opencode", "tool-start", { ...base(input && input.sessionID), tool_name: input && input.tool, tool_input: output && output.args, tool_use_id: input && input.callID })
      if (r && r.halt) throw new Error(r.message || "Stopped from Kumo.")
    },
    "tool.execute.after": async (input) => {
      await send("opencode", "tool-end", { ...base(input && input.sessionID), tool_name: input && input.tool, tool_use_id: input && input.callID })
    },
    "permission.ask": async (input, output) => {
      const meta = (input && input.metadata) || {}
      const r = await send("opencode", "permission", { ...base(input && input.sessionID), tool_name: input && input.type, tool_input: { command: meta.command || input.pattern, filePath: meta.filePath || meta.filepath, url: meta.url, title: input && input.title }, tool_use_id: input && input.callID }, true)
      if (r && (r.status === "allow" || r.status === "deny")) output.status = r.status
    },
  }
}
`

const AMP_PLUGIN = `import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

${runtimeLoader.replace('async function send(agent, event, payload, wait)', 'async function send(agent: string, event: string, payload: Record<string, unknown>, wait?: boolean): Promise<any>')}

export const description = "Shows Amp sessions and approvals in Kumo."

export default function (amp: any) {
  const base = (event: any, ctx: any) => ({
    session_id: String((event && ((event.thread && event.thread.id) || event.threadID || event.threadId)) || (ctx && ctx.thread && ctx.thread.id) || "default"),
    cwd: String((ctx && ctx.cwd) || process.cwd()),
  })
  amp.on("session.start", async (event: any, ctx: any) => {
    await send("amp", "session-start", base(event, ctx))
  })
  amp.on("agent.start", async (event: any, ctx: any) => {
    await send("amp", "prompt", { ...base(event, ctx), prompt: String((event && (event.message || event.prompt || event.text)) || "") })
  })
  amp.on("tool.call", async (event: any, ctx: any) => {
    const call = { ...base(event, ctx), tool_name: event && (event.tool || event.name), tool_input: event && (event.input || event.args), tool_use_id: event && (event.id || event.toolUseId) }
    await send("amp", "tool-start", call)
    const r = await send("amp", "permission", call, true)
    if (r && r.action === "reject-and-continue") return { action: "reject-and-continue", message: r.message || "Declined in Kumo." }
    return { action: "allow" }
  })
  amp.on("tool.result", async (event: any, ctx: any) => {
    await send("amp", "tool-end", { ...base(event, ctx), tool_name: event && (event.tool || event.name), tool_use_id: event && (event.id || event.toolUseId) })
  })
  amp.on("agent.end", async (event: any, ctx: any) => {
    await send("amp", "stop", base(event, ctx))
  })
}
`

const CLINE_PLUGIN = `import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, basename } from "node:path"

${runtimeLoader}

const base = () => ({ session_id: basename(process.cwd()) || "default", cwd: process.cwd() })

export default {
  name: "kumo",
  manifest: { capabilities: ["hooks"] },
  setup() {},
  hooks: {
    async beforeRun() {
      await send("cline", "turn-start", base())
    },
    async beforeTool(context) {
      const call = (context && context.toolCall) || {}
      const payload = { ...base(), tool_name: call.name, tool_input: (context && context.input) || call.input, tool_use_id: call.id }
      await send("cline", "tool-start", payload)
      const r = await send("cline", "permission", payload, true)
      if (r && r.allow === false) throw new Error(r.message || "Declined in Kumo.")
    },
    async afterTool(context) {
      const call = (context && context.toolCall) || {}
      await send("cline", "tool-end", { ...base(), tool_name: call.name, tool_use_id: call.id })
    },
    async afterRun() {
      await send("cline", "stop", base())
    },
  },
}
`

const CLINE_PACKAGE = JSON.stringify({ name: 'kumo-cline', version: '1.0.0', private: true, type: 'module', cline: { plugins: [{ paths: ['./index.js'], capabilities: ['hooks'] }] } }, null, 2) + '\n'

type Cur = Json | string | null

interface Impl {
  name: string
  format: 'json' | 'text'
  owned?: boolean
  extra?: () => { file: string; content: string }[]
  merged(cur: Cur): Cur
  stripped(cur: Cur): Cur
  has(cur: Cur): { any: boolean; current: boolean }
  installed(inst: InstalledAgents): { cli: boolean; desktop: boolean }
  beta?: boolean
  partial?: boolean
}

function jsonImpl(x: { merged(cur: Json): Json; stripped(cur: Json): Json; has(cur: Json): { any: boolean; current: boolean } }) {
  return {
    format: 'json' as const,
    merged: (cur: Cur) => x.merged((cur as Json) || {}),
    stripped: (cur: Cur) => x.stripped((cur as Json) || {}),
    has: (cur: Cur) => x.has((cur as Json) || {}),
  }
}

function ownedJson(build: () => Json) {
  return {
    format: 'json' as const,
    owned: true,
    merged: () => build(),
    stripped: () => null,
    has: (cur: Cur) => {
      if (!cur || typeof cur !== 'object' || !Object.keys(cur).length) return { any: false, current: false }
      return { any: true, current: JSON.stringify(cur) === JSON.stringify(build()) }
    },
  }
}

function ownedText(build: () => string) {
  return {
    format: 'text' as const,
    owned: true,
    merged: () => build(),
    stripped: () => null,
    has: (cur: Cur) => (typeof cur === 'string' && cur.length ? { any: true, current: cur === build() } : { any: false, current: false }),
  }
}

const copilotHooks = (): Json => {
  const hooks: Json = {}
  for (const ev of COPILOT_EVENTS) hooks[ev.name] = [{ type: 'command', command: nestedCommand('copilot', ev.name), timeoutSec: ev.timeout }]
  return { version: 1, hooks }
}

const kiroHooks = (): Json => ({
  version: 'v1',
  hooks: KIRO_EVENTS.map((ev) => {
    const h: Json = { name: `kumo-${ev.name.toLowerCase()}`, trigger: ev.name, action: { type: 'command', command: nestedCommand('kiro', ev.name) }, timeout: ev.timeout, enabled: true }
    if (ev.matcher) h.matcher = ev.matcher
    return h
  }),
})

const psCommand = (cmd: string): string => (cmd.startsWith('"') ? `& ${cmd}` : cmd)

const windsurfImpl = {
  merged(cur: Json): Json {
    const root: Json = { ...cur }
    const hooks: Json = { ...((root.hooks as Json) || {}) }
    for (const ev of WINDSURF_EVENTS) {
      const list = (Array.isArray(hooks[ev]) ? (hooks[ev] as unknown[]) : []).filter((e) => !isOurs(e))
      const command = nestedCommand('windsurf', ev)
      const entry: Json = { command, show_output: false }
      if (isWin) entry.powershell = psCommand(command)
      list.push(entry)
      hooks[ev] = list
    }
    root.hooks = hooks
    return root
  },
  stripped(cur: Json): Json {
    return flat([], 'windsurf').stripped(cur)
  },
  has(cur: Json): { any: boolean; current: boolean } {
    return flat(WINDSURF_EVENTS.map((name) => ({ name, timeout: 0 })), 'windsurf').has(cur)
  },
}

const AIDER_MARK = '# kumo'
const AIDER_OFF = '# kumo-disabled: '
const aiderCommand = (): string => `'${nestedCommand('aider', 'Notification')}'`

const aiderImpl = {
  format: 'text' as const,
  merged(cur: Cur): Cur {
    const lines = aiderImpl.stripped(cur) as string
    const out = lines
      .split(/\r?\n/)
      .map((l) => (/^\s*notifications(_command)?\s*:/.test(l) ? AIDER_OFF + l : l))
      .filter((l, i, a) => !(l === '' && i === a.length - 1))
    out.push(`notifications: true  ${AIDER_MARK}`, `notifications_command: ${aiderCommand()}  ${AIDER_MARK}`)
    return out.join('\n') + '\n'
  },
  stripped(cur: Cur): Cur {
    const text = typeof cur === 'string' ? cur : ''
    return text
      .split(/\r?\n/)
      .filter((l) => !l.trimEnd().endsWith(AIDER_MARK))
      .map((l) => (l.startsWith(AIDER_OFF) ? l.slice(AIDER_OFF.length) : l))
      .join('\n')
  },
  has(cur: Cur): { any: boolean; current: boolean } {
    const text = typeof cur === 'string' ? cur : ''
    const any = text.includes(MARKER) && text.includes(AIDER_MARK)
    return { any, current: any && text.includes(aiderCommand()) }
  },
}

const impl: Record<Id, Impl> = {
  'claude-code': { name: 'Claude Code', ...jsonImpl(nested(CLAUDE_EVENTS, null)), installed: (i) => ({ cli: i.claudeCli, desktop: i.claudeDesktop }) },
  antigravity: { name: 'Antigravity', ...jsonImpl(antigravityImpl), installed: (i) => ({ cli: i.agyCli, desktop: i.antigravityDesktop }) },
  codex: { name: 'Codex', ...jsonImpl(nested(CODEX_EVENTS, 'codex')), installed: (i) => ({ cli: i.codexCli, desktop: false }) },
  gemini: { name: 'Gemini CLI', ...jsonImpl(nested(GEMINI_EVENTS, 'gemini', { name: 'kumo' })), installed: (i) => ({ cli: i.geminiCli, desktop: false }) },
  cursor: { name: 'Cursor', ...jsonImpl(flat(CURSOR_EVENTS, 'cursor')), installed: (i) => ({ cli: false, desktop: i.cursorApp }) },
  copilot: { name: 'Copilot CLI', ...ownedJson(copilotHooks), installed: (i) => ({ cli: i.copilotCli, desktop: false }) },
  qwen: { name: 'Qwen Code', ...jsonImpl(nested(QWEN_EVENTS, 'qwen')), installed: (i) => ({ cli: i.qwenCli, desktop: false }) },
  windsurf: { name: 'Windsurf', ...jsonImpl(windsurfImpl), installed: (i) => ({ cli: false, desktop: i.windsurfApp }) },
  kiro: { name: 'Kiro CLI', ...ownedJson(kiroHooks), installed: (i) => ({ cli: i.kiroCli, desktop: false }), beta: true },
  opencode: { name: 'OpenCode', ...ownedText(() => OPENCODE_PLUGIN), installed: (i) => ({ cli: i.opencodeCli, desktop: false }) },
  amp: { name: 'Amp', ...ownedText(() => AMP_PLUGIN), installed: (i) => ({ cli: i.ampCli, desktop: false }), beta: true },
  cline: {
    name: 'Cline',
    ...ownedText(() => CLINE_PLUGIN),
    extra: () => [{ file: home('.cline', 'plugins', 'kumo', 'package.json'), content: CLINE_PACKAGE }],
    installed: (i) => ({ cli: i.clineCli, desktop: i.clineExt }),
    beta: true,
  },
  aider: { name: 'Aider', ...aiderImpl, installed: (i) => ({ cli: i.aiderCli, desktop: false }), partial: true },
}

export const INTEGRATIONS: Id[] = ['claude-code', 'antigravity', 'codex', 'gemini', 'cursor', 'copilot', 'qwen', 'windsurf', 'kiro', 'opencode', 'amp', 'cline', 'aider']

const vscodeStorage = (extension: string, file: string): string => {
  const appData = isWin ? process.env.APPDATA || home('AppData', 'Roaming') : isMac ? home('Library', 'Application Support') : home('.config')
  return path.join(appData, 'Code', 'User', 'globalStorage', extension, 'settings', file)
}

const mcpEntry = (agent: string, extra: Json = {}): Json => ({ ...extra, command: relayPath(), args: ['--mcp', '--agent', agent] })

function mcpJson(key: string, agent: string, extra: Json = {}, nestedKey?: string) {
  const entryOf = (cur: Json): Json | undefined => ((nestedKey ? (cur[nestedKey] as Json | undefined) : cur) || {})[key] as Json | undefined
  return {
    format: 'json' as const,
    merged(cur: Cur): Cur {
      const root: Json = { ...((cur as Json) || {}) }
      const holder = nestedKey ? { ...((root[nestedKey] as Json) || {}) } : root
      holder[key] = { ...((holder[key] as Json) || {}), kumo: mcpEntry(agent, extra) }
      if (nestedKey) root[nestedKey] = holder
      return root
    },
    stripped(cur: Cur): Cur {
      const root: Json = { ...((cur as Json) || {}) }
      const holder = nestedKey ? { ...((root[nestedKey] as Json) || {}) } : root
      const servers = { ...((holder[key] as Json) || {}) }
      delete servers.kumo
      if (Object.keys(servers).length) holder[key] = servers
      else delete holder[key]
      if (nestedKey) {
        if (Object.keys(holder).length) root[nestedKey] = holder
        else delete root[nestedKey]
      }
      return root
    },
    has(cur: Cur): { any: boolean; current: boolean } {
      const servers = entryOf((cur as Json) || {})
      const k = servers?.kumo as Json | undefined
      if (!k) return { any: false, current: false }
      return { any: true, current: JSON.stringify(k).includes(JSON.stringify(relayPath()).slice(1, -1)) }
    },
  }
}

const opencodeMcp = {
  format: 'json' as const,
  merged(cur: Cur): Cur {
    const root: Json = { ...((cur as Json) || {}) }
    root.mcp = { ...((root.mcp as Json) || {}), kumo: { type: 'local', command: [relayPath(), '--mcp', '--agent', 'opencode'], enabled: true } }
    return root
  },
  stripped(cur: Cur): Cur {
    const root: Json = { ...((cur as Json) || {}) }
    const mcp = { ...((root.mcp as Json) || {}) }
    delete mcp.kumo
    if (Object.keys(mcp).length) root.mcp = mcp
    else delete root.mcp
    return root
  },
  has(cur: Cur): { any: boolean; current: boolean } {
    const k = (((cur as Json) || {}).mcp as Json | undefined)?.kumo as Json | undefined
    if (!k) return { any: false, current: false }
    return { any: true, current: JSON.stringify(k).includes(JSON.stringify(relayPath()).slice(1, -1)) }
  },
}

const CODEX_START = '# kumo:start'
const CODEX_END = '# kumo:end'
const codexBlock = (): string => `${CODEX_START}\n[mcp_servers.kumo]\ncommand = '${relayPath()}'\nargs = ["--mcp", "--agent", "codex"]\ntool_timeout_sec = 600\n${CODEX_END}\n`

const codexMcp = {
  format: 'text' as const,
  merged(cur: Cur): Cur {
    const base = (codexMcp.stripped(cur) as string).replace(/\s*$/, '')
    return (base ? `${base}\n\n` : '') + codexBlock()
  },
  stripped(cur: Cur): Cur {
    const text = typeof cur === 'string' ? cur : ''
    const a = text.indexOf(CODEX_START)
    if (a < 0) return text
    const b = text.indexOf(CODEX_END, a)
    const end = b < 0 ? text.length : b + CODEX_END.length
    return (text.slice(0, a).replace(/\s*$/, '') + '\n' + text.slice(end).replace(/^\s*/, '')).replace(/^\n$/, '')
  },
  has(cur: Cur): { any: boolean; current: boolean } {
    const text = typeof cur === 'string' ? cur : ''
    const any = text.includes(CODEX_START)
    return { any, current: any && text.includes(codexBlock().trim()) }
  },
}

interface McpImpl {
  name: string
  file: () => string
  format: 'json' | 'text'
  merged(cur: Cur): Cur
  stripped(cur: Cur): Cur
  has(cur: Cur): { any: boolean; current: boolean }
  installed(i: InstalledAgents): boolean
}

const mcpImpl: Record<McpClientId, McpImpl> = {
  'claude-code': { name: 'Claude Code', file: () => home('.claude.json'), ...mcpJson('mcpServers', 'claude-code', { type: 'stdio' }), installed: (i) => i.claudeCli || i.claudeDesktop },
  codex: { name: 'Codex', file: () => home('.codex', 'config.toml'), ...codexMcp, installed: (i) => i.codexCli },
  gemini: { name: 'Gemini CLI', file: () => home('.gemini', 'settings.json'), ...mcpJson('mcpServers', 'gemini', { timeout: 600000 }), installed: (i) => i.geminiCli },
  qwen: { name: 'Qwen Code', file: () => home('.qwen', 'settings.json'), ...mcpJson('mcpServers', 'qwen', { timeout: 600000 }), installed: (i) => i.qwenCli },
  cursor: { name: 'Cursor', file: () => home('.cursor', 'mcp.json'), ...mcpJson('mcpServers', 'cursor'), installed: (i) => i.cursorApp },
  windsurf: { name: 'Windsurf', file: () => home('.codeium', 'windsurf', 'mcp_config.json'), ...mcpJson('mcpServers', 'windsurf'), installed: (i) => i.windsurfApp },
  copilot: { name: 'Copilot CLI', file: () => path.join(process.env.COPILOT_HOME || home('.copilot'), 'mcp-config.json'), ...mcpJson('mcpServers', 'copilot', { type: 'local', tools: ['*'] }), installed: (i) => i.copilotCli },
  kiro: { name: 'Kiro CLI', file: () => home('.kiro', 'settings', 'mcp.json'), ...mcpJson('mcpServers', 'kiro'), installed: (i) => i.kiroCli },
  opencode: { name: 'OpenCode', file: () => home('.config', 'opencode', 'opencode.json'), ...opencodeMcp, installed: (i) => i.opencodeCli },
  amp: { name: 'Amp', file: () => home('.config', 'amp', 'settings.json'), ...mcpJson('amp.mcpServers', 'amp'), installed: (i) => i.ampCli },
  roo: { name: 'Roo Code', file: () => vscodeStorage('rooveterinaryinc.roo-cline', 'mcp_settings.json'), ...mcpJson('mcpServers', 'roo', { disabled: false, alwaysAllow: [], timeout: 600 }), installed: (i) => i.rooExt },
  cline: { name: 'Cline', file: () => vscodeStorage('saoudrizwan.claude-dev', 'cline_mcp_settings.json'), ...mcpJson('mcpServers', 'cline', { disabled: false, autoApprove: [], timeout: 600 }), installed: (i) => i.clineExt || i.clineCli },
}

export const MCP_CLIENTS = Object.keys(mcpImpl) as McpClientId[]

export const validTarget = (t: unknown): t is Target =>
  t === 'claude-limits' || (typeof t === 'string' && (INTEGRATIONS.includes(t as Id) || (t.startsWith('mcp:') && MCP_CLIENTS.includes(t.slice(4) as McpClientId))))

function readCur(file: string, format: 'json' | 'text'): { value: Cur; bytes: Buffer } {
  if (format === 'json') return readStrict(file)
  try {
    const bytes = fs.readFileSync(file)
    return { value: bytes.toString('utf8'), bytes }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { value: '', bytes: Buffer.alloc(0) }
    throw new Error(tr('Kumo can\'t read {0}: {1}', file, (e as Error).message))
  }
}

const render = (v: Cur, format: 'json' | 'text'): string => (v == null ? '' : format === 'json' ? JSON.stringify(v, null, 2) : (v as string))

export function mcpStatus(): McpClientStatus[] {
  const inst = detectInstalled()
  return MCP_CLIENTS.map((id) => {
    const m = mcpImpl[id]
    const file = m.file()
    const base = { id, name: m.name, configPath: file, installed: m.installed(inst) }
    try {
      const h = m.has(readCur(file, m.format).value)
      return { ...base, connected: h.current }
    } catch (e) {
      return { ...base, connected: false, error: (e as Error).message }
    }
  })
}


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

type Target = Id | 'claude-limits' | `mcp:${McpClientId}`
const isMcp = (t: Target): t is `mcp:${McpClientId}` => t.startsWith('mcp:')
const fileFor = (t: Target): string => (t === 'claude-limits' ? configPath('claude-code') : isMcp(t) ? mcpImpl[t.slice(4) as McpClientId].file() : configPath(t))
const formatOf = (t: Target): 'json' | 'text' => (t === 'claude-limits' ? 'json' : isMcp(t) ? mcpImpl[t.slice(4) as McpClientId].format : impl[t].format)
const transform = (t: Target, install: boolean, cur: Cur): Cur => {
  if (t === 'claude-limits') return install ? limitsImpl.merged((cur as Json) || {}) : limitsImpl.stripped((cur as Json) || {})
  const x = isMcp(t) ? mcpImpl[t.slice(4) as McpClientId] : impl[t]
  return install ? x.merged(cur) : x.stripped(cur)
}
const extraFiles = (t: Target): { file: string; content: string }[] => (t === 'claude-limits' || isMcp(t) ? [] : impl[t].extra?.() || [])
const ownedTarget = (t: Target): boolean => t !== 'claude-limits' && !isMcp(t) && Boolean(impl[t].owned)

export function status(which: Id): IntegrationStatus {
  const file = configPath(which)
  const installed = impl[which].installed(detectInstalled())
  const base = { id: which, name: impl[which].name, configPath: file, installed, lastEventAt: sessions.lastEventAt[which] }
  if (!fs.existsSync(relayPath())) return { ...base, state: 'error', detail: tr('The Kumo relay is missing. Reinstall Kumo to repair it.') }
  if (impl[which].beta) Object.assign(base, { beta: true })
  if (impl[which].partial) Object.assign(base, { partial: true })
  let cur: Cur
  try {
    cur = readCur(file, impl[which].format).value
  } catch (e) {
    return { ...base, state: 'error', detail: (e as Error).message }
  }
  let h = impl[which].has(cur)
  const extra = impl[which].extra?.() || []
  if (h.current && extra.some((x) => !fs.existsSync(x.file) || fs.readFileSync(x.file, 'utf8') !== x.content)) h = { any: true, current: false }
  if (which === 'claude-code') Object.assign(base, { limits: limitsImpl.has((cur as Json) || {}) })
  if (h.current) return { ...base, state: 'connected', detail: tr('Sessions, approvals and context are live.') }
  if (h.any) return { ...base, state: 'outdated', detail: tr('Kumo moved since you connected. Reconnect to update the hooks.') }
  if (!installed.cli && !installed.desktop) return { ...base, state: 'unavailable', detail: tr('{0} doesn\'t seem to be installed.', impl[which].name) }
  return { ...base, state: 'disconnected', detail: tr('Not connected yet.') }
}

export function allStatus(): IntegrationStatus[] {
  return INTEGRATIONS.map(status)
}

export function preview(which: Target, install: boolean): HookPreview {
  const file = fileFor(which)
  const format = formatOf(which)
  const { value, bytes } = readCur(file, format)
  const next = transform(which, install, value)
  return {
    integration: which,
    install,
    diff: unifiedDiff(bytes.length ? render(value, format) : '', render(next, format)),
    configPath: file,
    backupPath: `${file}.kumo-backup-${stamp()}`,
    fingerprint: fingerprint(bytes),
  }
}

export function apply(which: Target, install: boolean, fp: string): string {
  const file = fileFor(which)
  const format = formatOf(which)
  ensureDir(path.dirname(file))
  const { value, bytes } = readCur(file, format)
  if (fingerprint(bytes) !== fp) throw new Error(tr('{0} changed since you reviewed it. Nothing was written - review the new changes.', path.basename(file)))
  let backup = ''
  if (bytes.length && !ownedTarget(which)) {
    backup = `${file}.kumo-backup-${stamp()}`
    fs.writeFileSync(backup, bytes)
  }
  const next = transform(which, install, value)
  for (const x of extraFiles(which)) {
    if (install) {
      ensureDir(path.dirname(x.file))
      fs.writeFileSync(x.file, x.content)
    } else fs.rmSync(x.file, { force: true })
  }
  if (next == null) {
    fs.rmSync(file, { force: true })
    const dir = path.dirname(file)
    try {
      if (ownedTarget(which) && !fs.readdirSync(dir).length && path.basename(dir) === 'kumo') fs.rmdirSync(dir)
    } catch {
    }
    log(`disconnected ${which}`)
    return backup
  }
  let real = file
  try {
    real = fs.realpathSync(file)
  } catch {
  }
  const tmp = `${real}.kumo-${process.pid}`
  try {
    fs.writeFileSync(tmp, format === 'json' ? `${JSON.stringify(next, null, 2)}\n` : (next as string), { mode: 0o600 })
    fs.renameSync(tmp, real)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw new Error(tr('Couldn\'t write {0}: {1}', file, (e as Error).message))
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
  if (!changed.length) return tr('No changes.')
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
