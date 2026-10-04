import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { validAgent, type HookEnvelope } from './agents/adapters'
import { asks } from './asks'
import { sessions } from './sessions'
import { ensureDir, kumoHome, log, writeJson } from './util'

const PREFERRED_PORT = 47615
const MAX_BODY = 1_000_000

let server: http.Server | null = null
let token = ''
export let serverState: { ok: boolean; port: number; error?: string } = { ok: false, port: 0 }

function json(res: http.ServerResponse, code: number, body: string): void {
  const buf = Buffer.from(body, 'utf8')
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' })
  res.end(buf)
}

function tokenOk(header: string | string[] | undefined): boolean {
  const got = Buffer.from(String(header || ''))
  const want = Buffer.from(token)
  return got.length === want.length && timingSafeEqual(got, want)
}

function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x.slice(0, 500)
  return out
}

async function onRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const hostHeader = String(req.headers.host || '')
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(hostHeader) || req.headers.origin) return json(res, 403, '{"error":"forbidden"}')
  const url = new URL(req.url || '/', 'http://127.0.0.1')

  if (req.method === 'GET' && url.pathname === '/v1/health') return json(res, 200, JSON.stringify({ app: 'kumo', ok: true }))
  if (req.method !== 'POST' || (url.pathname !== '/v1/hook' && url.pathname !== '/v1/mcp')) return json(res, 404, '{"error":"not found"}')
  if (!tokenOk(req.headers['x-kumo-token'])) return json(res, 401, '{"error":"unauthorized"}')

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) return json(res, 413, '{"error":"too large"}')
    chunks.push(chunk as Buffer)
  }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^﻿/, ''))
  } catch {
    return json(res, 400, '{"error":"bad json"}')
  }
  if (url.pathname === '/v1/mcp') return onMcp(res, body)
  const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>
  const agentRaw = String(body.agent || payload.kumo_agent || '')
  const env: HookEnvelope = {
    agent: validAgent(agentRaw),
    event: String(body.event || payload.hook_event_name || ''),
    payload,
    env: strMap(body.env),
    ancestors: Array.isArray(body.ancestors)
      ? (body.ancestors as unknown[])
          .map((a) => a as Record<string, unknown>)
          .filter((a) => typeof a.pid === 'number')
          .map((a) => ({ pid: a.pid as number, name: String(a.name || '') }))
          .slice(0, 16)
      : [],
    cwd: String(body.cwd || ''),
  }
  if (!env.event) return json(res, 200, '')

  let heldId: string | undefined
  let finished = false
  res.on('close', () => {
    if (!finished && heldId) sessions.abandoned(heldId)
  })
  try {
    const out = await sessions.handle(env, (approvalId) => {
      heldId = approvalId
    })
    finished = true
    if (!res.destroyed) json(res, 200, out)
  } catch (e) {
    finished = true
    log('hook handling failed', e)
    if (!res.destroyed) json(res, 200, '')
  }
}

async function onMcp(res: http.ServerResponse, body: Record<string, unknown>): Promise<void> {
  const ctx = (body.context && typeof body.context === 'object' ? body.context : {}) as Record<string, unknown>
  const ancestors = Array.isArray(ctx.ancestors)
    ? (ctx.ancestors as unknown[])
        .map((a) => a as Record<string, unknown>)
        .filter((a) => a && typeof a.pid === 'number')
        .map((a) => ({ pid: a.pid as number, name: String(a.name || '') }))
        .slice(0, 16)
    : []
  let cancel: (() => void) | null = null
  let finished = false
  res.on('close', () => {
    if (!finished) cancel?.()
  })
  const reply = await asks.handle(
    {
      tool: String(body.tool || ''),
      arguments: (body.arguments && typeof body.arguments === 'object' ? body.arguments : {}) as Record<string, unknown>,
      context: { ancestors, cwd: String(ctx.cwd || ''), agent: String(ctx.agent || '') },
    },
    (c) => {
      cancel = c
    },
  )
  finished = true
  if (!res.destroyed) json(res, 200, JSON.stringify(reply))
}

function listen(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      onRequest(req, res).catch((e) => {
        log('request error', e)
        if (!res.headersSent) json(res, 500, '')
      })
    })
    srv.requestTimeout = 0
    srv.headersTimeout = 10_000
    srv.keepAliveTimeout = 1_000
    srv.once('error', reject)
    srv.listen(port, '127.0.0.1', () => {
      srv.off('error', reject)
      srv.on('error', (e) => log('server error', e))
      server = srv
      resolve((srv.address() as AddressInfo).port)
    })
  })
}

export const runtimeFile = (): string => kumoHome('runtime.json')

function writeRuntime(port: number): void {
  ensureDir(kumoHome())
  writeJson(runtimeFile(), { app: 'kumo', port, token, pid: process.pid, startedAt: Date.now() })
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(runtimeFile(), 0o600)
      fs.chmodSync(kumoHome(), 0o700)
    } catch {
    }
  }
}

export async function startHookServer(): Promise<void> {
  token = randomBytes(24).toString('hex')
  let port = 0
  try {
    port = await listen(PREFERRED_PORT)
  } catch {
    try {
      port = await listen(0)
    } catch (e) {
      serverState = { ok: false, port: 0, error: (e as Error).message }
      log('hook server failed to start', e)
      return
    }
  }
  writeRuntime(port)
  serverState = { ok: true, port }
  log('hook server on', port)
}

export async function restartHookServer(): Promise<void> {
  await stopHookServer()
  await startHookServer()
}

export async function stopHookServer(): Promise<void> {
  const srv = server
  server = null
  if (srv) {
    srv.closeAllConnections?.()
    await new Promise<void>((r) => srv.close(() => r()))
  }
  try {
    const cur = JSON.parse(fs.readFileSync(runtimeFile(), 'utf8'))
    if (cur.pid === process.pid) fs.rmSync(runtimeFile(), { force: true })
  } catch {
  }
}

export function ensureRuntime(): void {
  if (serverState.ok && !fs.existsSync(runtimeFile())) writeRuntime(serverState.port)
}
