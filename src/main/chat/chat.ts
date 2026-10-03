import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { ChatAttachment, ChatEvent, ChatMessage, ChatSendRequest, Conversation, ConversationSummary, Result, Session } from '../../shared/types'
import { isText, mimeOf } from '../context'
import { getSecret } from '../secrets'
import { sessions } from '../sessions'
import { settings } from '../settings'
import { basename, dataDir, ensureDir, id, log, readJson, truncate, which, writeJson } from '../util'
import { providerDef } from './providers'


const SYSTEM = `You are Kumo, a calm and precise coding companion that lives at the top of the user's screen, next to their AI coding agents.
Answer briefly and concretely. Prefer short paragraphs and bullet points. Use fenced code blocks with a language tag for code.
When the user shares files, screenshots or an agent session, ground your answer in them. If something is unclear, say what you would need.`

const TEXT_LIMIT = 200_000
const IMAGE_LIMIT = 5_000_000

type Part = { type: 'text'; text: string } | { type: 'image'; mime: string; data: string } | { type: 'pdf'; data: string; name: string }

class ChatService extends EventEmitter {
  private convs = new Map<string, Conversation>()
  private running = new Map<string, { abort: AbortController; child?: ChildProcess }>()
  private loaded = false

  private dir(): string {
    return dataDir('chats')
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    if (!settings.get().privacy.keepChats) return
    try {
      ensureDir(this.dir())
      const cutoff = Date.now() - settings.get().privacy.historyDays * 86_400_000
      for (const f of fs.readdirSync(this.dir())) {
        if (!f.endsWith('.json')) continue
        const c = readJson<Conversation | null>(path.join(this.dir(), f), null)
        if (!c) continue
        if (c.updatedAt < cutoff) {
          fs.rmSync(path.join(this.dir(), f), { force: true })
          continue
        }
        for (const m of c.messages) m.streaming = false
        this.convs.set(c.id, c)
      }
    } catch (e) {
      log('chat load failed', e)
    }
  }

  private persist(c: Conversation): void {
    if (!settings.get().privacy.keepChats) return
    try {
      writeJson(path.join(this.dir(), `${c.id}.json`), c)
    } catch (e) {
      log('chat save failed', e)
    }
  }

