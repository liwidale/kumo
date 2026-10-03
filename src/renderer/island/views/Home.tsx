import { useEffect, useState } from 'react'
import type { DayStats, Mood, Session } from '../../../shared/types'
import { Icon } from '../../shared/icons'
import { useIsland } from '../store'
import { LimitsRow } from '../Limits'
import { agentOf, Button, EmptyState, SectionLabel, SessionRow } from '../ui'

const ORDER: Record<Session['phase'], number> = { waiting: 0, question: 0, error: 1, working: 2, thinking: 2, done: 3, idle: 4, ended: 5 }

function TodayRow() {
  const go = useIsland((s) => s.go)
  const snap = useIsland((s) => s.snap)
  const [day, setDay] = useState<DayStats | null>(null)
  useEffect(() => {
    void window.kumo.days().then((d) => setDay(d[0] && d[0].date === new Date().toLocaleDateString('sv-SE') ? d[0] : null))
  }, [snap?.sessions.length, snap?.approvals.length])
  if (!day || (day.sessions === 0 && day.tasks.length === 0)) return null
  return (
    <button type="button" className="today-row" onClick={() => go('today')}>
      <Icon name="history" size={13} />
      <span className="today-title">Today</span>
      <span className="today-facts">
        {day.sessions} session{day.sessions === 1 ? '' : 's'} · {day.tasks.length} done · {day.files} file{day.files === 1 ? '' : 's'}
        {day.costUsd > 0 ? ` · $${day.costUsd.toFixed(2)}` : ''}
      </span>
      <Icon name="forward" size={12} />
    </button>
  )
}

export function Home({ now, mood }: { now: number; mood: Mood }) {
  void mood
  const snap = useIsland((s) => s.snap)
  const open = useIsland((s) => s.open)
  const go = useIsland((s) => s.go)
  if (!snap) return null
  const live = snap.sessions.filter((s) => s.phase !== 'ended').sort((a, b) => ORDER[a.phase] - ORDER[b.phase] || b.updatedAt - a.updatedAt)
  const ended = snap.sessions.filter((s) => s.phase === 'ended')
  const connected = snap.integrations.filter((i) => i.state === 'connected')
  const needsSetup = snap.integrations.filter((i) => i.state === 'disconnected' || i.state === 'outdated' || i.state === 'error').slice(0, 3)

  return (
    <div className="home">
      {!snap.serverOk && (
        <div className="banner banner-red">
          <Icon name="alert" size={14} />
          <span>Kumo can't receive events from your agents{snap.serverError ? ` (${snap.serverError})` : ''}. Restart Kumo to try again.</span>
        </div>
      )}
      {snap.approvals.length > 0 && (
        <button className="banner banner-amber clickable" onClick={() => go('approval')}>
          <span className="dot dot-md tone-amber pulse" />
          <span>
            {snap.approvals.length} request{snap.approvals.length > 1 ? 's' : ''} waiting for your OK
          </span>
          <Icon name="forward" size={14} />
        </button>
      )}

      {live.length === 0 ? (
        <EmptyState title="All quiet" body={connected.length ? 'No coding agents are running right now. Start one, or ask Kumo something.' : 'Connect an agent and its sessions will show up here as they happen.'}>
          <Button kind="primary" icon="plus" onClick={() => open('launch')}>
            New session
          </Button>
          <Button icon="chat" onClick={() => open('chat')}>
            Ask Kumo
          </Button>
        </EmptyState>
      ) : (
        <div className="session-list scroll" style={{ maxHeight: 'calc(var(--max-body) - 120px)' }}>
          {live.map((s) => (
            <SessionRow key={s.key} s={s} agent={agentOf(snap.agents, s.agent)} now={now} onClick={() => go('session', s.key)} />
          ))}
        </div>
      )}

      {needsSetup.length > 0 && (
        <div className="setup-hints">
          {needsSetup.map((i) => (
            <button key={i.id} className="setup-hint" onClick={() => window.kumo.openSettings('agents')}>
              <span className={`dot dot-sm ${i.state === 'error' ? 'tone-red' : 'tone-muted'}`} />
              <span className="setup-name">{i.name}</span>
              <span className="setup-detail">{i.state === 'outdated' ? 'Reconnect needed' : i.state === 'error' ? 'Needs attention' : 'Not connected'}</span>
              <span className="setup-cta">
                {i.state === 'error' ? 'Fix' : 'Connect'}
                <Icon name="forward" size={12} />
              </span>
            </button>
          ))}
        </div>
      )}

      <TodayRow />

      {snap.limits.length > 0 && (
        <div className="home-limits">
          <LimitsRow limits={snap.limits} agents={snap.agents} now={now} />
        </div>
      )}

      {ended.length > 0 && (
        <div className="ended">
          <SectionLabel>Recently ended</SectionLabel>
          {ended.slice(0, 3).map((s) => (
            <div key={s.key} className="ended-row">
              <span className="ended-name">{s.project}</span>
              <span className="ended-note">{s.notice || 'Ended'}</span>
              <button className="icon-btn tiny" title="Dismiss" onClick={() => void window.kumo.dismiss(s.key)}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
