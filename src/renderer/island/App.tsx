import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DisplayInfo, Mood } from '../../shared/types'
import { busy, liveSessions, moodFor } from '../shared/format'
import { useNow, useSettings, useSnapshot, useTheme } from '../shared/hooks'
import type { KumoHandle } from '../shared/Kumo'
import { configureSound, play } from '../shared/sound'
import { Body } from './Body'
import { useChat, useIsland, type Level } from './store'
import { Tooltips } from './Tooltips'
import { TopRow } from './TopRow'


const FLOAT_H = 36

interface Geo {
  w: number
  h: number
  r: number
  visible: boolean
}

function geometry(level: Level, d: DisplayInfo, labelW: number, accW: number, bodyH: number): Geo & { h0: number } {
  const win = d.platform === 'win32'
  if (d.mode === 'notch') {
    const h0 = Math.max(d.notchHeight, 30)
    const nw = d.notchWidth || 190
    const wingIdle = h0 + 4
    const wingActive = Math.max(wingIdle, accW + 22)
    switch (level) {
      case 'hidden':
        return { w: nw, h: h0, r: 8, visible: true, h0 }
      case 'idle':
        return { w: nw + 2 * wingIdle, h: h0, r: 10, visible: true, h0 }
      case 'active':
        return { w: nw + 2 * wingActive, h: h0, r: 12, visible: true, h0 }
      case 'peek':
        return { w: Math.max(nw + 2 * wingActive, 540), h: h0 + bodyH, r: 22, visible: true, h0 }
      case 'notify':
        return { w: Math.max(nw + 2 * wingActive, 460), h: h0 + bodyH, r: 22, visible: true, h0 }
      case 'open':
        return { w: 640, h: h0 + bodyH, r: 26, visible: true, h0 }
    }
  }
  const h0 = FLOAT_H
  const big = win ? 14 : 22
  switch (level) {
    case 'hidden':
      return { w: 48, h: h0, r: 18, visible: false, h0 }
    case 'idle':
      return { w: 48, h: h0, r: 18, visible: true, h0 }
    case 'active':
      return { w: Math.min(400, Math.max(110, 44 + labelW + (accW ? accW + 12 : 0) + 14)), h: h0, r: 18, visible: true, h0 }
    case 'peek':
      return { w: 520, h: h0 + bodyH, r: win ? 12 : 20, visible: true, h0 }
    case 'notify':
      return { w: 420, h: h0 + bodyH, r: win ? 12 : 20, visible: true, h0 }
    case 'open':
      return { w: 620, h: h0 + bodyH, r: big, visible: true, h0 }
  }
}

