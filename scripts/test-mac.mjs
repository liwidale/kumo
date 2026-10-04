import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const x64 = argv.includes('--x64')
const packagedApp = path.join(root, 'release/mac-universal/Kumo.app')
const dev = argv.includes('--dev') || (!x64 && !fs.existsSync(packagedApp))
const exe = dev ? path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : path.join(packagedApp, 'Contents/MacOS/Kumo')
const realHome = os.homedir()
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kumo-test-mac-'))
const shots = path.join(work, 'screens')
fs.mkdirSync(shots)

if (process.platform !== 'darwin') throw new Error('macOS only')
if (x64 && dev) throw new Error('--x64 needs the packaged universal app: npm run pack:mac')
if (!fs.existsSync(exe)) throw new Error(`missing ${exe} - run ${dev ? 'npm install' : 'npm run pack:mac'}`)

let failures = 0
let warnings = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` - ${detail}` : ''}`)
  if (!ok) failures++
  return ok
}
const warn = (name, detail) => {
  console.log(`  ! ${name} - ${detail}`)
  warnings++
}
const section = (t) => console.log(`\n${t}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, ms = 10_000, step = 150) {
  const end = Date.now() + ms
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {}
    if (Date.now() > end) return null
    await sleep(step)
  }
}

class Cdp {
  static async open(port, pick) {
    const target = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(pick), 60_000, 300)
    if (!target) throw new Error(`no debug target on ${port}`)
    const c = new Cdp(target.webSocketDebuggerUrl)
    await c.ready
    return c
  }
  constructor(url) {
    this.n = 0
    this.pending = new Map()
    this.errors = []
    this.ws = new WebSocket(url)
    this.ready = new Promise((r) => (this.ws.onopen = r))
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.id) this.pending.get(d.id)?.(d)
      else if (d.method === 'Runtime.exceptionThrown') this.errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)
      else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') this.errors.push(d.params.args.map((a) => a.value ?? a.description).join(' '))
    }
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.n
      const t = setTimeout(() => reject(new Error(`${method} timed out`)), 30_000)
      this.pending.set(id, (d) => {
        clearTimeout(t)
        this.pending.delete(id)
        d.error ? reject(new Error(d.error.message)) : resolve(d.result)
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const r = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    return r.result.value
  }
  async shot(name) {
    const r = await this.call('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(r.data, 'base64'))
  }
  close() {
    this.ws.close()
  }
}

const launchdEnv = (home) => ({
  HOME: home,
  USER: os.userInfo().username,
  LOGNAME: os.userInfo().username,
  SHELL: process.env.SHELL || '/bin/zsh',
  TMPDIR: os.tmpdir(),
  LANG: process.env.LANG || 'en_US.UTF-8',
  PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
})

function startApp(home, profile, port, extra = []) {
  const args = [...(dev ? [root] : []), `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, `--inspect=${port + 1}`, ...extra]
  const child = x64 ? spawn('/usr/bin/arch', ['-x86_64', exe, ...args], { env: launchdEnv(home), stdio: 'ignore' }) : spawn(exe, args, { env: launchdEnv(home), stdio: 'ignore' })
  return child
}

async function connect(port) {
  const main = await Cdp.open(port + 1, () => true)
  const island = await Cdp.open(port, (t) => t.url.includes('island.html'))
  await island.call('Runtime.enable')
  await waitFor(() => island.eval('document.readyState === "complete" && !!window.kumo'), 30_000)
  return { main, island }
}

const islandCmd = (main, cmd) => main.eval(`require('electron').BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Kumo').webContents.send('island:command', ${JSON.stringify(cmd)})`)

function hook(home, args, payload, cwd = root) {
  const started = Date.now()
  return new Promise((resolve) => {
    const child = spawn(path.join(home, '.kumo/bin/kumo-hook'), args, { env: { ...launchdEnv(home), TERM_PROGRAM: 'Apple_Terminal' }, cwd })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('close', (code) => resolve({ out: out.trim(), code, ms: Date.now() - started }))
    child.stdin.end(JSON.stringify(payload))
  })
}

function shellCmd(home, command, payload) {
  return new Promise((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], { env: launchdEnv(home), cwd: root })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.on('close', () => resolve(out.trim()))
    child.stdin.end(JSON.stringify(payload))
  })
}

async function quit(port, child, profile, home) {
  const done = new Promise((r) => child.once('exit', r))
  const args = [...(dev ? [root] : []), `--user-data-dir=${profile}`, '--quit']
  spawn(exe, args, { env: launchdEnv(home), stdio: 'ignore' })
  const exited = await Promise.race([done.then(() => true), sleep(15_000).then(() => false)])
  if (!exited) child.kill('SIGKILL')
  return exited
}

function loginPath() {
  const shell = process.env.SHELL || '/bin/zsh'
  const out = execFileSync(shell, ['-ilc', 'echo __K__; /usr/bin/env; echo __K__'], { encoding: 'utf8', timeout: 10_000, env: { HOME: realHome, USER: os.userInfo().username, SHELL: shell, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TERM: 'dumb' }, stdio: ['ignore', 'pipe', 'ignore'] })
  const line = (out.split('__K__')[1] || '').split('\n').find((l) => l.startsWith('PATH='))
  return line ? line.slice(5).split(':').filter(Boolean) : []
}

const whichIn = (dirs, cmd) => dirs.map((d) => path.join(d, cmd)).find((p) => fs.existsSync(p)) || null

function kumoRunning() {
  try {
    const rt = JSON.parse(fs.readFileSync(path.join(realHome, '.kumo/runtime.json'), 'utf8'))
    process.kill(rt.pid, 0)
    return true
  } catch {
    return false
  }
}

console.log(`Kumo macOS test · macOS ${execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim()} · ${os.arch()} host · ${dev ? 'dev build' : x64 ? 'packaged, x86_64 under Rosetta' : 'packaged app'}`)
console.log(`Output: ${work}`)
if (kumoRunning()) throw new Error('Kumo is running - quit it first (its hook server and ~/.kumo would collide with the test).')

{
  section('App')
  const profile = path.join(work, 'profile-a')
  const port = 9340
  const child = startApp(realHome, profile, port)
  const { main, island } = await connect(port)

  const rtFile = path.join(realHome, '.kumo/runtime.json')
  const rt = await waitFor(() => JSON.parse(fs.readFileSync(rtFile, 'utf8')))
  check('hook server announced in ~/.kumo/runtime.json', rt?.port > 0 && rt?.pid === child.pid, rt ? `port ${rt.port}` : 'missing')
  check('runtime.json is private (0600) inside a 0700 folder', (fs.statSync(rtFile).mode & 0o777) === 0o600 && (fs.statSync(path.dirname(rtFile)).mode & 0o777) === 0o700)
  const health = await fetch(`http://127.0.0.1:${rt.port}/v1/health`).then((r) => r.json()).catch(() => null)
  check('hook server answers /v1/health', health?.ok === true)
  check('rejects requests from web pages', (await fetch(`http://127.0.0.1:${rt.port}/v1/health`, { headers: { Origin: 'https://example.com' } })).status === 403)

  const relay = path.join(realHome, '.kumo/bin/kumo-hook')
  const archs = execFileSync('/usr/bin/lipo', ['-archs', relay], { encoding: 'utf8' }).trim()
  check('relay installed and executable', (fs.statSync(relay).mode & 0o111) !== 0, archs)
  if (!dev) check('relay is universal', archs.includes('arm64') && archs.includes('x86_64'))

  const arch = await main.eval('process.arch')
  check('main process architecture', arch === (x64 ? 'x64' : os.arch()), arch)

  section('Environment from Finder/launchd')
  const wanted = loginPath()
  const appPath = (await main.eval('process.env.PATH')).split(':')
  const missing = wanted.filter((d) => !appPath.includes(d))
  check('login shell PATH recovered', wanted.length > 0 && missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${wanted.length} entries`)
  const snap = await island.eval('window.kumo.snapshot()')
  for (const [cmd, key] of [['claude', 'claudeCli'], ['codex', 'codexCli'], ['gemini', 'geminiCli'], ['agy', 'agyCli']]) {
    const found = whichIn(wanted, cmd)
    if (found) check(`detects ${cmd} CLI`, snap.installed[key] === true, found)
  }
  const editorApps = { code: 'Visual Studio Code', cursor: 'Cursor', zed: 'Zed', windsurf: 'Windsurf', antigravity: 'Antigravity' }
  for (const [ed, app] of Object.entries(editorApps)) {
    if (['/Applications', path.join(realHome, 'Applications')].some((d) => fs.existsSync(path.join(d, `${app}.app`)))) check(`offers ${app} as an editor`, snap.installed.editors.includes(ed))
  }
  const nodeCli = ['gemini', 'claude', 'codex'].find((c) => whichIn(wanted, c))
  if (nodeCli) {
    const ver = await main.eval(`(() => { try { return require('child_process').execFileSync(${JSON.stringify(nodeCli)}, ['--version'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, KUMO_INTERNAL: '1' } }).trim() } catch (e) { return 'ERR ' + e.message } })()`)
    check(`can run ${nodeCli} (a Node script) the way chat and launch do`, !String(ver).startsWith('ERR'), String(ver).split('\n')[0].slice(0, 80))
  }

  section('Island & display')
  const disp = await island.eval('window.kumo.display()')
  const geo = await main.eval(`(() => { const { BrowserWindow, screen } = require('electron'); const w = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Kumo'); return { b: w.getBounds(), top: w.isAlwaysOnTop(), focusable: w.isFocusable(), spaces: w.isVisibleOnAllWorkspaces(), visible: w.isVisible(), displays: screen.getAllDisplays().map((d) => ({ b: d.bounds, wa: d.workArea, internal: d.internal })) } })()`)
  const host = geo.displays.find((d) => geo.b.x >= d.b.x && geo.b.x < d.b.x + d.b.width)
  check('island visible, always on top, on all Spaces', geo.visible && geo.top && geo.spaces)
  check('island does not take focus while collapsed', geo.focusable === false)
  check('island centred at the top of its display', host && Math.abs(geo.b.x + geo.b.width / 2 - (host.b.x + host.b.width / 2)) <= 1 && geo.b.y === host.b.y)
  const notchExpected = geo.displays.some((d) => d.internal && d.wa.y - d.b.y >= 32)
  check(`display mode "${disp.mode}"`, disp.mode === (notchExpected ? 'notch' : 'floating'), disp.mode === 'notch' ? `notch ${disp.notchWidth}×${disp.notchHeight}pt` : `top ${disp.top}pt`)
  if (disp.mode === 'notch') check('notch size read from NSScreen', disp.notchWidth > 100 && disp.notchWidth < 400 && disp.notchHeight >= 24)
  await main.eval(`require('electron').screen.emit('display-metrics-changed')`)
  await sleep(700)
  const after = await main.eval(`require('electron').BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Kumo').getBounds()`)
  check('re-places itself when displays change', Math.abs(after.x + after.width / 2 - (host.b.x + host.b.width / 2)) <= 1 && after.y === host.b.y)
  const trayOk = await main.eval(`(() => { const { app, nativeImage } = require('electron'); const p = require('path').join(app.isPackaged ? process.resourcesPath : app.getAppPath() + '/resources', 'tray', 'trayTemplate.png'); const i = nativeImage.createFromPath(p); return !i.isEmpty() && i.getSize().height <= 22 })()`)
  check('menu bar template icon loads', trayOk)
  check('⌘⌥K registered', await main.eval(`require('electron').globalShortcut.isRegistered('Command+Alt+K')`))

  section('Front app & views')
  await islandCmd(main, { type: 'expand' })
  await sleep(900)
  check('first run greets with the welcome card', (await island.eval('document.body.innerText')).includes('Hi, I’m Kumo'))
  await island.shot('island-welcome')
  await island.eval(`[...document.querySelectorAll('button')].find((b) => b.innerText.includes('Get started')).click()`)
  check('“Get started” finishes onboarding', await waitFor(async () => (await island.eval('window.kumo.settings()')).onboarded && (await island.eval('document.body.innerText')).includes('Sessions'), 3000))
  const front = await island.eval('window.kumo.activeWindow()')
  const lsFront = (() => {
    try {
      const asn = execFileSync('/usr/bin/lsappinfo', ['front'], { encoding: 'utf8' }).trim()
      return /"LSDisplayName"="([^"]*)"/.exec(execFileSync('/usr/bin/lsappinfo', ['info', '-only', 'name', asn], { encoding: 'utf8' }))?.[1]
    } catch {
      return null
    }
  })()
  if (front) {
    check('front app read through NSWorkspace', !lsFront || front.app === lsFront, `${front.app} (pid ${front.pid}${front.handle ? `, ${front.handle}` : ''})`)
    front.windowId ? check('front window id found for window capture', front.windowId > 0, `window ${front.windowId}`) : warn('front window id', 'none - the front app has no on-screen window')
  } else warn('front app', 'none reported (Kumo itself or the desktop was in front)')
  if ((await main.eval(`require('electron').systemPreferences.getMediaAccessStatus('screen')`)) === 'granted' && front?.windowId) {
    const cap = await island.eval('window.kumo.captureWindow()')
    check('captures the front window, not the whole screen', cap.ok && cap.value.kind === 'window' && cap.value.appName === front.app, cap.ok ? cap.value.name : cap.error)
  } else warn('window capture', 'skipped - grant Screen Recording to Kumo in System Settings to include it')
  for (const [name, cmd, text] of [
    ['home', { type: 'expand' }, 'Sessions'],
    ['new-session', { type: 'new-session' }, 'New session'],
    ['chat', { type: 'chat' }, 'Chat'],
  ]) {
    await islandCmd(main, cmd)
    await sleep(700)
    const body = await island.eval('document.body.innerText')
    check(`island view: ${name}`, body.includes(text))
    await island.shot(`island-${name}`)
  }
  await islandCmd(main, { type: 'collapse' })

  for (const s of ['general', 'appearance', 'agents', 'approvals', 'chat', 'privacy', 'about']) {
    await main.eval(`require('electron').ipcMain.emit('app:settings', {}, ${JSON.stringify(s)})`)
    const page = await Cdp.open(port, (t) => t.url.includes('settings.html'))
    await waitFor(async () => (await page.eval('document.body.innerText')).length > 50, 10_000)
    await sleep(300)
    const h = await page.eval(`document.querySelector('h1.content-title')?.innerText || ''`)
    check(`settings: ${s}`, h.toLowerCase().includes(s.slice(0, 4)), h.split('\n')[0])
    if (s === 'general') {
      const terms = await page.eval(`[...document.querySelectorAll('select')].map((x) => [...x.options].map((o) => o.text)).find((o) => o.includes('Terminal')) || []`)
      for (const t of ['iTerm', 'Ghostty']) if (fs.existsSync(`/Applications/${t}.app`)) check(`offers ${t} for new sessions`, terms.includes(t), terms.join(', '))
    }
    await page.shot(`settings-${s}`)
    page.close()
  }
  await main.eval(`require('electron').BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Kumo Settings')?.close()`)

  section('Claude Code session through the relay')
  const sid = `test-${Date.now()}`
  const base = { session_id: sid, cwd: root }
  let r = await hook(realHome, ['SessionStart'], { ...base, hook_event_name: 'SessionStart', source: 'startup' })
  check('SessionStart', r.code === 0 && r.ms < 4000, `${r.ms} ms`)
  await hook(realHome, ['UserPromptSubmit'], { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'Run the macOS test' })
  await hook(realHome, ['PreToolUse'], { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } })
  const key = `claude-code:${sid}`
  const sess = await waitFor(async () => (await island.eval('window.kumo.snapshot()')).sessions.find((s) => s.key === key && s.phase === 'working'))
  check('session shows up as working', !!sess, sess ? `${sess.project} · ${sess.host.app}` : '')
  await island.shot('island-working')

  const pending = hook(realHome, ['PermissionRequest'], { ...base, hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm -rf out', description: 'Clean' } })
  const ap = await waitFor(async () => (await island.eval('window.kumo.snapshot()')).approvals[0])
  check('permission request reaches the island', !!ap, ap ? `${ap.subject} (${ap.risk})` : '')
  await sleep(600)
  await island.shot('island-approval')
  check('⌘⌥Y / ⌘⌥N armed while a request waits', await main.eval(`['Command+Alt+Y', 'Command+Alt+N'].every((k) => require('electron').globalShortcut.isRegistered(k))`))
  await islandCmd(main, { type: 'decide', behavior: 'allow' })
  r = await pending
  check('allow travels back to Claude Code', /"behavior":"allow"/.test(r.out), r.out)
  check('global shortcuts released afterwards', await waitFor(() => main.eval(`!require('electron').globalShortcut.isRegistered('Command+Alt+Y')`), 3000))

  const pending2 = hook(realHome, ['PermissionRequest'], { ...base, hook_event_name: 'PermissionRequest', tool_name: 'Write', tool_input: { file_path: path.join(root, 'x.txt'), content: 'x' } })
  const ap2 = await waitFor(async () => (await island.eval('window.kumo.snapshot()')).approvals[0])
  await island.eval(`window.kumo.decide({ id: ${JSON.stringify(ap2?.id)}, behavior: 'deny' })`)
  r = await pending2
  check('deny travels back to Claude Code', /"behavior":"deny"/.test(r.out), r.out)

  await hook(realHome, ['Stop'], { ...base, hook_event_name: 'Stop', last_assistant_message: 'All macOS checks passed.' })
  const done = await waitFor(async () => (await island.eval('window.kumo.snapshot()')).sessions.find((s) => s.key === key && s.phase === 'done'))
  check('Stop marks the session finished', !!done, done?.summary || '')
  await sleep(500)
  await island.shot('island-done')
  await hook(realHome, ['SessionEnd'], { ...base, hook_event_name: 'SessionEnd', reason: 'exit' })

  section('Other agents')
  const agy = hook(realHome, ['--agent', 'antigravity', 'PreToolUse'], { conversationId: `agy-${sid}`, hook_event_name: 'PreToolUse', cwd: root, tool_name: 'run_command', tool_input: { CommandLine: 'ls' } })
  const ap3 = await waitFor(async () => (await island.eval('window.kumo.snapshot()')).approvals.find((a) => a.agent === 'antigravity'))
  if (ap3) await island.eval(`window.kumo.decide({ id: ${JSON.stringify(ap3.id)}, behavior: 'allow' })`)
  r = await agy
  check('Antigravity approval', r.out === '{"decision":"allow"}', r.out)
  r = await hook(realHome, ['--agent', 'gemini', 'BeforeTool'], { session_id: `gem-${sid}`, hook_event_name: 'BeforeTool', cwd: root, tool_name: 'run_shell_command', tool_input: { command: 'ls' } })
  check('Gemini CLI (approvals off by default) passes through', r.out === '{}', r.out)
  r = await hook(realHome, ['--agent', 'cursor', 'beforeShellExecution'], { conversation_id: `cur-${sid}`, hook_event_name: 'beforeShellExecution', cwd: root, command: 'ls' })
  check('Cursor (approvals off by default) passes through', r.out === '{}', r.out)
  const codex = hook(realHome, ['--agent', 'codex', 'PermissionRequest'], { session_id: `cdx-${sid}`, hook_event_name: 'PermissionRequest', cwd: root, tool_name: 'shell', tool_input: { command: ['ls'] } })
  const ap4 = await waitFor(async () => (await island.eval('window.kumo.snapshot()')).approvals.find((a) => a.agent === 'codex'), 4000)
  if (ap4) await island.eval(`window.kumo.decide({ id: ${JSON.stringify(ap4.id)}, behavior: 'allow' })`)
  r = await codex
  check('Codex approval', !!ap4 && r.out.includes('allow'), r.out)
  const agents = new Set((await island.eval('window.kumo.snapshot()')).sessions.map((s) => s.agent))
  check('sessions from every agent tracked', ['antigravity', 'gemini', 'cursor', 'codex'].every((a) => agents.has(a)), [...agents].join(', '))

  section('Settings')
  await islandCmd(main, { type: 'collapse' })
  await sleep(800)
  await island.eval(`window.kumo.setSettings({ presence: 'tray' })`)
  check('menu bar only hides the island', await waitFor(() => main.eval(`!require('electron').BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Kumo').isVisible()`), 5000))
  await island.eval(`window.kumo.setSettings({ presence: 'island' })`)
  check('island comes back', await waitFor(() => main.eval(`require('electron').BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Kumo').isVisible()`), 3000))
  await island.eval(`window.kumo.setSettings({ hotkey: 'Command+Shift+K' })`)
  check('hotkey can be changed', await waitFor(() => main.eval(`(() => { const g = require('electron').globalShortcut; return g.isRegistered('Command+Shift+K') && !g.isRegistered('Command+Alt+K') })()`), 3000))
  await island.eval(`window.kumo.setSettings({ hotkey: 'Command+Alt+K', theme: 'light' })`)
  check('theme follows the setting', await waitFor(() => main.eval(`require('electron').nativeTheme.themeSource === 'light'`), 3000))
  await island.eval(`window.kumo.setSettings({ theme: 'system' })`)

  section('Instances')
  const second = spawn(exe, [...(dev ? [root] : []), `--user-data-dir=${profile}`], { env: launchdEnv(realHome), stdio: 'ignore' })
  const secondExit = await Promise.race([new Promise((r) => second.once('exit', (c) => r(c))), sleep(15_000).then(() => 'hung')])
  check('a second launch hands over to the running app', secondExit === 0, `exit ${secondExit}`)
  check('…which opens Settings', await waitFor(() => main.eval(`!!require('electron').BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'Kumo Settings')?.isVisible()`), 5000))

  check('no errors in the island', island.errors.length === 0, island.errors.slice(0, 3).join(' | '))
  main.close()
  island.close()
  check('--quit shuts it down cleanly', await quit(port, child, profile, realHome))
  check('runtime.json removed on quit', !fs.existsSync(rtFile))

  const off = await hook(realHome, ['PermissionRequest'], { session_id: 'x', hook_event_name: 'PermissionRequest', cwd: root, tool_name: 'Bash', tool_input: { command: 'ls' } })
  check('relay steps aside when Kumo is not running', off.code === 0 && off.out === '' && off.ms < 1500, `${off.ms} ms`)
  const offAgy = await hook(realHome, ['--agent', 'antigravity', 'PreToolUse'], { hook_event_name: 'PreToolUse', cwd: root })
  check('…and lets Antigravity ask as usual', offAgy.out === '{"decision":"ask"}', offAgy.out)
}

{
  section('Connecting agents (throwaway HOME)')
  const home = path.join(work, 'home')
  const write = (p, v) => {
    fs.mkdirSync(path.dirname(path.join(home, p)), { recursive: true })
    fs.writeFileSync(path.join(home, p), JSON.stringify(v, null, 2))
  }
  const read = (p) => JSON.parse(fs.readFileSync(path.join(home, p), 'utf8'))
  const claudeBefore = { model: 'opus', statusLine: { type: 'command', command: 'echo mine' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } }
  const geminiBefore = { theme: 'Default' }
  write('.claude/settings.json', claudeBefore)
  write('.gemini/settings.json', geminiBefore)

  const profile = path.join(work, 'profile-b')
  const port = 9350
  const child = startApp(home, profile, port)
  const { main, island } = await connect(port)
  const ids = ['claude-code', 'antigravity', 'codex', 'gemini', 'cursor', 'claude-limits']
  for (const id of ids) {
    const p = await island.eval(`window.kumo.previewHooks(${JSON.stringify(id)}, true)`)
    const a = p.ok ? await island.eval(`window.kumo.applyHooks(${JSON.stringify(id)}, true, ${JSON.stringify(p.value.fingerprint)})`) : p
    check(`connect ${id}`, a.ok, a.error || '')
  }
  const states = Object.fromEntries((await island.eval('window.kumo.integrations()')).map((i) => [i.id, i]))
  check('all report connected', ['claude-code', 'antigravity', 'codex', 'gemini', 'cursor'].every((i) => states[i].state === 'connected'), Object.values(states).map((s) => `${s.id}:${s.state}`).join(' '))
  check('Claude Code usage limits connected', states['claude-code'].limits === true)
  const claude = read('.claude/settings.json')
  check('your own Claude settings and hooks are kept', claude.model === 'opus' && JSON.stringify(claude.hooks.Stop).includes('echo other'))
  check('your status line keeps working behind the tee', /kumo-hook --tee .*\| echo mine$/.test(claude.statusLine.command))
  check('a backup is written next to the config', fs.readdirSync(path.join(home, '.claude')).some((f) => f.includes('kumo-backup')))

  const run = [
    ['claude-code', claude.hooks.SessionStart[0].hooks[0].command, { session_id: 'c1', hook_event_name: 'SessionStart', cwd: root }],
    ['codex', read('.codex/hooks.json').hooks.SessionStart[0].hooks[0].command, { session_id: 'x1', hook_event_name: 'SessionStart', cwd: root }],
    ['gemini', read('.gemini/settings.json').hooks.SessionStart[0].hooks[0].command, { session_id: 'g1', hook_event_name: 'SessionStart', cwd: root }],
    ['cursor', read('.cursor/hooks.json').hooks.sessionStart[0].command, { conversation_id: 'u1', hook_event_name: 'sessionStart', workspace_roots: [root] }],
    ['antigravity', read('.gemini/config/hooks.json').kumo.PreInvocation[0].command, { conversationId: 'a1', hook_event_name: 'PreInvocation', cwd: root }],
  ]
  for (const [agent, command, payload] of run) await shellCmd(home, command, payload)
  const seen = await waitFor(async () => {
    const s = new Set((await island.eval('window.kumo.snapshot()')).sessions.map((x) => x.agent))
    return run.every(([a]) => s.has(a)) && s
  }, 5000)
  check('hooks written to each config reach Kumo', !!seen, seen ? [...seen].join(', ') : '')
  const status = await shellCmd(home, claude.statusLine.command, { session_id: 'c1', rate_limits: {} })
  check('status line output unchanged', status === 'mine', JSON.stringify(status))

  const p = await island.eval(`window.kumo.previewHooks('claude-code', false)`)
  write('.claude/settings.json', { ...read('.claude/settings.json'), edited: true })
  const stale = await island.eval(`window.kumo.applyHooks('claude-code', false, ${JSON.stringify(p.value.fingerprint)})`)
  check('refuses to write over a config changed after review', !stale.ok)
  const cur = read('.claude/settings.json')
  delete cur.edited
  write('.claude/settings.json', cur)

  for (const id of ids.slice().reverse()) {
    const q = await island.eval(`window.kumo.previewHooks(${JSON.stringify(id)}, false)`)
    const a = await island.eval(`window.kumo.applyHooks(${JSON.stringify(id)}, false, ${JSON.stringify(q.value.fingerprint)})`)
    check(`disconnect ${id}`, a.ok, a.error || '')
  }
  check('Claude settings back to exactly what they were', JSON.stringify(read('.claude/settings.json')) === JSON.stringify(claudeBefore))
  check('Gemini settings back to exactly what they were', JSON.stringify(read('.gemini/settings.json')) === JSON.stringify(geminiBefore))
  main.close()
  island.close()
  check('quits', await quit(port, child, profile, home))
}

console.log(`\n${failures ? `✗ ${failures} failed` : '✓ all passed'}${warnings ? `, ${warnings} warning${warnings > 1 ? 's' : ''}` : ''} · screenshots in ${shots}`)
process.exit(failures ? 1 : 0)
