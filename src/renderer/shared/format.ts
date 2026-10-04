import type { Mood, Phase, Session, Snapshot } from '../../shared/types'
import { tr } from './i18n'

export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 5) return tr('now')
  if (s < 60) return tr('{0}s', s)
  const m = Math.floor(s / 60)
  if (m < 60) return tr('{0}m', m)
  const h = Math.floor(m / 60)
  if (h < 24) return tr('{0}h', h)
  return tr('{0}d', Math.floor(h / 24))
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function bytes(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function base(p: string): string {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p
}

export function shortPath(p: string, cwd?: string): string {
  if (cwd && p.toLowerCase().startsWith(cwd.toLowerCase())) return p.slice(cwd.length).replace(/^[\\/]/, '') || base(p)
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : p
}

export const PHASE_LABEL: Record<Phase, string> = {
  idle: tr('Ready'),
  thinking: tr('Thinking'),
  working: tr('Working'),
  waiting: tr('Needs you'),
  question: tr('Has a question'),
  done: tr('Done'),
  error: tr('Stopped'),
  ended: tr('Ended'),
}

export function phaseTone(p: Phase): 'blue' | 'violet' | 'amber' | 'green' | 'red' | 'muted' {
  switch (p) {
    case 'working':
      return 'blue'
    case 'thinking':
      return 'violet'
    case 'waiting':
    case 'question':
      return 'amber'
    case 'done':
      return 'green'
    case 'error':
      return 'red'
    default:
      return 'muted'
  }
}

export function activityLine(s: Session): string {
  switch (s.phase) {
    case 'working':
      return s.current ? `${s.current.verb}${s.current.target ? ` ${s.current.target}` : ''}` : tr('Working')
    case 'thinking':
      return s.toolCount ? tr('Thinking about the next step') : tr('Thinking')
    case 'waiting':
      return s.notice || tr('Waiting for your approval')
    case 'question':
      return s.question?.text || tr('Has a question for you')
    case 'done':
      return s.summary ? firstSentence(s.summary) : tr('Finished')
    case 'error':
      return s.notice || tr('Stopped with an error')
    case 'ended':
      return s.notice || tr('Session ended')
    default:
      return s.notice || (s.task ? tr('Waiting for your next prompt') : tr('Ready'))
  }
}

export function firstSentence(t: string): string {
  const clean = t.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim()
  const m = /^(.{12,140}?[.!?])(\s|$)/.exec(clean)
  return m ? m[1] : clean.length > 140 ? `${clean.slice(0, 139)}…` : clean
}

export const liveSessions = (s: Snapshot | null): Session[] => (s ? s.sessions.filter((x) => x.phase !== 'ended') : [])
export const busy = (x: Session): boolean => x.phase === 'working' || x.phase === 'thinking'

export function moodFor(snap: Snapshot | null, now: number, away: boolean): Mood {
  if (!snap) return 'idle'
  if (snap.approvals.length) return 'waiting'
  const ss = snap.sessions
  if (ss.some((s) => s.phase === 'question' || s.phase === 'waiting')) return 'attention'
  if (ss.some((s) => s.phase === 'error' && now - s.phaseSince < 60_000)) return 'error'
  if (ss.some((s) => s.phase === 'done' && now - s.phaseSince < 3_500)) return 'success'
  if (ss.some((s) => s.phase === 'working')) return 'working'
  if (ss.some((s) => s.phase === 'thinking')) return 'thinking'
  return away ? 'sleeping' : 'idle'
}
