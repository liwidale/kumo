import type { Display } from 'electron'
import { createRequire } from 'node:module'
import { isMac, log } from './util'

export interface NotchGeometry {
  hasNotch: boolean
  width: number
  height: number
}

interface ScreenInfo {
  x: number
  width: number
  height: number
  insetTop: number
  leftW: number
  rightW: number
}

let native: ScreenInfo[] | null | undefined

function nativeScreens(): ScreenInfo[] | null {
  if (native !== undefined) return native
  native = null
  if (!isMac) return null
  try {
    const require = createRequire(__filename)
    const koffi = require('koffi')
    const objc = koffi.load('/usr/lib/libobjc.A.dylib')
    const Rect = koffi.struct('KumoNSRect', { x: 'double', y: 'double', w: 'double', h: 'double' })
    const Insets = koffi.struct('KumoNSEdgeInsets', { top: 'double', left: 'double', bottom: 'double', right: 'double' })
    const getClass = objc.func('void *objc_getClass(const char *name)')
    const sel = objc.func('void *sel_registerName(const char *name)')
    const msgPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *'])
    const msgPtrIdx = objc.func('objc_msgSend', 'void *', ['void *', 'void *', 'uint64'])
    const msgU64 = objc.func('objc_msgSend', 'uint64', ['void *', 'void *'])
    const msgRect = objc.func('objc_msgSend', Rect, ['void *', 'void *'])
    const msgInsets = objc.func('objc_msgSend', Insets, ['void *', 'void *'])
    const NSScreen = getClass('NSScreen')
    const list = msgPtr(NSScreen, sel('screens'))
    const count = Number(msgU64(list, sel('count')))
    const out: ScreenInfo[] = []
    for (let i = 0; i < count; i++) {
      const s = msgPtrIdx(list, sel('objectAtIndex:'), i)
      const frame = msgRect(s, sel('frame'))
      const insets = msgInsets(s, sel('safeAreaInsets'))
      const left = msgRect(s, sel('auxiliaryTopLeftArea'))
      const right = msgRect(s, sel('auxiliaryTopRightArea'))
      out.push({ x: frame.x, width: frame.w, height: frame.h, insetTop: insets.top, leftW: left.w, rightW: right.w })
    }
    native = out
  } catch (e) {
    log('notch: native query unavailable, using heuristic', (e as Error).message)
  }
  return native
}

export function notchFor(d: Display): NotchGeometry {
  if (!isMac) return { hasNotch: false, width: 0, height: 0 }
  const menuBar = d.workArea.y - d.bounds.y
  const info = nativeScreens()?.find((s) => Math.round(s.width) === d.bounds.width && Math.round(s.height) === d.bounds.height && Math.round(s.x) === d.bounds.x)
  if (info && info.insetTop > 0) {
    const width = info.leftW > 0 && info.rightW > 0 ? Math.round(info.width - info.leftW - info.rightW) : 190
    return { hasNotch: true, width, height: Math.round(info.insetTop) }
  }
  if (info) return { hasNotch: false, width: 0, height: menuBar }
  const notched = d.internal && menuBar >= 32
  return { hasNotch: notched, width: notched ? 190 : 0, height: notched ? menuBar : 0 }
}
