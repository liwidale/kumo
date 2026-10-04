import { tr } from '../../shared/i18n'
import type { AgentNoteEvent } from '../../../shared/api'
import type { Session } from '../../../shared/types'
import { firstSentence, liveSessions } from '../../shared/format'
import { AgentGlyph, Icon } from '../../shared/icons'
import { Markdown } from '../../shared/Markdown'
import { useIsland } from '../store'
import { agentOf, Button } from '../ui'
import { FocusCard, pickFocus } from './Focus'
import { LimitsRow } from '../Limits'

function PeekNav() {
  const open = useIsland((s) => s.open)
  const snap = useIsland((s) => s.snap)
  const ctx = snap?.context.filter((c) => !c.sessionKey && !c.chat).length ?? 0
  return (
    <div className="peek-nav">
      <button type="button" onClick={() => open('home', { focus: true, reset: true })}>
        <Icon name="sessions" size={13} />{tr('Sessions')}</button>
      <button type="button" onClick={() => open('chat', { focus: true, reset: true })}>
        <Icon name="chat" size={13} />{tr('Chat')}</button>
      <button type="button" onClick={() => open('context', { focus: true, reset: true })}>
        <Icon name="inbox" size={13} />{tr('Context')}{ctx ? <span className="peek-nav-badge">{ctx}</span> : null}
      </button>
    </div>
  )
}

export function Peek({ now }: { now: number }) {
  const snap = useIsland((s) => s.snap)
  const open = useIsland((s) => s.open)
  const live = liveSessions(snap)
  if (!snap) return null
  if (snap.asks.length) {
    const q = snap.asks[0]
    const agent = agentOf(snap.agents, q.agent)
    return (
      <div className="peek">
        <button className="peek-alert" onClick={() => open('approval', { focus: true, reset: true })}>
          <span className="dot dot-md tone-amber pulse" />
          <span className="peek-alert-text">
            <strong>{agent.name}</strong>: {q.question}
          </span>
          <Icon name="forward" size={14} />
        </button>
      </div>
    )
  }
  if (snap.approvals.length) {
    const a = snap.approvals[0]
    const agent = agentOf(snap.agents, a.agent)
    return (
      <div className="peek">
        <button className="peek-alert" onClick={() => open('approval', { focus: true, reset: true })}>
          <span className="dot dot-md tone-amber pulse" />
          <span className="peek-alert-text">
            <strong>{agent.name}</strong> · {a.project}: {a.title}
          </span>
          <Icon name="forward" size={14} />
        </button>
      </div>
    )
  }
  if (!live.length) {
    return (
      <div className="peek">
        <PeekNav />
        <div className="peek-empty" role="button" onClick={() => open('home', { focus: true, reset: true })}>
          <span>{tr('No agents running')}</span>
          <span className="peek-hint">{tr('Click to open')}</span>
        </div>
        <LimitsRow limits={snap.limits} agents={snap.agents} now={now} />
      </div>
    )
  }
  const focus = pickFocus(live, snap.approvals.map((a) => a.sessionKey))!
  const others = live.filter((s) => s.key !== focus.key).map((s) => ({ s, agent: agentOf(snap.agents, s.agent) }))
  const openSession = (key: string): void => open('session', { focus: true, sessionKey: key, reset: true })
  return (
    <div className="peek">
      <PeekNav />
      <FocusCard s={focus} agent={agentOf(snap.agents, focus.agent)} now={now} others={others} onOpen={() => openSession(focus.key)} onOther={openSession} limits={snap.limits} agents={snap.agents} />
    </div>
  )
}

