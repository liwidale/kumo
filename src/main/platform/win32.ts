import { createRequire } from 'node:module'
import path from 'node:path'
import type { ActiveWindow } from '../../shared/types'
import { log } from '../util'

type Fn = (...args: unknown[]) => unknown
interface Api {
  GetForegroundWindow: Fn
  GetWindowTextW: Fn
  GetWindowThreadProcessId: Fn
  IsWindowVisible: Fn
  IsIconic: Fn
  ShowWindow: Fn
  SetForegroundWindow: Fn
  BringWindowToTop: Fn
  GetWindowRect: Fn
  GetWindow: Fn
  GetWindowLongW: Fn
  EnumWindows: Fn
  keybd_event: Fn
  GetClassNameW: Fn
  OpenProcess: Fn
  CloseHandle: Fn
  QueryFullProcessImageNameW: Fn
}

let api: Api | null | undefined

function load(): Api | null {
  if (api !== undefined) return api
  try {
    const require = createRequire(__filename)
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    const RECT = koffi.struct('KUMO_RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    const EnumProc = koffi.proto('bool __stdcall KumoEnumProc(intptr hwnd, intptr lParam)')
    api = {
      GetForegroundWindow: user32.func('intptr __stdcall GetForegroundWindow()'),
      GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr hWnd, _Out_ uint8_t *lpString, int nMaxCount)'),
      GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(intptr hWnd, _Out_ uint32 *lpdwProcessId)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr hWnd)'),
      IsIconic: user32.func('bool __stdcall IsIconic(intptr hWnd)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(intptr hWnd, int nCmdShow)'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(intptr hWnd)'),
      BringWindowToTop: user32.func('bool __stdcall BringWindowToTop(intptr hWnd)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr hWnd, _Out_ KUMO_RECT *lpRect)'),
      GetWindow: user32.func('intptr __stdcall GetWindow(intptr hWnd, uint32 uCmd)'),
      GetWindowLongW: user32.func('int32 __stdcall GetWindowLongW(intptr hWnd, int nIndex)'),
      EnumWindows: user32.func('bool __stdcall EnumWindows(KumoEnumProc *cb, intptr lParam)'),
      keybd_event: user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)'),
      GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr hWnd, _Out_ uint8_t *lpClassName, int nMaxCount)'),
      OpenProcess: kernel32.func('intptr __stdcall OpenProcess(uint32 dwDesiredAccess, bool bInheritHandle, uint32 dwProcessId)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(intptr hObject)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr hProcess, uint32 dwFlags, _Out_ uint8_t *lpExeName, _Inout_ uint32 *lpdwSize)'),
    }
    void RECT
    void EnumProc
    return api
  } catch (e) {
    log('win32 api unavailable', e)
    api = null
    return null
  }
}

const text = (fn: Fn, hwnd: number, max = 512): string => {
  const buf = Buffer.alloc(max * 2)
  const n = Number(fn(hwnd, buf, max)) || 0
  return buf.toString('utf16le', 0, n * 2)
}

function pidOf(a: Api, hwnd: number): number {
  const out = [0]
  a.GetWindowThreadProcessId(hwnd, out)
  return Number(out[0]) || 0
}

const nameCache = new Map<number, string>()

export function exePath(pid: number): string {
  const a = load()
  if (!a || !pid) return ''
  const h = Number(a.OpenProcess(0x1000, false, pid))
  if (!h) return ''
  try {
    const buf = Buffer.alloc(1040)
    const size = [520]
    if (!a.QueryFullProcessImageNameW(h, 0, buf, size)) return ''
    return buf.toString('utf16le', 0, Number(size[0]) * 2)
  } finally {
    a.CloseHandle(h)
  }
}

