import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const isMac = process.platform === 'darwin'
export const isWin = process.platform === 'win32'

export const id = (): string => randomUUID().replace(/-/g, '').slice(0, 16)

export function dataDir(...parts: string[]): string {
  return path.join(app.getPath('userData'), ...parts)
}

export function kumoHome(...parts: string[]): string {
  return path.join(os.homedir(), '.kumo', ...parts)
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

let logFile = ''

export function log(...args: unknown[]): void {
  const line = `${new Date().toISOString()} ${args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}
`
  if (!app.isPackaged) process.stdout.write(line)
  try {
    if (!logFile) {
      const dir = dataDir('logs')
      ensureDir(dir)
      logFile = path.join(dir, 'kumo.log')
      try {
        if (fs.statSync(logFile).size > 2_000_000) fs.renameSync(logFile, path.join(dir, 'kumo.old.log'))
      } catch {
      }
    }
    fs.appendFileSync(logFile, line)
  } catch {
  }
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) & { flush(): void } {
  let timer: NodeJS.Timeout | null = null
  let last: A | null = null
  const run = (): void => {
    timer = null
    if (last) {
      const a = last
      last = null
      fn(...a)
    }
  }
  const d = ((...a: A) => {
    last = a
    if (!timer) timer = setTimeout(run, ms)
  }) as ((...a: A) => void) & { flush(): void }
  d.flush = () => {
    if (timer) clearTimeout(timer)
    run()
  }
  return d
}

export function truncate(s: string | undefined, n: number): string {
  if (!s) return ''
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

export function basename(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

export function exists(p: string): boolean {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

export function which(cmd: string): string | null {
  const exts = isWin ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  const extra = isWin
    ? [path.join(os.homedir(), '.local', 'bin'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'bin')]
    : ['/usr/local/bin', '/opt/homebrew/bin', path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.claude', 'local')]
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...extra].filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext.toLowerCase())
      if (exists(full)) return full
      if (ext && exists(path.join(dir, cmd + ext))) return path.join(dir, cmd + ext)
    }
  }
  return null
}

export function stamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