export function App() {
  const theme = useTheme()
  const settings = useSettings()
  const snap = useSnapshot()
  const st = useIsland()
  const set = st.set
  const kumo = useRef<KumoHandle>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [labelW, setLabelW] = useState(0)
  const [accW, setAccW] = useState(0)
  const [bodyH, setBodyH] = useState(0)
  const lastMove = useRef(Date.now())
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notifyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevApprovals = useRef(0)
  const reduced = settings?.motion === 'reduced'

  useEffect(() => set({ snap }), [snap, set])
  useEffect(() => {
    set({ settings })
    if (settings) configureSound(settings.sounds, settings.volume)
  }, [settings, set])

  useEffect(() => {
    void window.kumo.display().then((d) => d && set({ display: d }))
    return window.kumo.onDisplay((d) => set({ display: d }))
  }, [set])

  useEffect(() => {
    const t = (): void => play('done')
    window.addEventListener('kumo:test-sound', t)
    return () => window.removeEventListener('kumo:test-sound', t)
  }, [])

  const live = liveSessions(snap)
  const approvals = snap?.approvals.length ?? 0
  const now = useNow(1000, live.length > 0)

  const baseLevel: Level = live.length || approvals ? 'active' : settings?.idle === 'hide' ? 'hidden' : 'idle'
  const level: Level = st.override ?? baseLevel
  const expanded = level === 'peek' || level === 'notify' || level === 'open'

  const mood: Mood = useMemo(() => (st.leaving >= 2 ? 'sleeping' : moodFor(snap, now, st.away && !live.some(busy))), [snap, now, st.away, live, st.leaving])

  useEffect(() => {
    return window.kumo.onPointer((p) => {
      lastMove.current = Date.now()
      const s = useIsland.getState()
      if (s.leaving) return
      if (s.away) s.set({ away: false })
      kumo.current?.look(Math.tanh(p.gx / 280), Math.tanh(p.gy / 180))
      if (p.inside !== s.hovering) {
        s.set({ hovering: p.inside })
        if (p.inside) {
          if (leaveTimer.current) clearTimeout(leaveTimer.current)
          if (idleTimer.current) clearTimeout(idleTimer.current)
          if (!s.override || s.override === null) {
            if (hoverTimer.current) clearTimeout(hoverTimer.current)
            hoverTimer.current = setTimeout(() => {
              const cur = useIsland.getState()
              if (cur.hovering && !cur.override) cur.set({ override: 'peek' })
            }, cur0Delay())
          }
        } else {
          if (hoverTimer.current) clearTimeout(hoverTimer.current)
          if (s.override === 'peek') {
            leaveTimer.current = setTimeout(() => {
              const cur = useIsland.getState()
              if (!cur.hovering && cur.override === 'peek') cur.set({ override: null })
            }, 380)
          }
          armIdleCollapse()
        }
      }
    })
    function cur0Delay(): number {
      return useIsland.getState().snap?.sessions.length ? 200 : 320
    }
  }, [])

  const armIdleCollapse = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current)
    const s = useIsland.getState()
    if (s.override !== 'open' || s.view === 'approval' || s.view === 'drop') return
    const base = s.settings?.autoCollapseSec ?? 30
    if (!base) return
    const secs = s.focused ? Math.max(base, 120) : base
    idleTimer.current = setTimeout(() => {
      const cur = useIsland.getState()
      const busyChat = cur.view === 'chat' && (useChat.getState().draft.trim() || useChat.getState().streaming)
      if (cur.override === 'open' && !cur.hovering && cur.view !== 'approval' && !cur.dialogOpen && !busyChat) cur.collapse()
      else if (cur.override === 'open' && !cur.hovering) armIdleCollapse()
    }, secs * 1000)
  }, [])

  useEffect(() => {
    const t = setInterval(() => {
      const mins = useIsland.getState().settings?.awayMinutes ?? 5
      const away = Date.now() - lastMove.current > mins * 60_000
      if (away !== useIsland.getState().away) set({ away })
    }, 10_000)
    return () => clearInterval(t)
  }, [set])

  useEffect(() => {
    return window.kumo.onAlert(({ kind, sessionKey }) => {
      const s = useIsland.getState()
      const paused = s.settings?.paused
      if (kind === 'approval') {
        if (!paused) {
          if (s.view !== 'approval' || s.override !== 'open') s.open('approval')
          play('approval')
        }
        return
      }
      if (kind === 'resolved') return
      if (paused) return
      if (s.settings?.presence === 'tray') {
        if (kind === 'done') play('done')
        else if (kind === 'error') play('error')
        else play('attention')
        return
      }
      if (kind === 'done') {
        play('done')
        if (!s.settings?.showCompletion) return
      } else if (kind === 'error') play('error')
      else play('attention')
      if (s.override === 'open') return
      s.set({ override: 'notify', notify: { key: sessionKey, kind } })
      if (notifyTimer.current) clearTimeout(notifyTimer.current)
      const ms = kind === 'done' ? 6000 : kind === 'error' ? 9000 : 20000
      notifyTimer.current = setTimeout(function expire() {
        const cur = useIsland.getState()
        if (cur.override !== 'notify') return
        if (cur.hovering) {
          notifyTimer.current = setTimeout(expire, 1500)
          return
        }
        cur.set({ override: null, notify: null })
      }, ms)
    })
  }, [])

  useEffect(() => {
    const s = useIsland.getState()
    if (approvals === 0 && prevApprovals.current > 0 && s.view === 'approval') {
      if (s.pinned) s.back()
      else s.collapse()
    }
    if (approvals > 0 && prevApprovals.current === 0 && !s.settings?.paused && s.view !== 'approval') s.open('approval')
    prevApprovals.current = approvals
  }, [approvals])

  useEffect(() => {
    return window.kumo.onCommand((c) => {
      const s = useIsland.getState()
      switch (c.type) {
        case 'toggle':
          if (s.override === 'open') s.collapse()
          else s.open(s.snap?.approvals.length ? 'approval' : s.view === 'drop' ? 'home' : undefined, { focus: true })
          break
        case 'expand':
          s.open(s.settings && !s.settings.onboarded ? 'welcome' : s.snap?.approvals.length ? 'approval' : undefined, { focus: s.settings?.onboarded !== false })
          break
        case 'collapse':
          s.collapse()
          break
        case 'chat':
          s.open('chat', { focus: true })
          break
        case 'new-session':
          s.open('launch', { focus: true })
          break
        case 'focus-approval':
          s.open('approval', { focus: true })
          break
        case 'goodbye': {
          const reducedMotion = s.settings?.motion === 'reduced'
          if (reducedMotion) {
            s.set({ leaving: 4 })
            setTimeout(() => window.kumo.goodbyeDone(), 160)
            break
          }
          const wasOpen = s.override !== null
          s.collapse()
          s.set({ leaving: 1 })
          const t1 = wasOpen ? 380 : 60
          setTimeout(() => useIsland.getState().set({ leaving: 2 }), t1)
          setTimeout(() => useIsland.getState().set({ leaving: 3 }), t1 + 260)
          setTimeout(() => useIsland.getState().set({ leaving: 4 }), t1 + 620)
          setTimeout(() => window.kumo.goodbyeDone(), t1 + 980)
          break
        }
        case 'decide': {
          const a = s.snap?.approvals[0]
          if (a && c.behavior) {
            void window.kumo.decide({ id: a.id, behavior: c.behavior })
            play(c.behavior === 'allow' ? 'send' : 'close')
          }
          break
        }
      }
    })
  }, [])

  useEffect(() => {
    const wantFocus = st.override === 'open' && st.pinned
    window.kumo.setExpanded(st.override === 'open')
    window.kumo.setFocusable(wantFocus)
    if (st.override === 'open' && st.pinned) play('open')
    if (st.override === 'open') armIdleCollapse()
  }, [st.override, st.pinned, armIdleCollapse])

  useEffect(() => {
    const onFocus = (): void => set({ focused: true })
    const onBlur = (): void => {
      set({ focused: false })
      const s = useIsland.getState()
      if (s.dialogOpen) return
      setTimeout(() => {
        const cur = useIsland.getState()
        if (!cur.focused && cur.override === 'open' && cur.view !== 'approval' && !cur.dialogOpen && !cur.hovering) cur.collapse()
        else armIdleCollapse()
      }, 160)
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [set, armIdleCollapse])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useIsland.getState()
      if (s.override !== 'open') return
      const typing = (e.target as HTMLElement)?.closest('input, textarea, [contenteditable]')
      if (e.key === 'Escape') {
        if (typing && (e.target as HTMLInputElement).value) return
        e.preventDefault()
        if (s.view === 'approval') return
        if (s.history.length && s.view !== 'home') s.back()
        else s.collapse()
        return
      }
      armIdleCollapse()
      const mod = e.metaKey || e.ctrlKey
      if (mod && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault()
        s.open(e.key === '1' ? 'home' : e.key === '2' ? 'chat' : 'context')
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        s.open('launch')
      }
      if (mod && e.key === ',') {
        e.preventDefault()
        window.kumo.openSettings()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [armIdleCollapse])

  const d = st.display
  const baseGeo = d ? geometry(level, d, labelW, accW, expanded ? bodyH : 0) : null
  const geo =
    baseGeo && d && st.leaving >= 1
      ? st.leaving >= 4
        ? d.mode === 'notch'
          ? { ...baseGeo, w: d.notchWidth || 190, r: 8 }
          : { ...baseGeo, w: 36, h: 36, r: 18, visible: false }
        : st.leaving >= 3 && d.mode !== 'notch'
          ? { ...baseGeo, w: 48 }
          : baseGeo
      : baseGeo
  const maxBody = d ? d.height - d.top - (geo?.h0 ?? 36) - 28 : 500

  const [vw, setVw] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setVw(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useEffect(() => {
    if (expanded) {
      window.kumo.setCompact(false)
      return
    }
    const t = setTimeout(() => window.kumo.setCompact(true), 450)
    return () => clearTimeout(t)
  }, [expanded])

  useLayoutEffect(() => {
    if (!d || !geo) return
    const x = Math.round((vw - geo.w) / 2)
    if (!geo.visible) window.kumo.setHitRect({ x: Math.round(vw / 2 - 120), y: 0, w: 240, h: Math.max(6, d.top) })
    else window.kumo.setHitRect({ x: x - (d.mode === 'notch' ? 12 : 0), y: d.top, w: geo.w + (d.mode === 'notch' ? 24 : 0), h: geo.h })
  }, [d, vw, geo?.w, geo?.h, geo?.visible])

  const spring: Transition = reduced
    ? { duration: 0.16, ease: [0.22, 1, 0.36, 1] }
    : expanded
      ? { type: 'spring', stiffness: 430, damping: 36, mass: 0.9 }
      : { type: 'spring', stiffness: 520, damping: 46, mass: 0.9 }

  const onSurfaceDown = (): void => {
    const s = useIsland.getState()
    if (s.override === 'open' && !s.pinned) s.set({ pinned: true })
  }

  const dragDepth = useRef(0)
  const preDrag = useRef<{ override: typeof st.override; view: typeof st.view } | null>(null)
  const onDragEnter = (e: React.DragEvent): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragDepth.current++
    if (dragDepth.current === 1) {
      const s = useIsland.getState()
      preDrag.current = { override: s.override, view: s.view }
      if (s.override === 'open' && s.view === 'chat') s.set({ dropTarget: 'chat', chatDrag: true, pinned: true })
      else {
        s.set({ dropTarget: 'context' })
        s.open('drop')
      }
    }
  }
  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) {
      setTimeout(() => {
        const s = useIsland.getState()
        if (dragDepth.current === 0 && s.chatDrag) s.set({ chatDrag: false })
        if (dragDepth.current === 0 && s.view === 'drop') {
          const p = preDrag.current
          if (!p || p.override !== 'open') s.collapse()
          else s.set({ view: p.view === 'drop' ? 'home' : p.view })
        }
      }, 200)
    }
  }
  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    dragDepth.current = 0
    const paths = [...e.dataTransfer.files].map((f) => window.kumo.pathForFile(f)).filter(Boolean)
    const s = useIsland.getState()
    const toChat = s.dropTarget === 'chat'
    s.set({ chatDrag: false })
    const back = toChat ? 'chat' : 'context'
    if (!paths.length) {
      s.set({ view: back })
      return
    }
    const items = await window.kumo.addContext(paths, toChat)
    play('drop')
    kumo.current?.nudge()
    if (toChat && items.length) {
      const c = useChat.getState()
      c.set({ attachments: [...c.attachments, ...items.map((i) => i.id).filter((id) => !c.attachments.includes(id))] })
    }
    s.set({ view: back, pinned: true })
    if (!items.length) s.showToast('Those files could not be read', 'error')
  }

  if (!d || !geo) return null
  const notch = d.mode === 'notch'
  const surfaceTheme = notch ? 'dark' : theme

  return (
    <div className={`stage mode-${d.mode}`} style={{ paddingTop: d.top }} onDragOver={(e) => e.preventDefault()}>
      <motion.div
        ref={surfaceRef}
        className={`surface level-${level}${notch ? ' notch' : ''}`}
        data-theme={surfaceTheme}
        initial={false}
        animate={{
          width: geo.w,
          height: geo.h,
          borderBottomLeftRadius: geo.r,
          borderBottomRightRadius: geo.r,
          borderTopLeftRadius: notch ? 0 : geo.r,
          borderTopRightRadius: notch ? 0 : geo.r,
          opacity: geo.visible ? 1 : 0,
          y: geo.visible ? 0 : -(d.top + geo.h + 8),
        }}
        transition={spring}
        onMouseDown={onSurfaceDown}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDrop={(e) => void onDrop(e)}
      >
        {notch && (
          <>
            <span className="shoulder left" />
            <span className="shoulder right" />
          </>
        )}
        <TopRow kumoRef={kumo} level={level} mood={mood} height={geo.h0} notch={notch} notchWidth={d.notchWidth} onLabelWidth={setLabelW} onAccWidth={setAccW} reduced={reduced} now={now} dark={surfaceTheme === 'dark'} leaving={st.leaving} />
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              key="body"
              className="body"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: reduced ? 0.1 : 0.22, delay: reduced ? 0 : 0.06 } }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              <Body level={level} maxHeight={maxBody} onHeight={setBodyH} kumoRef={kumo} mood={mood} now={now} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <Tooltips />
    </div>
  )
}
