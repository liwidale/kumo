import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import type { AgentLimits, Approval, ApprovalRule, Decision, DecisionSource, HostInfo, LimitWindow, LivePreview, Phase, PlanItem, Session, Step } from '../shared/types'
import { adapterFor, codexLimits, type Adapter, type AgentEvent, type HookEnvelope } from './agents/adapters'
import { assessRisk, describeTool } from './agents/tools'
import { context } from './context'
import { history } from './history'
import { settings } from './settings'
import { basename, dataDir, debounce, id, log, pidAlive, readJson, truncate, writeJson } from './util'


const MAX_STEPS = 80
const MAX_FILES = 60
const STALE_MS = 20 * 60_000
const FORGET_DONE_MS = 3 * 60 * 60_000
const FORGET_ENDED_MS = 90_000

export type AlertKind = 'approval' | 'done' | 'error' | 'question' | 'waiting' | 'resolved'

interface Pending {
  approval: Approval
  resolve: (body: string) => void
  timer: NodeJS.Timeout
  raw: unknown[]
}

function hostFrom(env: HookEnvelope): HostInfo {
  const e = env.env
  const names = env.ancestors.map((a) => a.name.toLowerCase())
  const has = (re: RegExp): boolean => names.some((n) => re.test(n))
  const pids = env.ancestors.map((a) => a.pid).filter((p) => p > 0)
  const base = { pids, termProgram: e.TERM_PROGRAM, bundleId: e.__CFBundleIdentifier, tty: e.TTY }
  if (env.agent === 'antigravity') {
    if (has(/^antigravity(\.exe)?$/) || /antigravity/i.test(e.__CFBundleIdentifier || '')) return { ...base, kind: 'desktop', app: 'Antigravity' }
    return { ...base, kind: 'cli', app: terminalName(env) || 'Antigravity CLI' }
  }
  if (env.agent === 'cursor') return { ...base, kind: 'ide', app: 'Cursor' }
  if (env.agent === 'codex' && (has(/^codex(\.exe)?$/) && has(/^(code|cursor)(\.exe)?$/))) return { ...base, kind: 'ide', app: has(/^cursor/) ? 'Cursor' : 'VS Code' }
  if (env.agent === 'claude-code' && e.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop') return { ...base, kind: 'desktop', app: 'Claude' }
  if (e.TERM_PROGRAM === 'vscode' || has(/^(code|code - insiders)(\.exe)?$/) || e.VSCODE_GIT_IPC_HANDLE) {
    if (has(/^cursor(\.exe)?$/) || /cursor/i.test(e.__CFBundleIdentifier || '')) return { ...base, kind: 'ide', app: 'Cursor' }
    if (has(/^antigravity(\.exe)?$/)) return { ...base, kind: 'ide', app: 'Antigravity' }
    return { ...base, kind: 'ide', app: 'VS Code' }
  }
  if (has(/^(idea|pycharm|webstorm|goland|rider|clion)/)) return { ...base, kind: 'ide', app: 'JetBrains' }
  if (has(/^zed(\.exe)?$/)) return { ...base, kind: 'ide', app: 'Zed' }
  const term = terminalName(env)
  if (term) return { ...base, kind: 'cli', app: term }
  return { ...base, kind: 'unknown', app: 'Terminal' }
}

function terminalName(env: HookEnvelope): string | null {
  const e = env.env
  const names = env.ancestors.map((a) => a.name.toLowerCase())
  if (e.WT_SESSION || names.includes('windowsterminal.exe')) return 'Windows Terminal'
  switch (e.TERM_PROGRAM) {
    case 'Apple_Terminal':
      return 'Terminal'
    case 'iTerm.app':
      return 'iTerm'
    case 'WarpTerminal':
      return 'Warp'
    case 'ghostty':
      return 'Ghostty'
    case 'WezTerm':
      return 'WezTerm'
  }
  if (names.some((n) => n.startsWith('alacritty'))) return 'Alacritty'
  if (names.includes('powershell.exe') || names.includes('pwsh.exe')) return 'PowerShell'
  if (names.includes('cmd.exe')) return 'Command Prompt'
  return null
}

export function globMatch(pattern: string, text: string): boolean {
  const p = pattern.trim()
  if (!p || p === '*') return true
  const re = new RegExp(`^${p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'is')
  return re.test(text.trim())
}

function countLines(t: string): number {
  return t ? t.split('\n').length : 0
}

function livePreview(d: ReturnType<typeof describeTool>): LivePreview {
  const at = Date.now()
  if (d.kind === 'command') return { kind: 'command', command: d.subject.slice(0, 2000), added: 0, removed: 0, at }
  if (d.diff?.length) {
    const diff = d.diff.slice(0, 4).map((h) => ({ path: h.path, before: h.before.slice(0, 3000), after: h.after.slice(0, 3000) }))
    let added = 0
    let removed = 0
    for (const h of diff) {
      const b = new Set(h.before.split('\n'))
      const a = new Set(h.after.split('\n'))
      added += h.after.split('\n').filter((l) => !b.has(l)).length
      removed += h.before.split('\n').filter((l) => !a.has(l)).length
    }
    return { kind: 'edit', path: d.file?.path, diff, added, removed, at }
  }
  if (d.content != null && d.file) return { kind: 'write', path: d.file.path, content: d.content.slice(0, 3000), added: countLines(d.content), removed: 0, at }
  if (d.kind === 'read') return { kind: d.file ? 'read' : 'search', path: d.file?.path || d.subject, added: 0, removed: 0, at }
  if (d.kind === 'fetch') return { kind: 'fetch', path: d.subject, added: 0, removed: 0, at }
  return { kind: 'other', path: d.target, added: 0, removed: 0, at }
}

function parsePlan(tool: string, input: unknown): PlanItem[] | null {
  if (!/^(TodoWrite|update_plan|write_todos|todo_write|manage_task)$/.test(tool)) return null
  const i = (input || {}) as Record<string, unknown>
  const list = (Array.isArray(i.todos) ? i.todos : Array.isArray(i.plan) ? i.plan : Array.isArray(i.tasks) ? i.tasks : []) as Record<string, unknown>[]
  if (!list.length) return null
  const norm = (st: unknown): PlanItem['status'] => {
    const v = String(st || '').toLowerCase()
    if (/complete|done|finished/.test(v)) return 'done'
    if (/progress|active|doing|running/.test(v)) return 'active'
    return 'pending'
  }
  return list.slice(0, 20).map((t) => {
    const status = norm(t.status)
    const text = String((status === 'active' && t.activeForm) || t.content || t.step || t.description || t.title || t.text || '')
    return { text: truncate(text, 90), status }
  })
}

class SessionStore extends EventEmitter {
  private sessions = new Map<string, Session>()
  private pending = new Map<string, Pending>()
  private sessionRules = new Map<string, Set<string>>()
  private agentPids = new Map<string, number>()
  private sweepTimer: NodeJS.Timeout | null = null
  lastEventAt: Record<string, number> = {}
  private transcripts = new Map<string, string>()
  private haltAt = new Map<string, number>()
  private lastCost = new Map<string, number>()
  private limitsByAgent = new Map<string, AgentLimits>()
  private saveLimits = debounce(() => writeJson(dataDir('limits.json'), Object.fromEntries(this.limitsByAgent)), 1000)
  private contextReadAt = new Map<string, number>()

  start(): void {
    this.limitsByAgent = new Map(Object.entries(readJson<Record<string, AgentLimits>>(dataDir('limits.json'), {})))
    this.sweepTimer = setInterval(() => this.sweep(), 10_000)
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.resolve(adapterFor(p.approval.agent).decision(null))
    }
    this.pending.clear()
  }

  list(): Session[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(key: string): Session | undefined {
    return this.sessions.get(key)
  }

  approvals(): Approval[] {
    return [...this.pending.values()].map((p) => p.approval).sort((a, b) => a.createdAt - b.createdAt)
  }

  private changed(): void {
    this.emit('change')
  }

  private alert(kind: AlertKind, key: string): void {
    this.emit('alert', kind, key)
  }

  private ensure(env: HookEnvelope, ev: AgentEvent): Session {
    const key = `${env.agent}:${ev.sessionId}`
    let s = this.sessions.get(key)
    const now = Date.now()
    if (!s) {
      const cwd = ev.cwd || env.cwd
      s = {
        key,
        sessionId: ev.sessionId,
        agent: env.agent,
        cwd,
        project: this.projectName(cwd),
        phase: 'idle',
        phaseSince: now,
        startedAt: now,
        updatedAt: now,
        host: hostFrom(env),
        steps: [],
        files: [],
        toolCount: 0,
        errorCount: 0,
        alive: true,
        pendingContext: 0,
        subagents: [],
        queued: [],
      }
      this.sessions.set(key, s)
      if (cwd) this.rememberProject(cwd)
      history.session(key)
    }
    if (!s.alive && ev.type !== 'session-end') {
      s.alive = true
      s.notice = undefined
    }
    if (ev.cwd && ev.cwd !== s.cwd) {
      s.cwd = ev.cwd
      s.project = this.projectName(ev.cwd)
    }
    if (ev.model) s.model = ev.model
    if (ev.transcript) this.transcripts.set(key, ev.transcript)
    if (ev.title && ev.type === 'session-start') s.title = ev.title
    if (env.ancestors.length) {
      const host = hostFrom(env)
      s.host = host
      const agentProc = env.ancestors.find((a) => /^(claude|agy|antigravity|language_server|node|bun)(\.exe)?/i.test(a.name))
      const pid = Number(env.env.CLAUDE_PID) || agentProc?.pid
      if (pid) this.agentPids.set(key, pid)
    }
    s.updatedAt = now
    s.pendingContext = context.pendingFor(key).length
    return s
  }

  projectName(cwd: string): string {
    if (!cwd) return 'No project'
    const alias = settings.get().aliases[cwd]
    return alias || basename(cwd)
  }

  private rememberProject(cwd: string): void {
    const list = settings.get().recentProjects.filter((p) => p !== cwd)
    list.unshift(cwd)
    settings.set({ recentProjects: list.slice(0, 12) })
  }

  private setPhase(s: Session, phase: Phase): void {
    if (s.phase !== phase) {
      s.phase = phase
      s.phaseSince = Date.now()
    }
  }

  private push(s: Session, step: Omit<Step, 'id' | 'at'>): Step {
    const full: Step = { id: id(), at: Date.now(), ...step }
    s.steps.push(full)
    if (s.steps.length > MAX_STEPS) s.steps.splice(0, s.steps.length - MAX_STEPS)
    return full
  }

  private touch(s: Session, path: string, action: 'read' | 'edit' | 'create'): void {
    if (!path) return
    const f = s.files.find((x) => x.path === path)
    const now = Date.now()
    if (f) {
      f.count++
      f.at = now
      if (action !== 'read' && f.action === 'read') {
        f.action = action
        history.file(s.project, path)
      }
    } else {
      if (action !== 'read') history.file(s.project, path)
      s.files.push({ path, action, at: now, count: 1 })
      if (s.files.length > MAX_FILES) {
        const idx = s.files.findIndex((x) => x.action === 'read')
        s.files.splice(idx >= 0 ? idx : 0, 1)
      }
    }
  }

  async handle(env: HookEnvelope, onHold?: (approvalId: string) => void): Promise<string> {
    const adapter = adapterFor(env.agent)
    let ev: AgentEvent
    try {
      ev = adapter.normalize(env)
    } catch (e) {
      log('normalize failed', e)
      return ''
    }
    this.lastEventAt[env.agent] = Date.now()
    const stopping = this.sessions.get(`${env.agent}:${ev.sessionId}`)
    if (stopping?.stopping && ev.type !== 'limits') return this.sendHalt(stopping, adapter, env.event, ev)
    if (ev.type === 'ignore') {
      this.emit('heartbeat')
      return adapter.ack(ev)
    }
    if (ev.type === 'limits') {
      if (ev.limits?.length) this.setLimits(env.agent, ev.limits)
      const existing = this.sessions.get(`${env.agent}:${ev.sessionId}`)
      if (existing && (ev.context || ev.usage)) {
        if (ev.context) existing.context = ev.context
        if (ev.usage) this.setUsage(existing, ev.usage)
        this.changed()
      }
      return adapter.ack(ev)
    }
    const s = this.ensure(env, ev)
    let body = adapter.ack(ev)

    switch (ev.type) {
      case 'session-start':
        this.setPhase(s, 'idle')
        s.summary = undefined
        break

      case 'prompt':
      case 'turn-start': {
        this.resolveSessionPending(s.key, 'answered elsewhere')
        if (ev.prompt) {
          s.task = truncate(ev.prompt, 240)
          this.push(s, { kind: 'prompt', verb: 'Prompt', target: truncate(ev.prompt, 120), detail: ev.prompt })
        } else if (ev.type === 'turn-start' && !s.task && ev.transcript) {
          s.task = this.lastUserMessage(ev.transcript) || s.task
        }
        s.summary = undefined
        s.question = undefined
        s.notice = undefined
        s.preview = undefined
        s.subagents = s.subagents.filter((x) => x.status === 'running')
        this.setPhase(s, 'thinking')
        let text = context.deliver(s.key, s)
        if (s.queued.length) {
          const extra = `The user also sent this through Kumo:\n${s.queued.map((q) => `- ${q}`).join('\n')}`
          text = text ? `${text}\n\n${extra}` : extra
          this.push(s, { kind: 'prompt', verb: 'From Kumo', target: truncate(s.queued.join(' · '), 120), detail: s.queued.join('\n') })
          s.queued = []
        }
        if (text) {
          body = adapter.context(text, ev)
          this.push(s, { kind: 'context', verb: 'Context', target: 'Shared from Kumo', detail: text })
          s.pendingContext = 0
        }
        break
      }

      case 'tool-start': {
        const t = ev.tool!
        const d = describeTool(env.agent, t.name, t.input)
        s.toolCount++
        history.tool()
        s.current = this.push(s, { kind: 'tool', verb: d.verb, target: d.target, detail: d.detail, tool: t.name, toolUseId: t.useId })
        if (d.file) this.touch(s, d.file.path, d.file.action)
        s.preview = livePreview(d)
        const plan = parsePlan(t.name, t.input)
        if (plan) s.plan = plan
        if (d.kind === 'agent') {
          const i = (t.input || {}) as Record<string, unknown>
          this.addSubagent(s, t.useId || id(), String(i.subagent_type || i.agent_type || 'agent'), String(i.description || d.target || ''))
        }
        if (t.name === 'AskUserQuestion' || t.name === 'ask_question') {
          s.question = this.parseQuestion(t.input)
          this.setPhase(s, 'question')
          this.alert('question', s.key)
        } else {
          this.setPhase(s, 'working')
        }
        if (ev.gate && this.routed(adapter, t.name)) {
          this.changed()
          return this.hold(env, s, ev, [], onHold)
        }
        break
      }

      case 'gate': {
        const t = ev.tool!
        if (this.routed(adapter, t.name)) {
          this.changed()
          return this.hold(env, s, ev, [], onHold)
        }
        return adapter.ack(ev)
      }

      case 'response': {
        if (ev.summary) s.summary = truncate(ev.summary, 600)
        break
      }

      case 'tool-end': {
        const t = ev.tool!
        const step = [...s.steps].reverse().find((x) => x.kind === 'tool' && (t.useId ? x.toolUseId === t.useId : x.tool === t.name) && x.ok === undefined)
        if (step) step.ok = !t.error
        if (t.error) {
          s.errorCount++
          this.push(s, { kind: 'error', verb: 'Failed', target: describeTool(env.agent, t.name, t.input).verb, detail: t.error, tool: t.name })
        }
        if (t.useId) {
          this.resolveByToolUse(s.key, t.useId)
          const sub = s.subagents.find((x) => x.id === t.useId)
          if (sub) sub.status = 'done'
        }
        this.readContext(s)
        if (s.phase === 'question' || s.phase === 'waiting') s.question = undefined
        this.setPhase(s, 'thinking')
        break
      }

      case 'approval': {
        this.changed()
        return this.hold(env, s, ev, ev.suggestions || [], onHold)
      }

      case 'notification': {
        const n = ev.notification!
        if (n.kind === 'permission_prompt' || n.kind === 'agent_needs_input' || n.kind === 'elicitation_dialog') {
          if (![...this.pending.values()].some((p) => p.approval.sessionKey === s.key)) {
            s.notice = n.message || 'Waiting for you'
            this.setPhase(s, 'waiting')
            this.push(s, { kind: 'notice', verb: 'Waiting', target: truncate(n.message, 100) })
            this.alert('waiting', s.key)
          }
        } else if (n.kind === 'idle_prompt') {
          if (s.phase !== 'done') this.setPhase(s, 'idle')
        } else if (/limit|quota/i.test(n.kind) || /usage limit|rate limit/i.test(n.message)) {
          s.notice = n.message || 'Usage limit reached'
          this.push(s, { kind: 'notice', verb: 'Limit', target: truncate(n.message, 100) })
        }
        break
      }

      case 'stop': {
        this.resolveSessionPending(s.key, 'turn ended')
        if (s.queued.length) {
          const next = s.queued.join('\n\n')
          const reply = adapter.continueWith(next, ev)
          if (reply) {
            s.queued = []
            if (ev.summary) s.summary = truncate(ev.summary, 600)
            if (s.task) history.task({ at: Date.now(), agent: s.agent, project: s.project, task: s.task, summary: s.summary })
            s.task = truncate(next, 240)
            s.summary = undefined
            s.preview = undefined
            this.push(s, { kind: 'prompt', verb: 'From Kumo', target: truncate(next, 120), detail: next })
            this.setPhase(s, 'thinking')
            this.changed()
            return reply
          }
        }
        s.summary = ev.summary ? truncate(ev.summary, 600) : s.summary
        s.preview = undefined
        for (const sub of s.subagents) sub.status = 'done'
        this.readContext(s, true)
        s.current = undefined
        s.question = undefined
        s.notice = undefined
        this.push(s, { kind: 'done', verb: 'Done', target: s.summary ? truncate(s.summary, 120) : undefined, detail: s.summary })
        if (s.task) history.task({ at: Date.now(), agent: s.agent, project: s.project, task: s.task, summary: s.summary })
        this.setPhase(s, 'done')
        this.alert('done', s.key)
        break
      }

      case 'stop-failure': {
        this.resolveSessionPending(s.key, 'turn failed')
        s.current = undefined
        s.notice = truncate(ev.error, 200)
        this.push(s, { kind: 'error', verb: 'Stopped', target: truncate(ev.error, 100), detail: ev.error })
        this.setPhase(s, 'error')
        this.alert('error', s.key)
        break
      }

      case 'subagent-start':
        this.push(s, { kind: 'subagent', verb: 'Sub-agent', target: ev.title || 'started' })
        if (!s.subagents.some((x) => x.status === 'running' && x.type === (ev.title || 'agent'))) this.addSubagent(s, id(), ev.title || 'agent', '')
        break

      case 'subagent-stop': {
        this.push(s, { kind: 'subagent', verb: 'Sub-agent', target: `${ev.title || 'agent'} finished`, ok: true })
        const sub = [...s.subagents].reverse().find((x) => x.status === 'running' && (!ev.title || x.type === ev.title))
        if (sub) sub.status = 'done'
        break
      }

      case 'session-end':
        this.resolveSessionPending(s.key, 'session ended')
        this.end(s, 'Session closed')
        break
    }
    this.changed()
    return body
  }


  queue(key: string, text: string): boolean {
    const s = this.sessions.get(key)
    const t = text.trim()
    if (!s || !t) return false
    s.queued.push(t.slice(0, 4000))
    this.push(s, { kind: 'notice', verb: 'Queued', target: truncate(t, 100) })
    this.changed()
    return true
  }

  unqueue(key: string, index: number): void {
    const s = this.sessions.get(key)
    if (!s) return
    s.queued.splice(index, 1)
    this.changed()
  }

  requestStop(key: string, force = false): { ok: boolean; error?: string } {
    const s = this.sessions.get(key)
    if (!s) return { ok: false, error: 'That session is gone.' }
    if (force) {
      const pid = this.agentPids.get(key)
      if (!pid) return { ok: false, error: 'Kumo doesn’t know this agent’s process.' }
      try {
        process.kill(pid)
      } catch (e) {
        return { ok: false, error: `Couldn’t end the process: ${(e as Error).message}` }
      }
      this.resolveSessionPending(key, 'stopped', 'stop')
      this.end(s, 'Ended from Kumo')
      this.changed()
      return { ok: true }
    }
    s.stopping = true
    s.queued = []
    this.haltAt.set(key, Date.now())
    for (const [pid, p] of this.pending) {
      if (p.approval.sessionKey !== key) continue
      clearTimeout(p.timer)
      this.pending.delete(pid)
      p.resolve(adapterFor(p.approval.agent).halt(p.approval.agent === 'antigravity' ? 'PreToolUse' : p.approval.agent === 'cursor' ? 'preToolUse' : p.approval.agent === 'gemini' ? 'BeforeTool' : 'PermissionRequest', { type: 'approval', sessionId: s.sessionId, cwd: s.cwd }))
      this.record(p.approval, 'deny', 'stop')
      this.alert('resolved', key)
    }
    this.push(s, { kind: 'notice', verb: 'Stopping', target: 'Asked the agent to stop' })
    this.changed()
    return { ok: true }
  }

  private sendHalt(s: Session, adapter: Adapter, raw: string, ev: AgentEvent): string {
    const body = adapter.halt(raw, ev)
    this.haltAt.set(s.key, Date.now())
    const finished = ev.type === 'stop' || ev.type === 'stop-failure' || ev.type === 'session-end'
    if (finished || s.agent === 'claude-code' || s.agent === 'codex' || s.agent === 'gemini') this.settleStop(s)
    this.changed()
    return body
  }

  private settleStop(s: Session): void {
    s.stopping = false
    s.current = undefined
    s.preview = undefined
    s.notice = 'Stopped from Kumo'
    for (const sub of s.subagents) sub.status = 'done'
    this.push(s, { kind: 'notice', verb: 'Stopped', target: 'from Kumo' })
    this.setPhase(s, 'idle')
  }

  private setUsage(s: Session, u: NonNullable<Session['usage']>): void {
    s.usage = { ...s.usage, ...Object.fromEntries(Object.entries(u).filter(([, v]) => v != null)) }
    if (u.costUsd != null) {
      const prev = this.lastCost.get(s.key)
      if (prev != null && u.costUsd > prev) history.cost(u.costUsd - prev)
      this.lastCost.set(s.key, u.costUsd)
    }
  }


  private record(a: Pick<Approval, 'agent' | 'project' | 'cwd' | 'title' | 'subject' | 'kind' | 'risk'>, behavior: 'allow' | 'deny' | 'none', by: DecisionSource): void {
    history.decision({ id: id(), at: Date.now(), agent: a.agent, project: a.project, cwd: a.cwd || '', title: a.title, subject: a.subject, kind: a.kind, risk: a.risk, behavior, by })
  }

  private matchRule(agent: string, cwd: string, tool: string, d: ReturnType<typeof describeTool>): ApprovalRule | undefined {
    const rules = settings.get().approvals.rules || []
    const norm = (x: string): string => x.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    const hit = (r: ApprovalRule): boolean => {
      if (r.agent !== '*' && r.agent !== agent) return false
      if (r.project !== '*' && norm(r.project) !== norm(cwd)) return false
      if (r.tool !== '*' && !(r.tool === 'command' ? d.kind === 'command' : r.tool.toLowerCase() === tool.toLowerCase())) return false
      return globMatch(r.pattern, d.subject)
    }
    return rules.find((r) => r.action === 'deny' && hit(r)) || rules.find((r) => r.action === 'allow' && hit(r))
  }

  private routed(adapter: Adapter, tool: string): boolean {
    const cfg = settings.get().approvals
    if (!cfg.enabled || !adapter.routing || !cfg[adapter.routing]) return false
    return !adapter.guarded || adapter.guarded.has(tool)
  }

  private end(s: Session, why: string): void {
    s.alive = false
    s.current = undefined
    s.notice = s.phase === 'error' && s.notice ? s.notice : why
    this.setPhase(s, 'ended')
    this.sessionRules.delete(s.key)
  }

  private parseQuestion(input: unknown): { text: string; options: string[] } {
    const i = (input || {}) as Record<string, unknown>
    const qs = Array.isArray(i.questions) ? (i.questions as Record<string, unknown>[]) : []
    const q = qs[0] || i
    const opts = Array.isArray(q.options) ? (q.options as unknown[]) : []
    return {
      text: truncate(String(q.question || q.Question || q.text || 'The agent has a question for you'), 300),
      options: opts
        .map((o) => (typeof o === 'string' ? o : String((o as Record<string, unknown>)?.label ?? '')))
        .filter(Boolean)
        .slice(0, 4),
    }
  }

  limits(): AgentLimits[] {
    const now = Date.now()
    return [...this.limitsByAgent.values()]
      .map((l) => ({ ...l, windows: l.windows.map((w) => (w.resetsAt && w.resetsAt < now ? { ...w, usedPct: 0, resetsAt: undefined } : w)) }))
      .filter((l) => l.windows.length && now - l.updatedAt < 8 * 86_400_000)
  }

  private setLimits(agent: string, windows: LimitWindow[]): void {
    const prev = this.limitsByAgent.get(agent)
    const same = prev && JSON.stringify(prev.windows.map((w) => [w.kind, Math.round(w.usedPct)])) === JSON.stringify(windows.map((w) => [w.kind, Math.round(w.usedPct)]))
    this.limitsByAgent.set(agent, { agent, windows, updatedAt: Date.now() })
    this.saveLimits()
    if (!same) this.changed()
  }

  private addSubagent(s: Session, subId: string, type: string, description: string): void {
    const existing = s.subagents.find((x) => x.id === subId)
    if (existing) {
      Object.assign(existing, { type, description: truncate(description, 80), status: 'running', at: Date.now() })
      return
    }
    s.subagents.push({ id: subId, type, description: truncate(description, 80), status: 'running', at: Date.now() })
    if (s.subagents.length > 6) s.subagents.splice(0, s.subagents.length - 6)
  }

  private readContext(s: Session, force = false): void {
    const file = this.transcripts.get(s.key)
    if (!file) return
    const last = this.contextReadAt.get(s.key) || 0
    if (!force && Date.now() - last < 4000) return
    this.contextReadAt.set(s.key, Date.now())
    try {
      const fd = fs.openSync(file, 'r')
      const size = fs.fstatSync(fd).size
      const len = Math.min(size, 256_000)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, size - len)
      fs.closeSync(fd)
      const lines = buf.toString('utf8').split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        if (!line.includes('"usage"') && !line.includes('"rate_limits"')) continue
        try {
          const j = JSON.parse(line) as Record<string, any>
          if (j.payload?.rate_limits && typeof j.payload.rate_limits === 'object') {
            const w = codexLimits(j.payload.rate_limits)
            if (w.length) this.setLimits(s.agent, w)
          }
          const total = j.payload?.info?.total_token_usage
          if (total && typeof total === 'object') this.setUsage(s, { inTokens: (total.input_tokens || 0) + (total.cached_input_tokens || 0), outTokens: total.output_tokens || 0 })
          const u = j.message?.usage || j.usage || j.payload?.info?.last_token_usage
          if (!u) continue
          const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cached_input_tokens || 0) + (u.output_tokens || 0)
          if (!used) continue
          const model = String(j.message?.model || s.model || '')
          const declared = Number(j.payload?.info?.model_context_window) || 0
          const window = declared || (/\[1m\]|-1m|1m-context/i.test(model + (s.model || '')) || used > 200_000 ? 1_000_000 : 200_000)
          s.context = { used: Math.min(used, window), window }
          return
        } catch {
        }
      }
    } catch {
    }
  }

  private lastUserMessage(transcript: string): string | undefined {
    try {
      const fd = fs.openSync(transcript, 'r')
      const size = fs.fstatSync(fd).size
      const len = Math.min(size, 64_000)
      const buf = Buffer.alloc(len)
      fs.readSync(fd, buf, 0, len, size - len)
      fs.closeSync(fd)
      const lines = buf.toString('utf8').split('\n').reverse()
      for (const line of lines) {
        if (!line.includes('user')) continue
        try {
          const j = JSON.parse(line) as Record<string, unknown>
          const txt = (j.userMessage || j.user_message || (j.type === 'user' && j.content) || j.text) as unknown
          if (typeof txt === 'string' && txt.trim()) return truncate(txt, 240)
        } catch {
        }
      }
    } catch {
    }
    return undefined
  }


  private hold(env: HookEnvelope, s: Session, ev: AgentEvent, raw: unknown[], onHold?: (approvalId: string) => void): Promise<string> {
    const adapter = adapterFor(env.agent)
    const cfg = settings.get().approvals
    const t = ev.tool!
    if (!cfg.enabled) return Promise.resolve(adapter.decision(null))
    const d = describeTool(env.agent, t.name, t.input)
    const { risk, reason } = assessRisk(d)
    const meta = { agent: env.agent, project: s.project, cwd: s.cwd, title: d.title, subject: d.subject, kind: d.kind, risk }
    const rule = this.matchRule(env.agent, s.cwd, t.name, d)
    if (rule) {
      this.push(s, { kind: 'approval', verb: rule.action === 'allow' ? 'Allowed' : 'Declined', target: `${d.verb} ${d.target || ''} (your rule)`.trim(), ok: rule.action === 'allow' })
      this.record(meta, rule.action, 'rule')
      return Promise.resolve(adapter.decision({ id: '', behavior: rule.action, message: rule.action === 'deny' ? 'Blocked by a rule in Kumo.' : undefined }, raw))
    }
    const rules = this.sessionRules.get(s.key)
    if (rules?.has(t.name) || rules?.has(`${t.name}\u0000${d.subject}`)) {
      this.push(s, { kind: 'approval', verb: 'Allowed', target: `${d.verb} ${d.target || ''} (this session)`.trim(), ok: true })
      this.record(meta, 'allow', 'session')
      return Promise.resolve(adapter.decision({ id: '', behavior: 'allow' }))
    }
    if (settings.get().paused) return Promise.resolve(adapter.decision(null))
    const now = Date.now()
    const timeoutMs = Math.max(15, Math.min(600, cfg.timeoutSec)) * 1000
    const suggestions = raw
      .map((r, i) => {
        const o = (r || {}) as Record<string, unknown>
        const label = typeof o.description === 'string' ? o.description : this.describeRule(o)
        return label ? { id: `s${i}`, label } : null
      })
      .filter((x): x is { id: string; label: string } => Boolean(x))
      .slice(0, 2)
    const approval: Approval = {
      id: id(),
      sessionKey: s.key,
      agent: env.agent,
      project: s.project,
      createdAt: now,
      expiresAt: now + timeoutMs,
      tool: t.name,
      kind: d.kind,
      title: d.title,
      subject: d.subject,
      description: d.detail !== d.subject ? d.detail : undefined,
      cwd: s.cwd,
      diff: d.diff?.map((h) => ({ ...h, before: h.before.slice(0, 4000), after: h.after.slice(0, 4000) })),
      content: d.content?.slice(0, 4000),
      risk,
      riskReason: reason,
      suggestions,
    }
    this.setPhase(s, 'waiting')
    s.notice = undefined
    this.push(s, { kind: 'approval', verb: 'Asks', target: d.title, detail: d.subject, tool: t.name, toolUseId: t.useId })

    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => this.expire(approval.id), timeoutMs)
      this.pending.set(approval.id, { approval, resolve, timer, raw })
      onHold?.(approval.id)
      this.alert('approval', s.key)
      this.changed()
    })
  }

  private describeRule(o: Record<string, unknown>): string {
    const rules = Array.isArray(o.rules) ? (o.rules as Record<string, unknown>[]) : []
    const dest = o.destination === 'localSettings' || o.destination === 'projectSettings' ? 'in this project' : o.destination === 'session' ? 'this session' : ''
    if (o.type === 'addRules' && rules.length) {
      const r = rules[0]
      const what = r.ruleContent ? `${r.toolName}(${truncate(String(r.ruleContent), 40)})` : String(r.toolName || 'this tool')
      return `Always allow ${what}${dest ? ` ${dest}` : ''}`
    }
    if (o.type === 'setMode' && o.mode === 'acceptEdits') return 'Accept all edits this session'
    if (typeof o.rule === 'string') return `Always allow ${o.rule}`
    return ''
  }

  decide(d: Decision): boolean {
    const p = this.pending.get(d.id)
    if (!p) return false
    clearTimeout(p.timer)
    this.pending.delete(d.id)
    const s = this.sessions.get(p.approval.sessionKey)
    const adapter = adapterFor(p.approval.agent)
    if ((d.remember === 'session' || d.remember === 'exact') && d.behavior === 'allow') {
      const set = this.sessionRules.get(p.approval.sessionKey) ?? new Set<string>()
      set.add(d.remember === 'exact' ? `${p.approval.tool}\u0000${p.approval.subject}` : p.approval.tool)
      this.sessionRules.set(p.approval.sessionKey, set)
    }
    if (d.remember === 'rule-allow' || d.remember === 'rule-deny') this.addRuleFrom(p.approval, d.remember === 'rule-allow' ? 'allow' : 'deny')
    p.resolve(adapter.decision(d, p.raw))
    this.record(p.approval, d.behavior, d.remember === 'session' || d.remember === 'exact' ? 'session' : 'you')
    if (s) {
      this.push(s, { kind: 'approval', verb: d.behavior === 'allow' ? 'Allowed' : 'Declined', target: p.approval.title, ok: d.behavior === 'allow' })
      this.setPhase(s, d.behavior === 'allow' ? 'working' : 'thinking')
    }
    this.alert('resolved', p.approval.sessionKey)
    this.changed()
    return true
  }

  private addRuleFrom(a: Approval, action: 'allow' | 'deny'): void {
    const words = a.subject.trim().split(/\s+/)
    const pattern = a.kind === 'command' ? (action === 'allow' && words.length > 2 ? `${words.slice(0, 2).join(' ')} *` : a.subject.trim()) : a.subject
    const rule: ApprovalRule = { id: id(), action, agent: '*', project: a.cwd || '*', tool: a.kind === 'command' ? 'command' : a.tool, pattern, createdAt: Date.now() }
    const cfg = settings.get().approvals
    settings.set({ approvals: { ...cfg, rules: [...(cfg.rules || []), rule] } })
  }

  private expire(approvalId: string): void {
    const p = this.pending.get(approvalId)
    if (!p) return
    this.pending.delete(approvalId)
    this.record(p.approval, 'none', 'timeout')
    p.resolve(adapterFor(p.approval.agent).decision(null))
    const s = this.sessions.get(p.approval.sessionKey)
    if (s) {
      s.notice = `Approval moved to ${s.host.app}`
      this.push(s, { kind: 'notice', verb: 'Timed out', target: 'Answer in the agent' })
      this.setPhase(s, 'waiting')
    }
    this.alert('resolved', p.approval.sessionKey)
    this.changed()
  }

  abandoned(approvalId: string): void {
    const p = this.pending.get(approvalId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(approvalId)
    this.record(p.approval, 'none', 'agent')
    this.alert('resolved', p.approval.sessionKey)
    this.changed()
  }

  private resolveSessionPending(key: string, why: string, by: DecisionSource = 'agent'): void {
    for (const [pid, p] of this.pending) {
      if (p.approval.sessionKey !== key) continue
      clearTimeout(p.timer)
      this.pending.delete(pid)
      p.resolve(adapterFor(p.approval.agent).decision(null))
      this.record(p.approval, 'none', by)
      log('approval dropped:', why)
      this.alert('resolved', key)
    }
  }

  private resolveByToolUse(key: string, useId: string): void {
    for (const [pid, p] of this.pending) {
      if (p.approval.sessionKey !== key) continue
      const s = this.sessions.get(key)
      const step = s?.steps.find((x) => x.kind === 'approval' && x.toolUseId === useId)
      if (!step) continue
      clearTimeout(p.timer)
      this.pending.delete(pid)
      p.resolve(adapterFor(p.approval.agent).decision(null))
      this.alert('resolved', key)
    }
  }

  latestApproval(key: string): string | undefined {
    let best: Approval | undefined
    for (const p of this.pending.values()) if (p.approval.sessionKey === key && (!best || p.approval.createdAt > best.createdAt)) best = p.approval
    return best?.id
  }

  dismiss(key: string): void {
    this.resolveSessionPending(key, 'dismissed')
    this.sessions.delete(key)
    this.agentPids.delete(key)
    this.changed()
  }

  revalidate(): void {
    this.sweep(true)
  }

  private sweep(force = false): void {
    const now = Date.now()
    let dirty = force
    for (const s of this.sessions.values()) {
      if (s.stopping && now - (this.haltAt.get(s.key) || 0) > 20_000) {
        this.settleStop(s)
        dirty = true
      }
      const pid = this.agentPids.get(s.key)
      if (s.alive && pid && !pidAlive(pid)) {
        this.resolveSessionPending(s.key, 'process exited')
        this.end(s, `${adapterFor(s.agent).descriptor.name} is no longer running`)
        dirty = true
        continue
      }
      const quiet = now - s.updatedAt
      if (s.alive && (s.phase === 'working' || s.phase === 'thinking') && quiet > STALE_MS) {
        this.setPhase(s, 'idle')
        s.current = undefined
        s.notice = 'No activity for a while'
        dirty = true
      }
      if ((s.phase === 'ended' && quiet > FORGET_ENDED_MS) || (!s.alive && quiet > FORGET_DONE_MS) || ((s.phase === 'done' || s.phase === 'idle') && quiet > FORGET_DONE_MS)) {
        this.sessions.delete(s.key)
        this.agentPids.delete(s.key)
        dirty = true
      }
    }
    if (dirty) this.changed()
  }

  refreshNames(): void {
    for (const s of this.sessions.values()) s.project = this.projectName(s.cwd)
    this.changed()
  }

  refreshContextCounts(): void {
    for (const s of this.sessions.values()) s.pendingContext = context.pendingFor(s.key).length
    this.changed()
  }
}

export const sessions = new SessionStore()