const FRIENDLY: Record<string, string> = {
  code: 'VS Code',
  'code - insiders': 'VS Code Insiders',
  cursor: 'Cursor',
  windowsterminal: 'Windows Terminal',
  claude: 'Claude',
  antigravity: 'Antigravity',
  explorer: 'File Explorer',
  chrome: 'Chrome',
  msedge: 'Edge',
  firefox: 'Firefox',
  zed: 'Zed',
  windsurf: 'Windsurf',
  devenv: 'Visual Studio',
  idea64: 'IntelliJ IDEA',
  webstorm64: 'WebStorm',
  pycharm64: 'PyCharm',
  rider64: 'Rider',
  powershell: 'PowerShell',
  pwsh: 'PowerShell',
  cmd: 'Command Prompt',
  notepad: 'Notepad',
  slack: 'Slack',
  figma: 'Figma',
}

export function appName(pid: number): string {
  const cached = nameCache.get(pid)
  if (cached) return cached
  const exe = path.basename(exePath(pid), '.exe')
  const name = FRIENDLY[exe.toLowerCase()] || exe || 'App'
  nameCache.set(pid, name)
  if (nameCache.size > 200) nameCache.clear()
  return name
}

export function foregroundWindow(ownPid: number): ActiveWindow | null {
  const a = load()
  if (!a) return null
  const hwnd = Number(a.GetForegroundWindow())
  if (!hwnd) return null
  const pid = pidOf(a, hwnd)
  if (!pid || pid === ownPid) return null
  const cls = text(a.GetClassNameW, hwnd, 128)
  if (cls === 'Progman' || cls === 'WorkerW' || cls === 'Shell_TrayWnd') return null
  return { app: appName(pid), title: text(a.GetWindowTextW, hwnd), pid, handle: String(hwnd) }
}

function topLevelWindows(a: Api): { hwnd: number; pid: number }[] {
  const list: { hwnd: number; pid: number }[] = []
  a.EnumWindows((hwnd: number) => {
    if (a.IsWindowVisible(hwnd) && !Number(a.GetWindow(hwnd, 4))) {
      const ex = Number(a.GetWindowLongW(hwnd, -20))
      const tool = (ex & 0x80) !== 0
      if (!tool && text(a.GetWindowTextW, hwnd, 8).length > 0) list.push({ hwnd, pid: pidOf(a, hwnd) })
    }
    return true
  }, 0)
  return list
}

function bring(a: Api, hwnd: number): boolean {
  if (a.IsIconic(hwnd)) a.ShowWindow(hwnd, 9)
  a.keybd_event(0x12, 0, 0, 0)
  a.keybd_event(0x12, 0, 2, 0)
  a.BringWindowToTop(hwnd)
  return Boolean(a.SetForegroundWindow(hwnd))
}

export function focusHandle(handle: string): boolean {
  const a = load()
  if (!a) return false
  const hwnd = Number(handle)
  if (!hwnd || !a.IsWindowVisible(hwnd)) return false
  return bring(a, hwnd)
}

export function focusPids(pids: number[]): boolean {
  const a = load()
  if (!a || !pids.length) return false
  const wins = topLevelWindows(a)
  for (const pid of pids) {
    const w = wins.find((x) => x.pid === pid)
    if (w) return bring(a, w.hwnd)
  }
  return false
}

export function focusApp(match: RegExp): boolean {
  const a = load()
  if (!a) return false
  for (const w of topLevelWindows(a)) {
    if (match.test(path.basename(exePath(w.pid)))) return bring(a, w.hwnd)
  }
  return false
}

export function foregroundFullscreen(ownPid: number, physicalBounds: { x: number; y: number; width: number; height: number }): boolean {
  const a = load()
  if (!a) return false
  const hwnd = Number(a.GetForegroundWindow())
  if (!hwnd) return false
  const pid = pidOf(a, hwnd)
  if (pid === ownPid) return false
  const cls = text(a.GetClassNameW, hwnd, 128)
  if (cls === 'Progman' || cls === 'WorkerW') return false
  const r = { left: 0, top: 0, right: 0, bottom: 0 }
  if (!a.GetWindowRect(hwnd, r)) return false
  return (
    r.left <= physicalBounds.x &&
    r.top <= physicalBounds.y &&
    r.right >= physicalBounds.x + physicalBounds.width &&
    r.bottom >= physicalBounds.y + physicalBounds.height
  )
}
