import { createRequire } from 'node:module'
import { isMac, log } from '../util'

type Ptr = unknown
type Fn = (...args: unknown[]) => unknown

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Insets {
  top: number
  left: number
  bottom: number
  right: number
}

export interface ObjC {
  cls(name: string): Ptr
  send(obj: Ptr, name: string, ...args: unknown[]): Ptr | null
  int(obj: Ptr, name: string): number | null
  count(obj: Ptr): number
  str(obj: Ptr, name: string): string | null
  rect(obj: Ptr, name: string): Rect | null
  insets(obj: Ptr, name: string): Insets | null
  nsString(s: string): Ptr
  pool<T>(fn: () => T): T
  cg: { windowList(option: number): Ptr; release(p: Ptr): void }
}

let rt: ObjC | null | undefined

export function objc(): ObjC | null {
  if (rt !== undefined) return rt
  rt = null
  if (!isMac) return null
  try {
    const require = createRequire(__filename)
    const koffi = require('koffi')
    const lib = koffi.load('/usr/lib/libobjc.A.dylib')
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
    const cgLib = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
    const RectT = koffi.struct('KumoNSRect', { x: 'double', y: 'double', w: 'double', h: 'double' })
    const InsetsT = koffi.struct('KumoNSEdgeInsets', { top: 'double', left: 'double', bottom: 'double', right: 'double' })
    const msgStruct = process.arch === 'x64' ? 'objc_msgSend_stret' : 'objc_msgSend'
    const getClass = lib.func('void *objc_getClass(const char *name)') as Fn
    const selReg = lib.func('void *sel_registerName(const char *name)') as Fn
    const poolPush = lib.func('void *objc_autoreleasePoolPush()') as Fn
    const poolPop = lib.func('void objc_autoreleasePoolPop(void *pool)') as Fn
    const m = {
      ptr: lib.func('objc_msgSend', 'void *', ['void *', 'void *']) as Fn,
      ptrPtr: lib.func('objc_msgSend', 'void *', ['void *', 'void *', 'void *']) as Fn,
      ptrIdx: lib.func('objc_msgSend', 'void *', ['void *', 'void *', 'uint64']) as Fn,
      ptrStr: lib.func('objc_msgSend', 'void *', ['void *', 'void *', 'const char *']) as Fn,
      flag: lib.func('objc_msgSend', 'uint8', ['void *', 'void *', 'void *']) as Fn,
      i32: lib.func('objc_msgSend', 'int32', ['void *', 'void *']) as Fn,
      u64: lib.func('objc_msgSend', 'uint64', ['void *', 'void *']) as Fn,
      cstr: lib.func('objc_msgSend', 'const char *', ['void *', 'void *']) as Fn,
      rect: lib.func(msgStruct, RectT, ['void *', 'void *']) as Fn,
      insets: lib.func(msgStruct, InsetsT, ['void *', 'void *']) as Fn,
    }
    const windowList = cgLib.func('void *CGWindowListCopyWindowInfo(uint32 option, uint32 relativeToWindow)') as Fn
    const cfRelease = cf.func('void CFRelease(void *cf)') as Fn
    const sels = new Map<string, Ptr>()
    const sel = (name: string): Ptr => {
      let s = sels.get(name)
      if (!s) sels.set(name, (s = selReg(name)))
      return s
    }
    const responds = (obj: Ptr, name: string): boolean => Boolean(obj) && Number(m.flag(obj, sel('respondsToSelector:'), sel(name))) !== 0
    rt = {
      cls: (name) => getClass(name),
      send(obj, name, ...args) {
        if (!responds(obj, name)) return null
        if (!args.length) return m.ptr(obj, sel(name))
        if (typeof args[0] === 'number') return m.ptrIdx(obj, sel(name), args[0])
        if (typeof args[0] === 'string') return m.ptrStr(obj, sel(name), args[0])
        return m.ptrPtr(obj, sel(name), args[0])
      },
      int: (obj, name) => (responds(obj, name) ? Number(m.i32(obj, sel(name))) : null),
      count: (obj) => (responds(obj, 'count') ? Number(m.u64(obj, sel('count'))) : 0),
      str: (obj, name) => (responds(obj, name) ? ((m.cstr(obj, sel(name)) as string | null) ?? null) : null),
      rect: (obj, name) => (responds(obj, name) ? (m.rect(obj, sel(name)) as Rect) : null),
      insets: (obj, name) => (responds(obj, name) ? (m.insets(obj, sel(name)) as Insets) : null),
      nsString: (s) => m.ptrStr(getClass('NSString'), sel('stringWithUTF8String:'), s),
      pool(fn) {
        const p = poolPush()
        try {
          return fn()
        } finally {
          poolPop(p)
        }
      },
      cg: { windowList: (option) => windowList(option, 0), release: (p) => cfRelease(p) },
    }
  } catch (e) {
    log('objc runtime unavailable', (e as Error).message)
  }
  return rt
}
