import { tr } from '../../shared/i18n'
import { useEffect, useState } from 'react'
import type { GitInfo, Session, Step } from '../../../shared/types'
import { activityLine, ago, base, busy, clock, PHASE_LABEL, phaseTone, shortPath } from '../../shared/format'
import { AgentGlyph, Icon, type IconName } from '../../shared/icons'
import { Markdown } from '../../shared/Markdown'
import { useChat, useIsland } from '../store'
import { LiveBlock, Meters } from './Focus'
import { LimitsRow } from '../Limits'
import { agentOf, Button, EmptyState, IconButton, Menu, PhaseMark, Segmented, useAction } from '../ui'

type Tab = 'activity' | 'files' | 'changes'

const STEP_ICON: Record<Step['kind'], IconName> = {
  prompt: 'chat',
  tool: 'bolt',
  error: 'alert',
  subagent: 'layers',
  notice: 'clock',
  approval: 'shield',
  done: 'check',
  context: 'clip',
}

function toolIcon(s: Step): IconName {
  if (s.kind !== 'tool') return STEP_ICON[s.kind]
  switch (s.verb) {
    case 'Run':
      return 'terminal'
    case 'Read':
    case 'List':
      return 'eye'
    case 'Edit':
    case 'Write':
      return 'edit'
    case 'Search':
    case 'Find':
      return 'search'
    case 'Fetch':
    case 'Search web':
      return 'globe'
    case 'Delegate':
      return 'layers'
    default:
      return 'bolt'
  }
}

function Activity({ s, now }: { s: Session; now: number }) {
  const steps = [...s.steps].reverse()
  if (!steps.length) return <div className="muted-note">{tr('Nothing has happened yet in this session.')}</div>
  return (
    <div className="timeline scroll">
      {steps.map((st) => (
        <div key={st.id} className={`step step-${st.kind}${st.ok === false ? ' failed' : ''}`} title={st.detail || st.target}>
          <span className="step-icon">
            <Icon name={toolIcon(st)} size={13} />
          </span>
          <span className="step-text">
            <span className="step-verb">{st.verb}</span>
            {st.target && <span className={`step-target${st.kind === 'tool' ? ' mono' : ''}`}>{st.target}</span>}
          </span>
          <span className="step-time">{ago(st.at, now)}</span>
        </div>
      ))}
    </div>
  )
}

function Files({ s }: { s: Session }) {
  const act = useAction()
  const files = [...s.files].sort((a, b) => (a.action === 'read' ? 1 : 0) - (b.action === 'read' ? 1 : 0) || b.at - a.at)
  if (!files.length) return <div className="muted-note">{tr('No files touched yet.')}</div>
  return (
    <div className="file-list scroll">
      {files.map((f) => (
        <button key={f.path} className="file-row" onClick={() => void act(window.kumo.openInEditor(f.path, s.cwd))} title={f.path}>
          <span className={`file-badge badge-${f.action}`}>{f.action === 'read' ? 'R' : f.action === 'create' ? 'A' : 'M'}</span>
          <span className="file-name">{base(f.path)}</span>
          <span className="file-dir">{shortPath(f.path, s.cwd).replace(/[^\\/]*$/, '')}</span>
          {f.count > 1 && <span className="file-count">×{f.count}</span>}
        </button>
      ))}
    </div>
  )
}

