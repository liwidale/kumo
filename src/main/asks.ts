import { EventEmitter } from 'node:events'
import type { AskRequest } from '../shared/types'
import { adapterFor, validAgent } from './agents/adapters'
import { sessions } from './sessions'
import { id, truncate } from './util'

const ASK_MS = 9 * 60_000 + 30_000
const MAX_ASKS = 8

export interface McpCall {
  tool: string
  arguments: Record<string, unknown>
  context: { ancestors: { pid: number; name: string }[]; cwd: string; agent: string }
}

export interface McpReply {
  text: string
  isError?: boolean
}

export interface AgentNote {
  agent: string
  project: string
  title: string
  text: string
  sessionKey?: string
}

interface Pending {
  ask: AskRequest
  done: (reply: McpReply) => void
  timer: NodeJS.Timeout
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

class Asks extends EventEmitter {
  private pending = new Map<string, Pending>()

  list(): AskRequest[] {
    return [...this.pending.values()].map((p) => p.ask).sort((a, b) => a.createdAt - b.createdAt)
  }

  private where(call: McpCall): { agent: string; cwd: string; project: string; sessionKey?: string } {
    const agent = validAgent(call.context.agent || 'claude-code')
    const pids = new Set(call.context.ancestors.map((a) => a.pid))
    const own = sessions.list().filter((s) => s.alive && s.agent === agent)
    const near = call.context.ancestors.slice(0, 4).map((a) => a.pid)
    const match =
      own.find((s) => s.host.pids.some((p) => near.includes(p))) ||
      own.find((s) => s.cwd === call.context.cwd) ||
      own.find((s) => s.host.pids.some((p) => pids.has(p))) ||
      (own.length === 1 ? own[0] : undefined)
    const cwd = match?.cwd || call.context.cwd
    return { agent: match?.agent || agent, cwd, project: match?.project || sessions.projectName(cwd), sessionKey: match?.key }
  }

  handle(call: McpCall, onAbort: (cancel: () => void) => void): Promise<McpReply> {
    const at = this.where(call)
    if (call.tool === 'notify_user') {
      const text = str(call.arguments.message, 600)
      if (!text) return Promise.resolve({ text: 'message is required.', isError: true })
      const note: AgentNote = { agent: at.agent, project: at.project, title: str(call.arguments.title, 80), text, sessionKey: at.sessionKey }
      this.emit('note', note)
      return Promise.resolve({ text: 'Shown to the person in Kumo.' })
    }
    if (call.tool !== 'ask_user') return Promise.resolve({ text: `Unknown tool ${truncate(call.tool, 40)}.`, isError: true })
    const question = str(call.arguments.question, 600)
    if (!question) return Promise.resolve({ text: 'question is required.', isError: true })
    if (this.pending.size >= MAX_ASKS) return Promise.resolve({ text: 'Too many questions are waiting already. Ask in this conversation instead.', isError: true })
    const options = (Array.isArray(call.arguments.options) ? call.arguments.options : [])
      .map((o) => str(o, 80))
      .filter(Boolean)
      .filter((o, i, a) => a.indexOf(o) === i)
      .slice(0, 4)
    const allowText = call.arguments.allow_text !== false || options.length === 0
    const now = Date.now()
    const ask: AskRequest = { id: id(), agent: at.agent, project: at.project, cwd: at.cwd, sessionKey: at.sessionKey, question, options, allowText, createdAt: now, expiresAt: now + ASK_MS }
    return new Promise<McpReply>((resolve) => {
      const timer = setTimeout(() => this.finish(ask.id, { text: "The person didn't answer in time. Continue with your best judgment, or ask again in this conversation." }), ASK_MS)
      this.pending.set(ask.id, { ask, done: resolve, timer })
      onAbort(() => this.finish(ask.id, null))
      this.emit('change')
      this.emit('alert', ask)
    })
  }

  answer(askId: string, text: string | null): boolean {
    const p = this.pending.get(askId)
    if (!p) return false
    const name = adapterFor(p.ask.agent).descriptor.name
    this.finish(askId, text === null ? { text: `The person skipped this question. Decide yourself or ask in the ${name} conversation.` } : { text: `The person answered: ${text}` })
    return true
  }

  private finish(askId: string, reply: McpReply | null): void {
    const p = this.pending.get(askId)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(askId)
    if (reply) p.done(reply)
    this.emit('change')
    this.emit('resolved', p.ask)
  }

  stop(): void {
    for (const id of [...this.pending.keys()]) this.finish(id, { text: 'Kumo is closing. Ask in this conversation instead.', isError: true })
  }
}

export const asks = new Asks()
