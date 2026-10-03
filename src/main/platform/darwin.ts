import { execFile } from 'node:child_process'
import type { ActiveWindow, HostInfo } from '../../shared/types'
import { log } from '../util'
import { objc } from './objc'


function run(cmd: string, args: string[], timeout = 2500): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? '' : String(stdout)))
  })
}

// kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements
const ON_SCREEN = 1 | 16

/** Front app via NSWorkspace (public API), plus its frontmost normal window for capture. */
function frontmostNative(ownPid: number): ActiveWindow | null | undefined {
  const o = objc()
  if (!o) return undefined
  return o.pool(() => {
    const app = o.send(o.send(o.cls('NSWorkspace'), 'sharedWorkspace'), 'frontmostApplication')
    if (!app) return undefined
    const pid = o.int(app, 'processIdentifier') ?? 0
    const name = o.str(o.send(app, 'localizedName'), 'UTF8String') || ''
    if (!name || !pid || pid === ownPid) return null
    const bundle = o.str(o.send(app, 'bundleIdentifier'), 'UTF8String') || undefined
    const win: ActiveWindow = { app: name, title: '', pid, handle: bundle }
    const list = o.cg.windowList(ON_SCREEN)
    if (!list) return win
    try {
      const key = (k: string): unknown => o.nsString(k)
      for (let i = 0; i < o.count(list); i++) {
        const w = o.send(list, 'objectAtIndex:', i)
        if (o.int(o.send(w, 'objectForKey:', key('kCGWindowOwnerPID')), 'intValue') !== pid) continue
        if (o.int(o.send(w, 'objectForKey:', key('kCGWindowLayer')), 'intValue') !== 0) continue
        win.windowId = o.int(o.send(w, 'objectForKey:', key('kCGWindowNumber')), 'intValue') || undefined
        // Titles of other apps' windows are only visible with Screen Recording permission.
        win.title = o.str(o.send(w, 'objectForKey:', key('kCGWindowName')), 'UTF8String') || ''
        break
      }
    } finally {
      o.cg.release(list)
    }
    return win
  })
}

async function frontmostLsappinfo(ownPid: number): Promise<ActiveWindow | null> {
  const asn = (await run('/usr/bin/lsappinfo', ['front'])).trim()
  if (!asn) return null
  const info = await run('/usr/bin/lsappinfo', ['info', '-only', 'name', '-only', 'pid', '-only', 'bundleid', asn])
  const name = /"LSDisplayName"="([^"]*)"/.exec(info)?.[1] || /"name"="([^"]*)"/i.exec(info)?.[1] || ''
  const pid = Number(/"pid"\s*=\s*(\d+)/i.exec(info)?.[1] || 0)
  const bundle = /"CFBundleIdentifier"="([^"]*)"/.exec(info)?.[1] || ''
  if (!name || pid === ownPid) return null
  return { app: name, title: '', pid, handle: bundle || undefined }
}

export async function frontmostApp(ownPid: number): Promise<ActiveWindow | null> {
  try {
    const w = frontmostNative(ownPid)
    if (w !== undefined) return w
  } catch (e) {
    log('frontmost via NSWorkspace failed', (e as Error).message)
  }
  return frontmostLsappinfo(ownPid)
}

/**
 * Apps opened from Finder, the Dock or at login get launchd's bare PATH, which hides
 * Homebrew, npm, nvm and friends. Borrow the PATH the user's login shell would have.
 */
export async function loadShellPath(): Promise<void> {
  const shell = process.env.SHELL || '/bin/zsh'
  const mark = '__KUMO_ENV__'
  const out = await new Promise<string>((resolve) =>
    execFile(shell, ['-ilc', `echo ${mark}; /usr/bin/env; echo ${mark}`], { timeout: 5000, env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' } }, (_err, stdout) =>
      resolve(String(stdout || '')),
    ),
  )
  const body = out.split(mark)[1] || ''
  const line = body.split('\n').find((l) => l.startsWith('PATH='))
  if (!line) return
  const merged = [...line.slice(5).split(':'), ...(process.env.PATH || '').split(':')].filter(Boolean)
  process.env.PATH = [...new Set(merged)].join(':')
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

function osa(script: string, timeout = 4000): Promise<boolean> {
  return new Promise((resolve) => execFile('/usr/bin/osascript', ['-e', script], { timeout }, (err) => resolve(!err)))
}

/** Opens a window in an already running Ghostty (1.3+ scripting). False when it isn't running or can't be scripted. */
export function ghosttyWindow(cwd: string, command: string): Promise<boolean> {
  return osa(
    `if not (application "Ghostty" is running) then error "not running"\ntell application "Ghostty"\nactivate\nset cfg to new surface configuration\nset initial working directory of cfg to ${JSON.stringify(cwd)}\nset initial input of cfg to ${JSON.stringify(command)} & linefeed\nnew window with configuration cfg\nend tell`,
    // The first time, macOS asks whether Kumo may control Ghostty; leave room to answer.
    60_000,
  )
}

export async function focusHost(host: HostInfo, cwd?: string): Promise<boolean> {
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
  // Ghostty doesn't expose ttys; the agent's working directory is the next best handle.
  if (host.termProgram === 'ghostty' && cwd) {
    const ok = await osa(
      `if not (application "Ghostty" is running) then error "not running"\ntell application "Ghostty"\nset ts to every terminal whose working directory is ${JSON.stringify(cwd)}\nif ts is {} then error "no terminal"\nfocus item 1 of ts\nactivate\nend tell`,
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
