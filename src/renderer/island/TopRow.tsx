import { AnimatePresence, motion } from 'motion/react'
import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import type { Mood, Snapshot } from '../../shared/types'
import { activityLine, busy, clock, liveSessions } from '../shared/format'
import { Kumo, type KumoHandle } from '../shared/Kumo'
import { useIsland, type Level } from './store'
import { agentOf, PhaseMark } from './ui'

interface Props {
  kumoRef: RefObject<KumoHandle | null>
  level: Level
  mood: Mood
  height: number
  notch: boolean
  notchWidth: number
  reduced: boolean
  now: number
  dark: boolean
  leaving: number
  onLabelWidth(w: number): void
  onAccWidth(w: number): void
}

function summary(snap: Snapshot | null): { text: string; tone: 'normal' | 'amber' | 'red' | 'green' } {
  if (!snap) return { text: '', tone: 'normal' }
  const live = liveSessions(snap)
  if (snap.approvals.length) {
    const a = snap.approvals[0]
    const name = agentOf(snap.agents, a.agent).name
    return { text: snap.approvals.length > 1 ? `${snap.approvals.length} requests need your OK` : `${name} needs your OK`, tone: 'amber' }
  }
  const waiting = live.find((s) => s.phase === 'question' || s.phase === 'waiting')
  if (waiting) return { text: `${waiting.project} is waiting for you`, tone: 'amber' }
  if (!live.length) return { text: 'Kumo', tone: 'normal' }
  if (live.length === 1) {
    const s = live[0]
    return { text: `${s.project} · ${activityLine(s)}`, tone: s.phase === 'error' ? 'red' : 'normal' }
  }
  const working = live.filter(busy).length
  const errors = live.filter((s) => s.phase === 'error').length
  if (errors && !working) return { text: `${live.length} sessions · ${errors} stopped`, tone: 'red' }
  return { text: working === live.length ? `${working} sessions working` : working ? `${working} of ${live.length} sessions working` : `${live.length} sessions · all quiet`, tone: 'normal' }
}

export function TopRow({ kumoRef, level, mood, height, notch, notchWidth, reduced, now, dark, leaving, onLabelWidth, onAccWidth }: Props) {
  const snap = useIsland((s) => s.snap)
  const settings = useIsland((s) => s.settings)
  const labelRef = useRef<HTMLSpanElement>(null)
  const accRef = useRef<HTMLSpanElement>(null)
  const live = liveSessions(snap)
  const sum = useMemo(() => summary(snap), [snap])

  const charSize = notch ? Math.max(22, height - 8) : 28
  const showLabel = leaving ? false : notch ? level === 'open' || level === 'peek' || level === 'notify' : level !== 'idle' && level !== 'hidden'
  const approvals = snap?.approvals.length ?? 0
  const anyBusy = live.some(busy)
  const single = live.length === 1 ? live[0] : null

  let acc: React.ReactNode = null
  if (approvals) acc = <PhaseMark phase="waiting" />
  else if (anyBusy) acc = <PhaseMark phase={live.some((s) => s.phase === 'working') ? 'working' : 'thinking'} />
  else if (live.some((s) => s.phase === 'error')) acc = <PhaseMark phase="error" />
  else if (live.length && live.every((s) => s.phase === 'done')) acc = <PhaseMark phase="done" />
  const count = approvals ? (approvals > 1 ? approvals : 0) : live.length > 1 ? live.length : 0
  const elapsed = single && busy(single) ? clock(now - (single.steps.find((x) => x.kind === 'prompt' && x.at > single.phaseSince - 3_600_000)?.at ?? single.phaseSince)) : ''
  const showAcc = !leaving && level !== 'idle' && level !== 'hidden' && (acc || count)

  useLayoutEffect(() => {
    onLabelWidth(showLabel && labelRef.current ? Math.min(labelRef.current.scrollWidth, 280) : 0)
  })
  useLayoutEffect(() => {
    onAccWidth(showAcc && accRef.current ? accRef.current.offsetWidth : 0)
  })

  const palette = useMemo(
    () => ({
      body: dark ? '#f4f4f6' : '#1d1d1f',
      eye: notch ? '#000000' : dark ? '#18181a' : '#fbfbfd',
      accent: mood === 'error' ? (dark ? '#ff5c58' : '#e0443e') : dark ? '#ffb547' : '#f0a020',
    }),
    [dark, notch, mood],
  )

  const wing = notch ? `calc((100% - ${notchWidth}px) / 2)` : undefined

  return (
    <div
      className={`top-row${notch ? ' notch' : ''}`}
      style={{ height }}
      onClick={() => {
        const s = useIsland.getState()
        if (s.override === 'open') {
          kumoRef.current?.nudge()
          return
        }
        if (s.override === 'notify' && s.notify) {
          s.open('session', { focus: true, sessionKey: s.notify.key, reset: true })
          return
        }
        s.open(s.snap?.approvals.length ? 'approval' : s.settings && !s.settings.onboarded ? 'welcome' : 'home', { focus: true, reset: true })
      }}
    >
      <div className="top-left" style={notch ? { width: wing } : undefined}>
        <motion.span
          className="char-slot"
          style={{ width: charSize, height: charSize }}
          onMouseEnter={() => kumoRef.current?.nudge()}
          initial={false}
          animate={
            leaving >= 3
              ? { y: -charSize - 8, scaleY: 1.12, scaleX: 0.9, opacity: 0 }
              : leaving === 2
                ? { y: 3, scaleY: 0.86, scaleX: 1.08, opacity: 1 }
                : { y: 0, scaleY: 1, scaleX: 1, opacity: 1 }
          }
          transition={
            leaving >= 3
              ? { y: { duration: 0.34, ease: [0.55, 0, 0.75, 0.25] }, opacity: { duration: 0.2, delay: 0.16 }, scaleX: { duration: 0.2 }, scaleY: { duration: 0.2 } }
              : { type: 'spring', stiffness: 520, damping: 26 }
          }
        >
          <Kumo ref={kumoRef} size={charSize} mood={mood} palette={palette} reduced={reduced} paused={level === 'hidden'} />
        </motion.span>
        <AnimatePresence initial={false}>
          {showLabel && (
            <motion.span
              key="label"
              ref={labelRef}
              className={`top-label tone-${sum.tone}`}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0, transition: { delay: reduced ? 0 : 0.1, duration: 0.2 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              {settings?.paused && <span className="paused-tag">Paused · </span>}
              {sum.text}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="top-right" style={notch ? { width: wing } : undefined}>
        <AnimatePresence initial={false}>
          {showAcc && (
            <motion.span
              key="acc"
              ref={accRef}
              className="top-acc"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1, transition: { delay: reduced ? 0 : 0.08 } }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.08 } }}
            >
              {acc}
              {count ? <span className="top-count">{count}</span> : elapsed && level !== 'active' ? <span className="top-count mono">{elapsed}</span> : elapsed && !notch ? <span className="top-count mono">{elapsed}</span> : null}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