  list(): ConversationSummary[] {
    this.load()
    return [...this.convs.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, count: c.messages.length }))
  }

  get(cid: string): Conversation | null {
    this.load()
    return this.convs.get(cid) || null
  }

  remove(cid: string): void {
    this.stop(cid)
    this.convs.delete(cid)
    fs.rmSync(path.join(this.dir(), `${cid}.json`), { force: true })
  }

  clearAll(): void {
    for (const k of this.running.keys()) this.stop(k)
    this.convs.clear()
    fs.rmSync(this.dir(), { recursive: true, force: true })
  }

  stop(cid: string): void {
    const r = this.running.get(cid)
    if (!r) return
    r.abort.abort()
    r.child?.kill()
    this.running.delete(cid)
  }

  private emitEvent(e: ChatEvent): void {
    this.emit('event', e)
  }

  async send(req: ChatSendRequest): Promise<Result<string>> {
    this.load()
    const def = providerDef(req.provider)
    if (!def) return { ok: false, error: 'Choose a model provider first.' }
    const text = req.text.trim()
    if (!text && !req.attachments.length) return { ok: false, error: 'Nothing to send.' }
    let c = req.conversationId ? this.convs.get(req.conversationId) : undefined
    const now = Date.now()
    if (!c) {
      c = { id: id(), title: truncate(text || req.attachments[0]?.name || 'New chat', 48), createdAt: now, updatedAt: now, messages: [], sessionKey: req.sessionKey }
      this.convs.set(c.id, c)
    }
    if (this.running.has(c.id)) return { ok: false, error: 'Still answering - stop it first.' }
    if (req.sessionKey) c.sessionKey = req.sessionKey
    const user: ChatMessage = { id: id(), role: 'user', text, at: now, attachments: req.attachments, sessionKey: req.sessionKey }
    const assistant: ChatMessage = { id: id(), role: 'assistant', text: '', at: now, provider: req.provider, model: req.model, streaming: true }
    c.messages.push(user, assistant)
    c.updatedAt = now
    const conv = c
    this.emitEvent({ type: 'start', conversationId: conv.id, userMessage: user, assistantId: assistant.id })

    const abort = new AbortController()
    this.running.set(conv.id, { abort })
    const onDelta = (t: string): void => {
      assistant.text += t
      this.emitEvent({ type: 'delta', conversationId: conv.id, assistantId: assistant.id, text: t })
    }
    const system = this.systemPrompt(conv)
    ;(async () => {
      try {
        if (def.kind === 'anthropic') await this.anthropic(conv, req.model || def.defaultModel, system, abort.signal, onDelta)
        else if (def.kind === 'claude-cli') await this.claudeCli(conv, req.model, system, abort, onDelta)
        else await this.openai(def.id, conv, req.model || def.defaultModel, system, abort.signal, onDelta)
        assistant.streaming = false
        if (!assistant.text.trim()) assistant.text = '_(no answer)_'
        this.emitEvent({ type: 'done', conversationId: conv.id, assistantId: assistant.id })
      } catch (e) {
        assistant.streaming = false
        const aborted = abort.signal.aborted
        assistant.error = aborted ? undefined : (e as Error).message || 'Something went wrong'
        if (aborted) this.emitEvent({ type: 'done', conversationId: conv.id, assistantId: assistant.id })
        else this.emitEvent({ type: 'error', conversationId: conv.id, assistantId: assistant.id, error: assistant.error! })
      } finally {
        this.running.delete(conv.id)
        conv.updatedAt = Date.now()
        this.persist(conv)
      }
    })()
    return { ok: true, value: conv.id }
  }

  private systemPrompt(c: Conversation): string {
    const parts = [SYSTEM]
    const s = c.sessionKey ? sessions.get(c.sessionKey) : undefined
    if (s && settings.get().chat.includeContext) parts.push(sessionBrief(s))
    return parts.join('\n\n')
  }


  private partsFor(m: ChatMessage, expand: boolean): Part[] {
    const parts: Part[] = []
    for (const a of m.attachments || []) {
      if (!expand) {
        parts.push({ type: 'text', text: `[Attached earlier: ${a.name}]` })
        continue
      }
      parts.push(...attachmentParts(a))
    }
    if (m.text) parts.push({ type: 'text', text: m.text })
    return parts
  }

  private history(c: Conversation): { role: 'user' | 'assistant'; parts: Part[] }[] {
    const msgs = c.messages.filter((m) => !m.streaming && !m.error && (m.text || m.attachments?.length))
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    return msgs.slice(-24).map((m) => ({ role: m.role, parts: this.partsFor(m, m === lastUser) }))
  }


  private async anthropic(c: Conversation, model: string, system: string, signal: AbortSignal, onDelta: (t: string) => void): Promise<void> {
    const key = getSecret('chat.anthropic')
    if (!key) throw new Error('Add your Anthropic API key in Settings → Chat.')
    const messages = this.history(c).map((m) => ({
      role: m.role,
      content: m.parts.map((p) =>
        p.type === 'text'
          ? { type: 'text', text: p.text }
          : p.type === 'image'
            ? { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } }
            : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data }, title: p.name },
      ),
    }))
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 8192, system, messages, stream: true }),
    })
    if (!r.ok) throw new Error(await apiError(r, model))
    await readSse(r, (data) => {
      const j = JSON.parse(data) as { type: string; delta?: { type: string; text?: string }; error?: { message?: string } }
      if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta' && j.delta.text) onDelta(j.delta.text)
      if (j.type === 'error') throw new Error(j.error?.message || 'The provider returned an error')
    })
  }


  private async openai(pid: string, c: Conversation, model: string, system: string, signal: AbortSignal, onDelta: (t: string) => void): Promise<void> {
    const def = providerDef(pid)!
    const key = getSecret(`chat.${pid}`)
    if (def.needsKey && !key) throw new Error(`Add your ${def.name} API key in Settings → Chat.`)
    if (!model) throw new Error('Pick a model first.')
    const base = def.baseUrl()
    if (!base) throw new Error('Set the base URL for this provider in Settings → Chat.')
    const messages: unknown[] = [{ role: 'system', content: system }]
    for (const m of this.history(c)) {
      const hasMedia = m.parts.some((p) => p.type === 'image')
      if (!hasMedia) {
        messages.push({ role: m.role, content: m.parts.map((p) => (p.type === 'text' ? p.text : `[${p.type === 'pdf' ? p.name : 'image'} - this provider can't read it]`)).join('\n\n') })
      } else {
        messages.push({
          role: m.role,
          content: m.parts.map((p) =>
            p.type === 'text' ? { type: 'text', text: p.text } : p.type === 'image' ? { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } } : { type: 'text', text: `[PDF ${p.name} not supported here]` },
          ),
        })
      }
    }
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (key) headers.Authorization = `Bearer ${key}`
    if (pid === 'openrouter') {
      headers['X-Title'] = 'Kumo'
    }
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', signal, headers, body: JSON.stringify({ model, messages, stream: true }) })
    if (!r.ok) throw new Error(await apiError(r, model))
    await readSse(r, (data) => {
      if (data === '[DONE]') return
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } }
      if (j.error) throw new Error(j.error.message || 'The provider returned an error')
      const t = j.choices?.[0]?.delta?.content
      if (t) onDelta(t)
    })
  }


  private claudeCli(c: Conversation, model: string, system: string, abort: AbortController, onDelta: (t: string) => void): Promise<void> {
    const bin = which('claude')
    if (!bin) return Promise.reject(new Error('Claude Code is not installed.'))
    const last = [...c.messages].reverse().find((m) => m.role === 'user')!
    const dirs = new Set<string>()
    const lines: string[] = []
    for (const a of last.attachments || []) {
      if (a.kind === 'text') {
        lines.push(`Snippet "${a.name}":\n\`\`\`\n${readSnippet(a)}\n\`\`\``)
      } else if (a.path) {
        dirs.add(a.kind === 'folder' ? a.path : path.dirname(a.path))
        lines.push(`Attached ${a.kind === 'window' ? 'screenshot' : a.kind}: ${a.path}`)
      }
    }
    const prompt = [lines.join('\n'), last.text].filter(Boolean).join('\n\n')
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--append-system-prompt', system, '--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep', '--strict-mcp-config']
    if (model && model !== 'default') args.push('--model', model)
    if (c.remoteId) args.push('--resume', c.remoteId)
    for (const d of dirs) args.push('--add-dir', d)
    const s = c.sessionKey ? sessions.get(c.sessionKey) : undefined
    const cwd = s?.cwd && fs.existsSync(s.cwd) ? s.cwd : dataDir()
    return new Promise((resolve, reject) => {
      const win = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)
      const child = spawn(win ? 'cmd.exe' : bin, win ? ['/d', '/s', '/c', bin, ...args] : args, {
        cwd,
        env: { ...process.env, KUMO_INTERNAL: '1' },
        windowsHide: true,
      })
      this.running.set(c.id, { abort, child })
      let buf = ''
      let streamed = false
      let err = ''
      let resultText = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        buf += chunk
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (!line) continue
          try {
            const j = JSON.parse(line) as Record<string, any>
            if (j.session_id) c.remoteId = j.session_id
            if (j.type === 'stream_event' && j.event?.type === 'content_block_delta' && j.event.delta?.type === 'text_delta') {
              streamed = true
              onDelta(j.event.delta.text)
            } else if (j.type === 'assistant' && !streamed) {
              for (const part of j.message?.content || []) if (part.type === 'text') onDelta(part.text)
            } else if (j.type === 'result') {
              if (j.is_error) err = j.result || 'Claude Code returned an error'
              resultText = j.result || ''
            }
          } catch {
          }
        }
      })
      child.stderr.on('data', (d) => {
        err += String(d)
      })
      child.once('error', (e) => reject(e))
      child.once('close', (code) => {
        if (abort.signal.aborted) return reject(new Error('aborted'))
        if (!streamed && resultText && !err) onDelta(resultText)
        if (code === 0 && !/error/i.test(err.slice(0, 20))) resolve()
        else reject(new Error(truncate(err.replace(/\x1b\[[0-9;]*m/g, ''), 300) || `Claude Code exited with code ${code}`))
      })
      child.stdin.end(prompt)
    })
  }
}

