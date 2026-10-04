import { tr } from '../shared/i18n'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AgentDescriptor, Phase, Session } from '../../shared/types'
import { activityLine, ago, busy, phaseTone } from '../shared/format'
import { AgentGlyph, Icon, type IconName } from '../shared/icons'
import { useIsland } from './store'

export function Button({
  children,
  kind = 'secondary',
  icon,
  kbd,
  onClick,
  disabled,
  title,
  className = '',
  autoFocus,
}: {
  children?: ReactNode
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger'
  icon?: IconName
  kbd?: string
  onClick?: () => void
  disabled?: boolean
  title?: string
  className?: string
  autoFocus?: boolean
}) {
  return (
    <button type="button" className={`btn btn-${kind} ${className}`} onClick={onClick} disabled={disabled} title={title} autoFocus={autoFocus}>
      {icon && <Icon name={icon} size={14} />}
      {children && <span>{children}</span>}
      {kbd && <kbd>{kbd}</kbd>}
    </button>
  )
}

export function IconButton({ icon, title, onClick, active, size = 16, className = '' }: { icon: IconName; title: string; onClick?: () => void; active?: boolean; size?: number; className?: string }) {
  return (
    <button type="button" className={`icon-btn${active ? ' active' : ''} ${className}`} onClick={onClick} title={title} aria-label={title}>
      <Icon name={icon} size={size} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: string; badge?: number }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className={`segmented seg-${size}`} role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="seg-pill" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
          <span className="seg-label">
            {o.label}
            {o.badge ? <span className="seg-badge">{o.badge}</span> : null}
          </span>
        </button>
      ))}
    </div>
  )
}

export function PhaseMark({ phase, size = 'md' }: { phase: Phase; size?: 'sm' | 'md' }) {
  const tone = phaseTone(phase)
  if (phase === 'working') {
    const d = size === 'sm' ? 12 : 14
    return (
      <span className={`orbit tone-${tone}`} style={{ width: d, height: d }} role="img" aria-label="working">
        <svg viewBox="0 0 16 16" width={d} height={d}>
          <circle className="orbit-track" cx="8" cy="8" r="6" />
          <circle className="orbit-arc" cx="8" cy="8" r="6" pathLength="100" />
        </svg>
      </span>
    )
  }
  if (phase === 'thinking')
    return (
      <span className={`ellipsis ellipsis-${size} tone-${tone}`} role="img" aria-label="thinking">
        <i />
        <i />
        <i />
      </span>
    )
  if (phase === 'done') return <Icon name="check" size={size === 'sm' ? 12 : 13} className="tone-text-green" strokeWidth={1.8} />
  return <span className={`dot dot-${size} tone-${tone}${phase === 'waiting' || phase === 'question' ? ' pulse' : ''}`} aria-label={phase} />
}

export function agentOf(agents: AgentDescriptor[], id: string): AgentDescriptor {
  return agents.find((a) => a.id === id) || { id, name: id, mark: id.charAt(0).toUpperCase(), color: '#8e8e93', capabilities: { approvals: false, contextInjection: false, launch: false } }
}

export function SessionRow({ s, agent, now, onClick, compact }: { s: Session; agent: AgentDescriptor; now: number; onClick: () => void; compact?: boolean }) {
  const line = activityLine(s)
  return (
    <button className={`session-row${compact ? ' compact' : ''} phase-${s.phase}`} onClick={onClick}>
      <span className="session-glyph" style={{ ['--agent' as string]: agent.color }}>
        <AgentGlyph agent={agent.id} color={agent.color} size={compact ? 12 : 13} mark={agent.mark} />
      </span>
      <span className="session-main">
        <span className="session-title">
          <span className="session-project">{s.project}</span>
          {!compact && s.task && <span className="session-task">{s.task}</span>}
        </span>
        <span className={`session-line${busy(s) ? ' shimmer' : ''}`}>{line}</span>
      </span>
      <span className="session-side">
        <PhaseMark phase={s.phase} size="sm" />
        <span className="session-time">{ago(busy(s) ? s.phaseSince : s.updatedAt, now)}</span>
      </span>
    </button>
  )
}

export function EmptyState({ icon, title, body, children }: { icon?: ReactNode; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div className="empty-title">{title}</div>
      {body && <div className="empty-body">{body}</div>}
      {children && <div className="empty-actions">{children}</div>}
    </div>
  )
}

export function Menu({ trigger, items, align = 'left', up }: { trigger: (open: boolean, toggle: () => void) => ReactNode; items: ({ label: string; hint?: string; icon?: IconName; logo?: ReactNode; onClick: () => void; checked?: boolean; disabled?: boolean } | 'sep' | { header: string })[]; align?: 'left' | 'right'; up?: boolean }) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<{ up: boolean; max: number }>({ up: Boolean(up), max: 320 })
  const ref = useRef<HTMLDivElement>(null)
  const toggle = (): void => {
    if (!open && ref.current) {
      const t = ref.current.getBoundingClientRect()
      const box = (ref.current.closest('.view') || ref.current.closest('.body') || ref.current.closest('.surface') || document.body).getBoundingClientRect()
      const below = box.bottom - t.bottom - 10
      const above = t.top - box.top - 10
      const wantUp = up ? above > 120 || above > below : below < 160 && above > below
      setPlace({ up: wantUp, max: Math.max(100, Math.min(320, wantUp ? above : below)) })
    }
    setOpen((v) => !v)
  }
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(open, toggle)}
      <AnimatePresence>
        {open && (
          <motion.div
            className={`menu menu-${align}${place.up ? ' menu-up' : ''}`}
            style={{ maxHeight: place.max }}
            initial={{ opacity: 0, scale: 0.96, y: place.up ? 4 : -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 600, damping: 38 }}
            role="menu"
          >
            {items.map((it, i) =>
              it === 'sep' ? (
                <div key={i} className="menu-sep" />
              ) : 'header' in it ? (
                <div key={i} className="menu-header">
                  {it.header}
                </div>
              ) : (
                <button
                  key={i}
                  className="menu-item"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false)
                    it.onClick()
                  }}
                >
                  <span className="menu-icon">{it.checked ? <Icon name="check" size={13} /> : it.logo ? it.logo : it.icon ? <Icon name={it.icon} size={14} /> : null}</span>
                  <span className="menu-label">{it.label}</span>
                  {it.hint && <span className="menu-hint">{it.hint}</span>}
                </button>
              ),
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function useAction() {
  const toast = useIsland((s) => s.showToast)
  return async (p: Promise<{ ok: boolean; error?: string; value?: unknown }>, success?: string): Promise<boolean> => {
    const r = await p
    if (!r.ok) toast(r.error || tr('Something went wrong'), 'error')
    else if (r.error) toast(r.error)
    else if (typeof r.value === 'string' && r.value) toast(r.value, 'success')
    else if (success) toast(success, 'success')
    return r.ok
  }
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {right}
    </div>
  )
}
