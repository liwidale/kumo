import { execFile } from 'node:child_process'
import type { ActiveWindow, HostInfo } from '../../shared/types'


function run(cmd: string, args: string[], timeout = 2500): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? '' : String(stdout)))
  })
}

export async function frontmostApp(ownPid: number): Promise<ActiveWindow | null> {
  const asn = (await run('/usr/bin/lsappinfo', ['front'])).trim()
  if (!asn) return null
  const info = await run('/usr/bin/lsappinfo', ['info', '-only', 'name', '-only', 'pid', '-only', 'bundleid', asn])
  const name = /"LSDisplayName"="([^"]*)"/.exec(info)?.[1] || /"name"="([^"]*)"/i.exec(info)?.[1] || ''
  const pid = Number(/"pid"\s*=\s*(\d+)/i.exec(info)?.[1] || 0)
  const bundle = /"CFBundleIdentifier"="([^"]*)"/.exec(info)?.[1] || ''
  if (!name || pid === ownPid) return null
  return { app: name, title: '', pid, handle: bundle || undefined }
}

export function activateBundle(bundleId: string): Promise<boolean> {
  return new Promise((resolve) => execFile('/usr/bin/open', ['-b', bundleId], (err) => resolve(!err)))
}

export function activateApp(name: string): Promise<boolean> {
  return new Promise((resolve) => execFile('/usr/bin/open', ['-a', name], (err) => resolve(!err)))
}

async function appForPid(pid: number): Promise<string | null> {
  const comm = (await run('/bin/ps', ['-o', 'comm=', '-p', String(pid)])).trim()
  const m = /^(.*?\.app)\//.exec(comm)
  return m ? m[1] : null
}

function osa(script: string): Promise<boolean> {
  return new Promise((resolve) => execFile('/usr/bin/osascript', ['-e', script], { timeout: 4000 }, (err) => resolve(!err)))
}

export async function focusHost(host: HostInfo): Promise<boolean> {
  if (host.termProgram === 'Apple_Terminal' && host.tty) {
    const tty = host.tty.replace(/"/g, '')
    const ok = await osa(
      `tell application "Terminal"\nactivate\nrepeat with w in windows\nrepeat with t in tabs of w\nif tty of t is "${tty}" then\nset selected of t to true\nset index of w to 1\nreturn\nend if\nend repeat\nend repeat\nend tell`,
    )
    if (ok) return true
  }
  if (host.termProgram === 'iTerm.app' && host.tty) {
    const tty = host.tty.replace(/"/g, '')
    const ok = await osa(
      `tell application "iTerm"\nactivate\nrepeat with w in windows\nrepeat with t in tabs of w\nrepeat with s in sessions of t\nif tty of s is "${tty}" then\nselect w\nselect t\nselect s\nreturn\nend if\nend repeat\nend repeat\nend repeat\nend tell`,
    )
    if (ok) return true
  }
  if (host.bundleId && (await activateBundle(host.bundleId))) return true
  for (const pid of host.pids) {
    const app = await appForPid(pid)
    if (app) return activateApp(app)
  }
  if (host.app === 'Claude') return activateApp('Claude')
  if (host.app === 'Antigravity') return activateApp('Antigravity')
  return false
}