function readSnippet(a: ChatAttachment): string {
  if (a.text) return a.text.slice(0, TEXT_LIMIT)
  if (!a.path) return ''
  try {
    return fs.readFileSync(a.path, 'utf8').slice(0, TEXT_LIMIT)
  } catch {
    return ''
  }
}

function attachmentParts(a: ChatAttachment): Part[] {
  try {
    if (a.kind === 'text') return [{ type: 'text', text: `Snippet "${a.name}":\n\`\`\`\n${readSnippet(a) || a.name}\n\`\`\`` }]
    if (!a.path || !fs.existsSync(a.path)) return [{ type: 'text', text: `[${a.name} is no longer available]` }]
    if (a.kind === 'folder') {
      const entries = fs.readdirSync(a.path, { withFileTypes: true }).slice(0, 150)
      return [{ type: 'text', text: `Folder ${a.path}:\n${entries.map((e) => `${e.isDirectory() ? '📁' : '·'} ${e.name}`).join('\n')}` }]
    }
    const mime = a.mime || mimeOf(a.path)
    const size = fs.statSync(a.path).size
    if (mime.startsWith('image/')) {
      if (size > IMAGE_LIMIT) return [{ type: 'text', text: `[${a.name}: image too large to send]` }]
      return [{ type: 'image', mime, data: fs.readFileSync(a.path).toString('base64') }]
    }
    if (mime === 'application/pdf') {
      if (size > 20_000_000) return [{ type: 'text', text: `[${a.name}: PDF too large to send]` }]
      return [{ type: 'pdf', name: a.name, data: fs.readFileSync(a.path).toString('base64') }]
    }
    if (isText(a.path) || size < 100_000) {
      const content = fs.readFileSync(a.path, 'utf8')
      if (content.includes('\u0000')) return [{ type: 'text', text: `[${a.name}: binary file, not sent]` }]
      const ext = path.extname(a.path).slice(1)
      return [{ type: 'text', text: `File ${basename(a.path)}:\n\`\`\`${ext}\n${content.slice(0, TEXT_LIMIT)}\n\`\`\`` }]
    }
    return [{ type: 'text', text: `[${a.name}: this file type can't be read]` }]
  } catch (e) {
    return [{ type: 'text', text: `[${a.name}: ${(e as Error).message}]` }]
  }
}

