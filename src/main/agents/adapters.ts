import type { AgentDescriptor, Decision, LimitWindow, SessionUsage } from '../../shared/types'
import { truncate } from '../util'


export interface HookEnvelope {
  agent: string
  event: string
  payload: Record<string, unknown>
  env: Record<string, string>
  ancestors: { pid: number; name: string }[]
  cwd: string
}

export type AgentEventType =
  | 'session-start'
  | 'prompt'
  | 'turn-start'
  | 'tool-start'
  | 'tool-end'
  | 'approval'
  | 'notification'
  | 'stop'
  | 'stop-failure'
  | 'subagent-start'
  | 'subagent-stop'
  | 'session-end'
  | 'response'
  | 'limits'
  | 'gate'
  | 'ignore'

export interface AgentEvent {
  type: AgentEventType
  sessionId: string
  cwd: string
  model?: string
  title?: string
  prompt?: string
  tool?: { name: string; input: unknown; useId?: string; error?: string }
  notification?: { kind: string; message: string }
  summary?: string
  error?: string
  suggestions?: unknown[]
  transcript?: string
  gate?: boolean
  limits?: LimitWindow[]
  context?: { used: number; window: number }
  usage?: SessionUsage
}

export interface Adapter {
  descriptor: AgentDescriptor
  normalize(env: HookEnvelope): AgentEvent
  decision(d: Decision | null, raw?: unknown[]): string
  context(text: string, event: AgentEvent): string
  ack(event: AgentEvent): string
  continueWith(text: string, event: AgentEvent): string | null
  halt(rawEvent: string, event: AgentEvent): string
  routing?: 'antigravity' | 'gemini' | 'cursor'
  guarded?: Set<string>
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const AGY_NEUTRAL = '{"decision":"ask"}'
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

const LIMIT_LABEL: Record<LimitWindow['kind'], string> = { five_hour: '5-hour', seven_day: 'Week', spend: 'Spend' }

function statusLine(p: Record<string, unknown>): { limits?: LimitWindow[]; context?: { used: number; window: number }; usage?: SessionUsage } {
  const out: { limits?: LimitWindow[]; context?: { used: number; window: number }; usage?: SessionUsage } = {}
  const rl = (p.rate_limits && typeof p.rate_limits === 'object' ? p.rate_limits : null) as Record<string, Record<string, unknown>> | null
  if (rl) {
    const windows: LimitWindow[] = []
    for (const [key, kind] of [['five_hour', 'five_hour'], ['seven_day', 'seven_day'], ['spend_limit', 'spend']] as const) {
      const w = rl[key]
      const pct = n(w?.used_percentage)
      if (pct == null) continue
      const reset = n(w?.resets_at)
      windows.push({ kind, label: LIMIT_LABEL[kind], usedPct: pct, resetsAt: reset ? reset * 1000 : undefined })
    }
    if (windows.length) out.limits = windows
  }
  const cw = (p.context_window && typeof p.context_window === 'object' ? p.context_window : null) as Record<string, unknown> | null
  const size = n(cw?.context_window_size)
  const pct = n(cw?.used_percentage)
  if (size && pct != null) out.context = { used: Math.round((size * pct) / 100), window: size }
  const cost = (p.cost && typeof p.cost === 'object' ? p.cost : null) as Record<string, unknown> | null
  const usage: SessionUsage = { costUsd: n(cost?.total_cost_usd), inTokens: n(cw?.total_input_tokens), outTokens: n(cw?.total_output_tokens) }
  if (usage.costUsd != null || usage.inTokens != null) out.usage = usage
  return out
}

export function codexLimits(rl: Record<string, Record<string, unknown>>, now = Date.now()): LimitWindow[] {
  const out: LimitWindow[] = []
  for (const key of ['primary', 'secondary']) {
    const w = rl[key]
    const pct = n(w?.used_percent)
    if (pct == null) continue
    const minutes = n(w?.window_minutes) || (key === 'primary' ? 300 : 10080)
    const kind: LimitWindow['kind'] = minutes >= 1440 ? 'seven_day' : 'five_hour'
    const resetsAt = n(w?.resets_at) ? n(w?.resets_at)! * 1000 : n(w?.resets_in_seconds) ? now + n(w?.resets_in_seconds)! * 1000 : undefined
    out.push({ kind, label: kind === 'seven_day' ? 'Week' : minutes === 300 ? '5-hour' : `${Math.round(minutes / 60)}-hour`, usedPct: pct, resetsAt })
  }
  return out
}


const claude: Adapter = {
  descriptor: {
    id: 'claude-code',
    name: 'Claude Code',
    mark: 'C',
    color: '#E0865F',
    capabilities: { approvals: true, contextInjection: true, launch: true },
  },
  normalize({ event, payload: p, cwd }) {
    const base = {
      sessionId: s(p.session_id) || 'default',
      cwd: s(p.cwd) || cwd,
      model: typeof p.model === 'string' ? p.model : undefined,
      title: s(p.session_title) || undefined,
      transcript: s(p.transcript_path) || undefined,
    }
    const tool = { name: s(p.tool_name), input: p.tool_input, useId: s(p.tool_use_id) || undefined }
    switch (event) {
      case 'SessionStart':
        return { ...base, type: 'session-start' }
      case 'UserPromptSubmit':
        return { ...base, type: 'prompt', prompt: s(p.prompt) }
      case 'PreToolUse':
        return { ...base, type: 'tool-start', tool }
      case 'PostToolUse':
        return { ...base, type: 'tool-end', tool }
      case 'PostToolUseFailure':
        return { ...base, type: 'tool-end', tool: { ...tool, error: truncate(s(p.error) || s(p.tool_error) || 'Failed', 300) } }
      case 'PermissionRequest':
        return {
          ...base,
          type: 'approval',
          tool,
          suggestions: Array.isArray(p.permission_suggestions) ? p.permission_suggestions : [],
        }
      case 'Notification':
        return { ...base, type: 'notification', notification: { kind: s(p.notification_type), message: s(p.message) } }
      case 'Stop':
        return { ...base, type: 'stop', summary: s(p.last_assistant_message) }
      case 'StopFailure':
        return { ...base, type: 'stop-failure', error: s(p.error) || s(p.message) || 'The turn failed' }
      case 'SubagentStart':
        return { ...base, type: 'subagent-start', title: s(p.agent_type) || undefined }
      case 'SubagentStop':
        return { ...base, type: 'subagent-stop', title: s(p.agent_type) || undefined }
      case 'SessionEnd':
        return { ...base, type: 'session-end' }
      case 'StatusLine':
      case 'Status':
        return { ...base, type: 'limits', ...statusLine(p) }
      default:
        return { ...base, type: 'ignore' }
    }
  },
  decision(d, raw) {
    if (!d) return ''
    const decision: Record<string, unknown> = { behavior: d.behavior }
    if (d.behavior === 'deny') decision.message = d.message || 'Declined in Kumo.'
    if (d.behavior === 'allow' && d.remember && d.remember.startsWith('s')) {
      const idx = Number(d.remember.slice(1))
      const rule = Array.isArray(raw) ? raw[idx] : undefined
      if (rule) decision.updatedPermissions = [rule]
    }
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } })
  },
  context(text) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } })
  },
  ack() {
    return ''
  },
  continueWith(text) {
    return JSON.stringify({ decision: 'block', reason: text })
  },
  halt(raw) {
    const base = { continue: false, stopReason: 'Stopped from Kumo.' }
    if (raw === 'PermissionRequest') return JSON.stringify({ ...base, hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Stopped from Kumo.' } } })
    if (raw === 'PreToolUse') return JSON.stringify({ ...base, hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Stopped from Kumo.' } })
    return JSON.stringify(base)
  },
}


const antigravity: Adapter = {
  descriptor: {
    id: 'antigravity',
    name: 'Antigravity',
    mark: 'A',
    color: '#8EA2FF',
    capabilities: { approvals: true, contextInjection: true, launch: true },
  },
  normalize({ event, payload: p, cwd }) {
    const paths = Array.isArray(p.workspacePaths) ? (p.workspacePaths as unknown[]).filter((x) => typeof x === 'string') : []
    const call = (p.toolCall && typeof p.toolCall === 'object' ? p.toolCall : {}) as Record<string, unknown>
    const base = {
      sessionId: s(p.conversationId) || s(p.session_id) || 'default',
      cwd: (paths[0] as string) || s(p.cwd) || cwd,
      model: s(p.modelName) || undefined,
      transcript: s(p.transcriptPath) || undefined,
    }
    const tool = { name: s(call.name) || s(p.tool_name), input: call.args ?? p.tool_input, useId: p.stepIdx != null ? String(p.stepIdx) : undefined }
    switch (event) {
      case 'PreInvocation':
        return { ...base, type: 'turn-start' }
      case 'PreToolUse':
        return { ...base, type: 'tool-start', tool, gate: true }
      case 'PostToolUse':
        return { ...base, type: 'tool-end', tool: { ...tool, error: s(p.error) || undefined } }
      case 'PostInvocation':
        return { ...base, type: 'ignore' }
      case 'Stop': {
        const reason = s(p.terminationReason)
        if (reason === 'error' || s(p.error)) return { ...base, type: 'stop-failure', error: s(p.error) || 'The agent stopped with an error' }
        if (reason === 'max_steps_exceeded') return { ...base, type: 'stop', summary: 'Stopped after reaching the step limit.' }
        return { ...base, type: 'stop' }
      }
      default:
        return claude.normalize({ event, payload: p, cwd, agent: 'antigravity', env: {}, ancestors: [] })
    }
  },
  decision(d) {
    if (!d) return AGY_NEUTRAL
    return JSON.stringify(d.behavior === 'allow' ? { decision: 'allow' } : { decision: 'deny', reason: d.message || 'Declined in Kumo.' })
  },
  context(text) {
    return JSON.stringify({ injectSteps: [{ ephemeralMessage: text }] })
  },
  ack(ev) {
    return ev.type === 'tool-start' ? AGY_NEUTRAL : '{}'
  },
  continueWith(text) {
    return JSON.stringify({ decision: 'continue', reason: text })
  },
  halt(raw) {
    if (raw === 'PreToolUse') return JSON.stringify({ decision: 'deny', reason: 'Stopped from Kumo.' })
    if (raw === 'PostInvocation') return JSON.stringify({ terminationBehavior: 'terminate' })
    return '{}'
  },
  routing: 'antigravity',
  guarded: new Set(['run_command', 'read_url_content']),
}


const codex: Adapter = {
  ...claude,
  descriptor: {
    id: 'codex',
    name: 'Codex',
    mark: 'X',
    color: '#C9CDD6',
    capabilities: { approvals: true, contextInjection: true, launch: true },
  },
}


const gemini: Adapter = {
  descriptor: {
    id: 'gemini',
    name: 'Gemini CLI',
    mark: 'G',
    color: '#7AA7F7',
    capabilities: { approvals: true, contextInjection: true, launch: true },
  },
  normalize({ event, payload: p, cwd }) {
    const base = {
      sessionId: s(p.session_id) || 'default',
      cwd: s(p.cwd) || cwd,
      transcript: s(p.transcript_path) || undefined,
    }
    const tool = { name: s(p.tool_name), input: p.tool_input }
    switch (event) {
      case 'SessionStart':
        return { ...base, type: 'session-start' }
      case 'BeforeAgent':
        return { ...base, type: 'prompt', prompt: s(p.prompt) }
      case 'BeforeTool':
        return { ...base, type: 'tool-start', tool, gate: true }
      case 'AfterTool': {
        const r = (p.tool_response && typeof p.tool_response === 'object' ? p.tool_response : {}) as Record<string, unknown>
        const e = r.error
        const err = typeof e === 'string' ? e : e && typeof e === 'object' ? s((e as Record<string, unknown>).message) : ''
        return { ...base, type: 'tool-end', tool: { ...tool, error: err || undefined } }
      }
      case 'AfterAgent':
        return { ...base, type: 'stop', summary: s(p.prompt_response) }
      case 'Notification':
        return {
          ...base,
          type: 'notification',
          notification: { kind: s(p.notification_type) === 'ToolPermission' ? 'permission_prompt' : s(p.notification_type), message: s(p.message) },
        }
      case 'SessionEnd':
        return { ...base, type: 'session-end' }
      default:
        return { ...base, type: 'ignore' }
    }
  },
  decision(d) {
    if (!d) return '{}'
    return JSON.stringify(d.behavior === 'allow' ? { decision: 'allow' } : { decision: 'deny', reason: d.message || 'Declined in Kumo.' })
  },
  context(text) {
    return JSON.stringify({ hookSpecificOutput: { additionalContext: text } })
  },
  ack() {
    return '{}'
  },
  continueWith(text) {
    return JSON.stringify({ decision: 'deny', reason: text })
  },
  halt(raw) {
    if (raw === 'BeforeTool') return JSON.stringify({ decision: 'deny', reason: 'Stopped from Kumo.', continue: false, stopReason: 'Stopped from Kumo.' })
    return JSON.stringify({ continue: false, stopReason: 'Stopped from Kumo.' })
  },
  routing: 'gemini',
  guarded: new Set(['run_shell_command', 'write_file', 'replace', 'web_fetch']),
}


function parseMaybe(v: unknown): unknown {
  if (typeof v !== 'string') return v
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

const cursor: Adapter = {
  descriptor: {
    id: 'cursor',
    name: 'Cursor',
    mark: 'C',
    color: '#C9CDD6',
    capabilities: { approvals: true, contextInjection: false, launch: true },
  },
  normalize({ event, payload: p, cwd }) {
    const roots = Array.isArray(p.workspace_roots) ? (p.workspace_roots as unknown[]).filter((x): x is string => typeof x === 'string') : []
    const base = {
      sessionId: s(p.conversation_id) || s(p.session_id) || 'default',
      cwd: roots[0] || s(p.cwd) || cwd,
      model: s(p.model) || undefined,
      transcript: s(p.transcript_path) || undefined,
    }
    const tool = { name: s(p.tool_name), input: parseMaybe(p.tool_input), useId: s(p.tool_use_id) || undefined }
    switch (event) {
      case 'sessionStart':
        return { ...base, type: 'session-start' }
      case 'beforeSubmitPrompt':
        return { ...base, type: 'prompt', prompt: s(p.prompt) }
      case 'preToolUse':
        return { ...base, type: 'tool-start', tool }
      case 'postToolUse':
        return { ...base, type: 'tool-end', tool }
      case 'postToolUseFailure':
        return { ...base, type: 'tool-end', tool: { ...tool, error: s(p.error_message) || s(p.error) || 'Failed' } }
      case 'beforeShellExecution':
        return { ...base, type: 'gate', tool: { name: 'Shell', input: { command: s(p.command) } } }
      case 'beforeMCPExecution':
        return { ...base, type: 'gate', tool: { name: `mcp__${s(p.mcp_server_name) || 'mcp'}__${s(p.tool_name)}`, input: parseMaybe(p.tool_input) } }
      case 'afterAgentResponse':
        return { ...base, type: 'response', summary: s(p.text) }
      case 'stop':
        return s(p.status) === 'error' ? { ...base, type: 'stop-failure', error: 'The agent stopped with an error' } : { ...base, type: 'stop' }
      case 'subagentStart':
        return { ...base, type: 'subagent-start', title: s(p.subagent_type) || undefined }
      case 'subagentStop':
        return { ...base, type: 'subagent-stop', title: s(p.subagent_type) || undefined }
      case 'sessionEnd':
        return { ...base, type: 'session-end' }
      default:
        return { ...base, type: 'ignore' }
    }
  },
  decision(d) {
    if (!d) return '{}'
    return JSON.stringify(
      d.behavior === 'allow'
        ? { permission: 'allow' }
        : { permission: 'deny', user_message: 'Declined in Kumo.', agent_message: d.message || 'The user declined this in Kumo.' },
    )
  },
  context() {
    return '{}'
  },
  ack() {
    return '{}'
  },
  continueWith(text) {
    return JSON.stringify({ followup_message: text })
  },
  halt(raw) {
    if (raw === 'preToolUse' || raw === 'beforeShellExecution' || raw === 'beforeMCPExecution') return JSON.stringify({ permission: 'deny', user_message: 'Stopped from Kumo.', agent_message: 'The user stopped this session from Kumo. Stop working.' })
    if (raw === 'beforeSubmitPrompt') return JSON.stringify({ continue: false, user_message: 'Stopped from Kumo.' })
    return '{}'
  },
  routing: 'cursor',
}


const PALETTE = ['#5EC4B6', '#E6A15C', '#B58CF0', '#6FB3F2', '#EB7FA7', '#9CCB6A']

function genericAdapter(id: string): Adapter {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const name = id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return {
    ...claude,
    descriptor: {
      id,
      name,
      mark: name.charAt(0),
      color: PALETTE[h % PALETTE.length],
      capabilities: { approvals: true, contextInjection: true, launch: false },
    },
  }
}

const registry = new Map<string, Adapter>([
  ['claude-code', claude],
  ['antigravity', antigravity],
  ['codex', codex],
  ['gemini', gemini],
  ['cursor', cursor],
])

export function adapterFor(agent: string): Adapter {
  const known = registry.get(agent)
  if (known) return known
  const a = genericAdapter(agent)
  registry.set(agent, a)
  return a
}

export function descriptors(): AgentDescriptor[] {
  return [...registry.values()].map((a) => a.descriptor)
}

export function validAgent(name: string | null | undefined): string {
  if (!name) return 'claude-code'
  const n = name.toLowerCase()
  if (n === 'claude' || n === 'claude-code') return 'claude-code'
  if (n === 'agy' || n === 'antigravity') return 'antigravity'
  if (n === 'gemini' || n === 'gemini-cli') return 'gemini'
  if (n === 'codex' || n === 'codex-cli') return 'codex'
  return /^[a-z0-9-]{1,24}$/.test(n) ? n : 'claude-code'
}
