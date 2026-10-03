import { useEffect, useRef, useState } from 'react'
import type { Approval as A, Behavior } from '../../../shared/types'
import { lineDiff } from '../../shared/diff'
import { highlight, highlightLines, langFromPath } from '../../shared/syntax'
import { shortPath } from '../../shared/format'
import { AgentGlyph, Icon } from '../../shared/icons'
import { play } from '../../shared/sound'
import { useIsland } from '../store'
import { agentOf, Button, EmptyState, Menu } from '../ui'

function MiniDiff({ a }: { a: A }) {
  if (a.diff?.length) {
    return (
      <div className="ap-code diff scroll">
        {a.diff.map((h, i) => {
          const rows = lineDiff(h.before, h.after).slice(0, 40)
          const painted = highlightLines(
            rows.map((d) => d.l),
            langFromPath(h.path || a.subject),
          )
          return (
            <div key={i} className="ap-hunk">
              {rows.map((d, j) => (
                <div key={j} className={`dl ${d.t === '+' ? 'add' : d.t === '-' ? 'del' : 'ctx'}`}>
                  <span className="dl-sign">{d.t === '+' ? '+' : d.t === '-' ? '−' : ' '}</span>
                  {painted[j]?.length ? painted[j] : ' '}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    )
  }
  if (a.content)
    return (
      <div className="ap-code diff scroll">
        {highlightLines(a.content.split('\n').slice(0, 24), langFromPath(a.subject)).map((nodes, i) => (
          <div key={i} className="dl add">
            <span className="dl-sign">+</span>
            {nodes}
          </div>
        ))}
      </div>
    )
  return null
}

function ruleLabel(cmd: string): string {
  const w = cmd.trim().split(/\s+/)
  return w.length > 2 ? `${w.slice(0, 2).join(' ')} …` : cmd.trim()
}

export function Approval({ now }: { now: number }) {
  const snap = useIsland((s) => s.snap)
  const focused = useIsland((s) => s.focused)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const list = snap?.approvals ?? []
  const a = list[Math.min(index, list.length - 1)]
  const cardRef = useRef<HTMLDivElement>(null)
  const [tick, setTick] = useState(Date.now())

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 250)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (index >= list.length && list.length) setIndex(list.length - 1)
  }, [list.length, index])

  const decide = async (behavior: Behavior, remember?: string): Promise<void> => {
    if (!a || busy) return
    setBusy(true)
    play(behavior === 'allow' ? 'send' : 'close')
    const r = await window.kumo.decide({ id: a.id, behavior, remember })
    setBusy(false)
    if (!r.ok) useIsland.getState().showToast(r.error || 'Could not send the decision', 'error')
  }

  useEffect(() => {
    if (!a) return
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'y' || (k === 'enter' && a.risk !== 'high')) {
        e.preventDefault()
        void decide('allow')
      } else if (k === 'n') {
        e.preventDefault()
        void decide('deny')
      } else if (k === 'a' && a.suggestions[0]) {
        e.preventDefault()
        void decide('allow', a.suggestions[0].id)
      } else if (k === 'arrowright' && list.length > 1) setIndex((i) => Math.min(list.length - 1, i + 1))
      else if (k === 'arrowleft' && list.length > 1) setIndex((i) => Math.max(0, i - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!snap || !a)
    return (
      <EmptyState title="Nothing to approve" body="Requests from your agents will appear here.">
        <Button onClick={() => useIsland.getState().open('home', { reset: true })}>Back to sessions</Button>
      </EmptyState>
    )

  const agent = agentOf(snap.agents, a.agent)
  const total = a.expiresAt - a.createdAt
  const left = Math.max(0, a.expiresAt - tick)
  const pct = Math.max(0, Math.min(1, left / total))
  const session = snap.sessions.find((s) => s.key === a.sessionKey)
  void now
  const subject = a.kind === 'edit' || a.kind === 'write' || a.kind === 'read' ? shortPath(a.subject, a.cwd) : a.subject

  return (
    <div className={`approval risk-${a.risk}`} ref={cardRef}>
      <div className="ap-head">
        <span className="session-glyph" style={{ ['--agent' as string]: agent.color }}>
          <AgentGlyph agent={agent.id} color={agent.color} size={12} mark={agent.mark} />
        </span>
        <span className="ap-who">
          {agent.name} · <strong>{a.project}</strong>
        </span>
        {list.length > 1 && (
          <span className="ap-queue">
            <button className="icon-btn tiny" disabled={index === 0} onClick={() => setIndex(index - 1)} title="Previous">
              <Icon name="back" size={12} />
            </button>
            {index + 1} of {list.length}
            <button className="icon-btn tiny" disabled={index >= list.length - 1} onClick={() => setIndex(index + 1)} title="Next">
              <Icon name="forward" size={12} />
            </button>
          </span>
        )}
      </div>

      <div className="ap-title">
        <span>{a.title}</span>
        {a.risk !== 'normal' && (
          <span className={`risk-tag risk-tag-${a.risk}`}>
            <Icon name="alert" size={12} />
            {a.riskReason}
          </span>
        )}
      </div>

      {a.kind === 'command' ? (
        <div className="ap-code selectable mono">{highlight(a.subject, 'shell')}</div>
      ) : (
        <div className="ap-subject mono selectable" title={a.subject}>
          {subject}
        </div>
      )}
      {a.description && a.kind === 'command' && a.description !== a.title && <div className="ap-desc">{a.description}</div>}
      <MiniDiff a={a} />
      {a.kind === 'command' && a.cwd && <div className="ap-cwd mono">in {shortPath(a.cwd)}</div>}

      <div className="ap-actions">
        <Button kind="ghost" icon="jump" onClick={() => session && void window.kumo.jump(session.key)} title={`Answer in ${session?.host.app || 'the agent'} instead`}>
          {session?.host.app || 'Agent'}
        </Button>
        <span className="spacer" />
        <div className="split">
          <Button kind="secondary" kbd={focused ? 'N' : undefined} onClick={() => void decide('deny')} disabled={busy} className="split-main">
            Deny
          </Button>
          <Menu
            align="right"
            up
            trigger={(_o, toggle) => (
              <button className="btn btn-secondary split-more" onClick={toggle} disabled={busy} aria-label="More ways to deny">
                <Icon name="down" size={12} />
              </button>
            )}
            items={[{ label: a.kind === 'command' ? 'Always deny this command' : `Always deny ${a.tool} here`, hint: 'rule', icon: 'shield', onClick: () => void decide('deny', 'rule-deny') }]}
          />
        </div>
        <div className="split">
          <Button kind="primary" kbd={focused ? 'Y' : undefined} onClick={() => void decide('allow')} disabled={busy} className="split-main">
            Allow
          </Button>
          <Menu
            align="right"
            up
            trigger={(_o, toggle) => (
              <button className="btn btn-primary split-more" onClick={toggle} disabled={busy} aria-label="More ways to allow">
                <Icon name="down" size={12} />
              </button>
            )}
            items={[
              ...a.suggestions.map((s, i) => ({ label: s.label, hint: i === 0 && focused ? 'A' : undefined, icon: 'check' as const, onClick: () => void decide('allow', s.id) })),
              ...(a.kind === 'command' ? [{ label: 'Always allow this command', hint: 'session', icon: 'check' as const, onClick: () => void decide('allow', 'exact') }] : []),
              { label: a.kind === 'command' ? 'Allow all commands' : `Allow all ${a.tool}`, hint: 'session', icon: 'clock' as const, onClick: () => void decide('allow', 'session') },
              'sep' as const,
              {
                label: a.kind === 'command' ? `Always allow “${ruleLabel(a.subject)}”` : `Always allow ${a.tool} here`,
                hint: 'rule',
                icon: 'shield' as const,
                onClick: () => void decide('allow', 'rule-allow'),
              },
            ]}
          />
        </div>
      </div>
      <div className="ap-timer" aria-hidden>
        <span style={{ transform: `scaleX(${pct})` }} />
      </div>
      {!focused && <div className="ap-hint">{window.kumo.platform === 'darwin' ? '⌘⌥Y allow · ⌘⌥N deny' : 'Ctrl+Alt+Y allow · Ctrl+Alt+N deny'} · if you don't answer, the agent asks as usual</div>}
    </div>
  )
}