export function sessionBrief(s: Session): string {
  const steps = s.steps
    .slice(-14)
    .map((x) => `- ${x.verb}${x.target ? ` ${x.target}` : ''}${x.ok === false ? ' (failed)' : ''}`)
    .join('\n')
  const files = s.files
    .filter((f) => f.action !== 'read')
    .slice(-15)
    .map((f) => `- ${f.action}: ${f.path}`)
    .join('\n')
  return [
    `The user is asking about a live coding-agent session:`,
    `Agent: ${s.agent}; project: ${s.project} (${s.cwd}); state: ${s.phase}.`,
    s.task ? `Current task: ${s.task}` : '',
    steps ? `Recent steps:\n${steps}` : '',
    files ? `Files changed:\n${files}` : '',
    s.summary ? `Agent's last message: ${truncate(s.summary, 600)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

async function apiError(r: Response, model: string): Promise<string> {
  let msg = `${r.status} ${r.statusText}`
  try {
    const j = (await r.json()) as { error?: { message?: string; type?: string } | string; message?: string }
    const e = typeof j.error === 'string' ? j.error : j.error?.message || j.message
    if (e) msg = e
    if (typeof j.error === 'object' && j.error?.type === 'not_found_error') msg = `Model not found: ${model}. Pick another one.`
  } catch {
  }
  if (r.status === 401 || r.status === 403) msg = `The API key was rejected (${msg}). Check it in Settings → Chat.`
  if (r.status === 429) msg = `Rate limited by the provider. ${msg}`
  return msg
}

async function readSse(r: Response, onData: (data: string) => void): Promise<void> {
  if (!r.body) throw new Error('Empty response')
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, idx)
      buf = buf.slice(idx + (buf[idx] === '\r' ? 4 : 2))
      const data = block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (data) onData(data)
    }
  }
}

export const chat = new ChatService()
