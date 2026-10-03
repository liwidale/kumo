import type { Display } from 'electron'
import { objc } from './platform/objc'
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

// Queried fresh each time: screens come and go, and AppKit already caches the list.
function nativeScreens(): ScreenInfo[] | null {
  const o = objc()
  if (!o) return null
  try {
    return o.pool(() => {
      const list = o.send(o.cls('NSScreen'), 'screens')
      const out: ScreenInfo[] = []
      for (let i = 0; i < o.count(list); i++) {
        const s = o.send(list, 'objectAtIndex:', i)
        const frame = o.rect(s, 'frame')
        if (!frame) continue
        // Older or future systems without these selectors simply report no notch.
        const insets = o.insets(s, 'safeAreaInsets')
        const left = o.rect(s, 'auxiliaryTopLeftArea')
        const right = o.rect(s, 'auxiliaryTopRightArea')
        out.push({ x: frame.x, width: frame.w, height: frame.h, insetTop: insets?.top ?? 0, leftW: left?.w ?? 0, rightW: right?.w ?? 0 })
      }
      return out
    })
  } catch (e) {
    log('notch: native query unavailable, using heuristic', (e as Error).message)
    return null
  }
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
