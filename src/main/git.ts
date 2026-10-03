import { execFile } from 'node:child_process'
import type { GitChange, GitInfo, Result } from '../shared/types'
import fs from 'node:fs'
import path from 'node:path'
import { exists } from './util'


function git(cwd: string, args: string[], max = 4_000_000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, '-c', 'core.quotepath=off', ...args], { timeout: 6000, maxBuffer: max, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout), err: String(stderr || (err ? err.message : '')) }),
    )
  })
}

export async function gitInfo(cwd: string): Promise<GitInfo> {
  if (!cwd || !exists(cwd)) return { ok: false, error: 'Project folder not found', changes: [] }
  const st = await git(cwd, ['status', '--porcelain=v1', '-b', '--untracked-files=normal'])
  if (!st.ok) return { ok: false, error: /not a git repository/i.test(st.err) ? 'Not a git repository' : st.err.split('\n')[0] || 'git unavailable', changes: [] }
  const lines = st.out.split('\n').filter(Boolean)
  let branch: string | undefined
  let ahead = 0
  let behind = 0
  const changes = new Map<string, GitChange>()
  for (const l of lines) {
    if (l.startsWith('## ')) {
      const m = /^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.\S+)?(?: \[(.*)\])?/.exec(l)
      branch = m?.[1]
      const a = /ahead (\d+)/.exec(m?.[2] || '')
      const b = /behind (\d+)/.exec(m?.[2] || '')
      ahead = a ? Number(a[1]) : 0
      behind = b ? Number(b[1]) : 0
      continue
    }
    const code = l.slice(0, 2)
    let p = l.slice(3)
    if (p.includes(' -> ')) p = p.split(' -> ')[1]
    p = p.replace(/^"|"$/g, '')
    const status: GitChange['status'] = code === '??' ? '?' : code.includes('U') ? 'U' : code.includes('A') ? 'A' : code.includes('D') ? 'D' : code.includes('R') ? 'R' : 'M'
    changes.set(p, { path: p, status, added: 0, removed: 0 })
  }
  const num = await git(cwd, ['diff', '--numstat', 'HEAD'])
  if (num.ok) {
    for (const l of num.out.split('\n').filter(Boolean)) {
      const [a, r, ...rest] = l.split('\t')
      let p = rest.join('\t')
      if (p.includes(' => ')) p = p.replace(/\{?[^{}]* => ([^{}]*)\}?/, '$1')
      const c = changes.get(p)
      if (c) {
        c.added = Number(a) || 0
        c.removed = Number(r) || 0
      }
    }
  }
  return { ok: true, branch, ahead, behind, changes: [...changes.values()].slice(0, 200) }
}

export async function revertFile(cwd: string, file: string): Promise<Result> {
  if (!cwd || !exists(cwd)) return { ok: false, error: 'Project folder not found.' }
  const full = path.resolve(cwd, file)
  const rel = path.relative(cwd, full)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, error: 'That file is outside the project.' }
  const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', rel])
  if (!tracked.ok) {
    try {
      fs.rmSync(full, { force: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  const r = await git(cwd, ['restore', '--staged', '--worktree', '--source=HEAD', '--', rel])
  if (r.ok) return { ok: true }
  const c = await git(cwd, ['checkout', 'HEAD', '--', rel])
  return c.ok ? { ok: true } : { ok: false, error: (r.err || c.err).split('\n')[0] || 'git could not restore the file' }
}

export async function gitDiff(cwd: string, file: string): Promise<Result<string>> {
  const tracked = await git(cwd, ['ls-files', '--error-unmatch', '--', file])
  if (!tracked.ok) {
    const r = await git(cwd, ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', file], 400_000)
    return { ok: true, value: r.out.slice(0, 200_000) || '(new file)' }
  }
  const r = await git(cwd, ['diff', 'HEAD', '--', file], 400_000)
  if (!r.ok && !r.out) return { ok: false, error: r.err.split('\n')[0] || 'git diff failed' }
  return { ok: true, value: r.out.slice(0, 200_000) || 'No changes.' }
}