function NoteCard({ note, session }: { note: AgentNoteEvent; session?: Session }) {
  const snap = useIsland((s) => s.snap)
  const set = useIsland((s) => s.set)
  const open = useIsland((s) => s.open)
  const agent = agentOf(snap?.agents ?? [], note.agent)
  return (
    <div className="notify notify-message">
      <div className="notify-head">
        <span className="session-glyph" style={{ ['--agent' as string]: agent.color }}>
          <AgentGlyph agent={agent.id} color={agent.color} size={12} mark={agent.mark} />
        </span>
        <span className="notify-title">
          <strong>{note.project}</strong>
          <span className="notify-kind tone-text-amber">{note.title || note.agentName}</span>
        </span>
        <button className="icon-btn tiny" title={tr('Dismiss')} onClick={() => set({ override: null, notify: null })}>
          <Icon name="close" size={12} />
        </button>
      </div>
      <div className="notify-body">
        <p>{note.text}</p>
      </div>
      {session && (
        <div className="notify-actions">
          <Button kind="ghost" onClick={() => open('session', { focus: true, sessionKey: session.key, reset: true })}>{tr('Details')}</Button>
          {session.alive && (
            <Button kind="secondary" icon="jump" onClick={() => void window.kumo.jump(session.key).then(() => set({ override: null, notify: null }))}>
              {tr('Open {0}', session.host.app)}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export function Notify({ now }: { now: number }) {
  void now
  const snap = useIsland((s) => s.snap)
  const notify = useIsland((s) => s.notify)
  const open = useIsland((s) => s.open)
  const set = useIsland((s) => s.set)
  const s = snap?.sessions.find((x) => x.key === notify?.key)
  if (snap && notify?.kind === 'message' && notify.note) return <NoteCard note={notify.note} session={s} />
  if (!snap || !notify || !s) return <div className="peek peek-empty">{tr('Nothing new')}</div>
  const agent = agentOf(snap.agents, s.agent)
  const kind = notify.kind
  const title = kind === 'done' ? tr('Finished') : kind === 'error' ? tr('Stopped') : kind === 'question' ? tr('Has a question') : tr('Needs you')
  const body = kind === 'done' ? s.summary : kind === 'error' ? s.notice : kind === 'question' ? s.question?.text : s.notice
  return (
    <div className={`notify notify-${kind}`}>
      <div className="notify-head">
        <span className="session-glyph" style={{ ['--agent' as string]: agent.color }}>
          <AgentGlyph agent={agent.id} color={agent.color} size={12} mark={agent.mark} />
        </span>
        <span className="notify-title">
          <strong>{s.project}</strong>
          <span className={`notify-kind tone-text-${kind === 'done' ? 'green' : kind === 'error' ? 'red' : 'amber'}`}>{title}</span>
        </span>
        <button className="icon-btn tiny" title={tr('Dismiss')} onClick={() => set({ override: null, notify: null })}>
          <Icon name="close" size={12} />
        </button>
      </div>
      {body && (
        <div className="notify-body">
          {kind === 'done' ? <Markdown text={body.length > 360 ? `${firstSentence(body)}` : body} /> : <p>{body}</p>}
        </div>
      )}
      {kind === 'question' && s.question?.options.length ? (
        <div className="notify-options">
          {s.question.options.map((o, i) => (
            <button
              key={o}
              type="button"
              className="chip answer"
              title={tr('Copy “{0}” and switch to {1}', o, s.host.app)}
              onClick={() =>
                void window.kumo.copyText(o).then(() => {
                  useIsland.getState().showToast(tr('Copied “{0}” - paste it in {1}', o, s.host.app), 'success')
                  void window.kumo.jump(s.key)
                })
              }
            >
              <span className="answer-n">{i + 1}</span>
              {o}
            </button>
          ))}
        </div>
      ) : null}
      <div className="notify-actions">
        <Button kind="ghost" onClick={() => open('session', { focus: true, sessionKey: s.key, reset: true })}>{tr('Details')}</Button>
        {s.alive && (
        <Button kind={kind === 'done' ? 'secondary' : 'primary'} icon="jump" onClick={() => void window.kumo.jump(s.key).then(() => set({ override: null, notify: null }))}>
          {kind === 'done' || kind === 'error' ? tr('Open {0}', s.host.app) : tr('Answer in {0}', s.host.app)}
        </Button>
        )}
      </div>
    </div>
  )
}