function Changes({ s }: { s: Session }) {
  const [git, setGit] = useState<GitInfo | null>(null)
  const set = useIsland((st) => st.set)
  const go = useIsland((st) => st.go)
  const toast = useIsland((st) => st.showToast)
  const [confirm, setConfirm] = useState<string | null>(null)
  const revert = async (p: string): Promise<void> => {
    if (confirm !== p) {
      setConfirm(p)
      setTimeout(() => setConfirm((c) => (c === p ? null : c)), 4000)
      return
    }
    setConfirm(null)
    const r = await window.kumo.revertFile(s.cwd, p)
    toast(r.ok ? tr('{0} is back to the last commit', base(p)) : r.error || tr('Could not revert'), r.ok ? 'success' : 'error')
    load()
  }
  const load = (): void => {
    void window.kumo.git(s.cwd).then(setGit)
  }
  useEffect(load, [s.cwd, s.toolCount])
  if (!git) return <div className="muted-note shimmer">{tr('Reading git status…')}</div>
  if (!git.ok) return <div className="muted-note">{git.error === 'Not a git repository' ? tr('This project isn’t a git repository, so there are no changes to compare.') : git.error}</div>
  return (
    <div className="changes">
      <div className="changes-head">
        <Icon name="branch" size={13} />
        <span className="mono">{git.branch || 'detached'}</span>
        {git.ahead ? <span className="muted">↑{git.ahead}</span> : null}
        {git.behind ? <span className="muted">↓{git.behind}</span> : null}
        <span className="spacer" />
        <span className="muted">{git.changes.length ? tr('{0} changed', git.changes.length) : tr('Clean')}</span>
        <IconButton icon="refresh" title={tr('Refresh')} onClick={load} size={13} className="tiny" />
      </div>
      {git.changes.length === 0 ? (
        <div className="muted-note">{tr('Working tree is clean.')}</div>
      ) : (
        <div className="file-list scroll">
          {git.changes.map((c) => (
            <div key={c.path} className="file-row-wrap">
            <button
              className="file-row"
              onClick={() => {
                set({ diff: { cwd: s.cwd, path: c.path } })
                go('diff')
              }}
            >
              <span className={`file-badge badge-${c.status === '?' || c.status === 'A' ? 'create' : c.status === 'D' ? 'delete' : 'edit'}`}>{c.status === '?' ? 'U' : c.status}</span>
              <span className="file-name">{base(c.path)}</span>
              <span className="file-dir">{c.path.replace(/[^\\/]*$/, '')}</span>
              <span className="diffstat">
                {c.added ? <span className="add">+{c.added}</span> : null}
                {c.removed ? <span className="del">−{c.removed}</span> : null}
              </span>
            </button>
              <button
                type="button"
                className={`revert-btn${confirm === c.path ? ' confirm' : ''}`}
                title={c.status === '?' || c.status === 'A' ? tr('Delete this new file') : tr('Revert to the last commit')}
                onClick={() => void revert(c.path)}
              >
                {confirm === c.path ? (c.status === '?' || c.status === 'A' ? tr('Delete?') : tr('Revert?')) : <Icon name="refresh" size={12} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const fmtTokens = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export function SessionDetail({ now }: { now: number }) {
  const snap = useIsland((st) => st.snap)
  const key = useIsland((st) => st.sessionKey)
  const back = useIsland((st) => st.back)
  const open = useIsland((st) => st.open)
  const setChat = useChat((st) => st.set)
  const [tab, setTab] = useState<Tab>('activity')
  const [followUp, setFollowUp] = useState('')
  const [confirmKill, setConfirmKill] = useState(false)
  const toast = useIsland((st) => st.showToast)
  const act = useAction()
  const s = snap?.sessions.find((x) => x.key === key)

  if (!snap || !s)
    return (
      <EmptyState title={tr('Session closed')} body={tr('This session is no longer available - its agent may have exited.')}>
        <Button onClick={back}>{tr('Back')}</Button>
      </EmptyState>
    )
  const agent = agentOf(snap.agents, s.agent)
  const bound = snap.context.filter((c) => c.sessionKey === s.key)
  const unbound = snap.context.filter((c) => !c.sessionKey && !c.chat)
  const tone = phaseTone(s.phase)
  const edited = s.files.filter((f) => f.action !== 'read').length

  return (
    <div className="detail">
      <div className="detail-head">
        <IconButton icon="back" title={tr('Back (Esc)')} onClick={back} />
        <span className="session-glyph lg" style={{ ['--agent' as string]: agent.color }}>
          <AgentGlyph agent={agent.id} color={agent.color} size={15} mark={agent.mark} />
        </span>
        <div className="detail-title">
          <div className="detail-project">{s.project}</div>
          <div className="detail-sub">
            {agent.name} · {s.host.app}
            {s.model ? ` · ${s.model.replace(/^claude-/, '')}` : ''}
          </div>
        </div>
        {s.alive && (busy(s) || s.phase === 'waiting' || s.phase === 'question' || s.stopping) && (
          <Button kind="secondary" icon="stop" disabled={s.stopping} onClick={() => void act(window.kumo.stopSession(s.key), tr('Asked the agent to stop'))} title={tr('Stop the agent at its next step')}>
            {s.stopping ? tr('Stopping…') : tr('Stop')}
          </Button>
        )}
        <Button kind="secondary" icon="jump" onClick={() => void act(window.kumo.jump(s.key))} disabled={!s.alive}>{tr('Open')}</Button>
        <Menu
          align="right"
          trigger={(_o, toggle) => <IconButton icon="more" title={tr('More')} onClick={toggle} />}
          items={[
            { label: tr('Open project folder'), icon: 'folder', onClick: () => void act(window.kumo.openFolder(s.cwd)) },
            { label: tr('Open in editor'), icon: 'edit', onClick: () => void act(window.kumo.openInEditor(s.cwd)) },
            { label: tr('Copy path'), icon: 'copy', onClick: () => void window.kumo.copyText(s.cwd) },
            'sep',
            ...(s.alive ? [{ label: tr('End agent process…'), icon: 'stop' as const, onClick: () => setConfirmKill(true) }] : []),
            { label: s.alive ? tr('Stop tracking') : tr('Dismiss'), icon: 'close', onClick: () => void window.kumo.dismiss(s.key).then(back) },
          ]}
        />
      </div>

      {confirmKill && (
        <div className="banner banner-red confirm-banner">
          <Icon name="alert" size={14} />
          <span>{tr('End the {0} process now? Unsaved work in that session may be lost.', agent.name)}{s.host.kind === 'desktop' ? ` ${tr('This may close the session in {0}.', s.host.app)}` : ''}</span>
          <Button kind="ghost" onClick={() => setConfirmKill(false)}>{tr('Cancel')}</Button>
          <Button
            kind="danger"
            onClick={() => {
              setConfirmKill(false)
              void act(window.kumo.stopSession(s.key, true), tr('Agent process ended'))
            }}
          >{tr('End')}</Button>
        </div>
      )}

      <div className={`status-card tone-border-${tone}`}>
        <div className="status-line">
          <PhaseMark phase={s.phase} />
          <span className={`status-phase tone-text-${tone}`}>{PHASE_LABEL[s.phase]}</span>
          <span className={`status-activity${busy(s) ? ' shimmer' : ''}`}>{activityLine(s)}</span>
          <span className="status-time mono">{busy(s) ? clock(now - s.phaseSince) : ago(s.updatedAt, now)}</span>
        </div>
        {s.task && <div className="status-task selectable">{s.task}</div>}
        {s.phase === 'question' && s.question && (
          <div className="question">
            <div className="question-text">{s.question.text}</div>
            {s.question.options.length > 0 && (
              <div className="notify-options">
                {s.question.options.map((o, i) => (
                  <button
                    key={o}
                    type="button"
                    className="chip answer"
                    title={tr('Copy “{0}” and switch to {1}', o, s.host.app)}
                    onClick={() =>
                      void window.kumo.copyText(o).then(() => {
                        toast(tr('Copied “{0}” - paste it in {1}', o, s.host.app), 'success')
                        void window.kumo.jump(s.key)
                      })
                    }
                  >
                    <span className="answer-n">{i + 1}</span>
                    {o}
                  </button>
                ))}
              </div>
            )}
            <div className="muted small">{tr('Kumo can’t answer for you - pick an option to copy it and jump to {0}.', s.host.app)}</div>
            <Button kind="primary" icon="jump" onClick={() => void act(window.kumo.jump(s.key))}>{tr('Answer in {0}', s.host.app)}
            </Button>
          </div>
        )}
        {s.phase === 'done' && s.summary && (
          <div className="summary">
            <Markdown text={s.summary} />
          </div>
        )}
        {busy(s) && <LiveBlock s={s} lines={8} />}
        <Meters s={s} />
        {s.plan && s.plan.length > 0 && (
          <div className="plan-list">
            {s.plan.map((p, i) => (
              <div key={i} className={`plan-item plan-${p.status}`}>
                <span className="plan-box">{p.status === 'done' ? <Icon name="check" size={10} strokeWidth={2} /> : null}</span>
                <span className="plan-text">{p.text}</span>
              </div>
            ))}
          </div>
        )}
        <div className="status-stats">
          <span>
            {tr('{0} step|{0} steps', s.toolCount)}
          </span>
          <span>
            {tr('{0} file changed|{0} files changed', edited)}</span>
          {s.errorCount > 0 && <span className="tone-text-red">{tr('{0} failed', s.errorCount)}</span>}
          <span>{tr('started {0} ago', ago(s.startedAt, now))}</span>
          {s.usage && (s.usage.costUsd != null || s.usage.inTokens != null) && (
            <span className="usage" title={tr('Reported by the agent')}>
              {s.usage.costUsd != null && <strong>${s.usage.costUsd < 0.01 ? s.usage.costUsd.toFixed(3) : s.usage.costUsd.toFixed(2)}</strong>}
              {s.usage.inTokens != null && ` ${tr('{0} in', fmtTokens(s.usage.inTokens))}`}
              {s.usage.outTokens != null && ` · ${tr('{0} out', fmtTokens(s.usage.outTokens))}`}
            </span>
          )}
        </div>
        {snap.limits.some((l) => l.agent === s.agent) && (
          <div className="session-limits">
            <LimitsRow limits={snap.limits.filter((l) => l.agent === s.agent)} agents={snap.agents} now={now} />
          </div>
        )}
      </div>

      {s.alive && agent.capabilities.contextInjection && (
        <div className="followup">
          {s.queued.length > 0 && (
            <div className="queued">
              {s.queued.map((q, i) => (
                <div key={i} className="queued-item">
                  <Icon name="clock" size={12} />
                  <span className="queued-text">{q}</span>
                  <button type="button" className="icon-btn tiny" title={tr('Remove')} onClick={() => void window.kumo.unqueueMessage(s.key, i)}>
                    <Icon name="close" size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form
            className="followup-row"
            onSubmit={(e) => {
              e.preventDefault()
              const t = followUp.trim()
              if (!t) return
              void window.kumo.queueMessage(s.key, t).then((r) => {
                if (r.ok) setFollowUp('')
                toast(r.ok ? (busy(s) ? tr('Queued - the agent gets it as soon as it finishes this turn') : tr('Queued - the agent gets it when its next turn ends')) : r.error || tr('Could not queue'), r.ok ? 'success' : 'error')
              })
            }}
          >
            <input className="text-input" placeholder={busy(s) ? tr('Tell the agent what to do next…') : tr('Message for the agent’s next turn…')} value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
            <button type="submit" className="send-btn" disabled={!followUp.trim()} title={tr('Queue for the agent')}>
              <Icon name="send" size={14} strokeWidth={1.8} />
            </button>
          </form>
          <div className="muted small">{busy(s) ? tr('Sent the moment the agent finishes this turn - it keeps going with your message.') : tr('The agent is waiting in its own window; this is added when its next turn ends or starts.')}</div>
        </div>
      )}

      <div className="detail-tabs">
        <Segmented<Tab>
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'activity', label: tr('Activity') },
            { value: 'files', label: tr('Files'), badge: s.files.length || undefined },
            { value: 'changes', label: tr('Changes') },
          ]}
        />
      </div>
      <div className="detail-pane">
        {tab === 'activity' ? <Activity s={s} now={now} /> : tab === 'files' ? <Files s={s} /> : <Changes s={s} />}
      </div>

      {(bound.length > 0 || s.pendingContext > 0) && (
        <div className="bound">
          <Icon name="clip" size={13} />
          <span>
            {bound.filter((b) => !b.delivered).length
              ? tr('{0} item will be shared on the next turn|{0} items will be shared on the next turn', bound.filter((b) => !b.delivered).length)
              : tr('{0} item shared with this session|{0} items shared with this session', bound.length)}
          </span>
        </div>
      )}

      <div className="detail-actions">
        <Button
          icon="chat"
          onClick={() => {
            setChat({ sessionKey: s.key, current: null, draft: '' })
            open('chat')
          }}
        >{tr('Ask about this')}</Button>
        {agent.capabilities.contextInjection && s.alive && (
          <Button
            icon="clip"
            disabled={!unbound.length}
            title={unbound.length ? tr('Share the items in your context tray with this session') : tr('Drop files on Kumo first')}
            onClick={() => void act(window.kumo.bindContext(unbound.map((u) => u.id), s.key), tr('Shared with {0} on its next turn', s.project))}
          >
            {unbound.length ? tr('Share {0} item|Share {0} items', unbound.length) : tr('Share context')}
          </Button>
        )}
      </div>
    </div>
  )
}
