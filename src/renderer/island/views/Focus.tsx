import type { AgentDescriptor, AgentLimits, LivePreview, Session } from '../../../shared/types'
import { focusDiff, lineDiff, type DiffLine } from '../../shared/diff'
import { activityLine, ago, base, busy, clock, PHASE_LABEL, phaseTone, shortPath } from '../../shared/format'
import { AgentGlyph, Icon } from '../../shared/icons'
import { Markdown } from '../../shared/Markdown'
import { highlight, highlightLines, langFromPath } from '../../shared/syntax'
import { LimitsRow } from '../Limits'
import { PhaseMark } from '../ui'


const EXT_LABEL: Record<string, string> = { tsx: 'TSX', ts: 'TS', jsx: 'JSX', js: 'JS', mjs: 'JS', py: 'PY', rs: 'RS', go: 'GO', css: 'CSS', html: 'HTML', json: 'JSON', md: 'MD', swift: 'SW', kt: 'KT', java: 'JAVA', rb: 'RB', php: 'PHP', sh: 'SH', ps1: 'PS', yml: 'YML', yaml: 'YML', toml: 'TOML', sql: 'SQL', vue: 'VUE', svelte: 'SV', c: 'C', cpp: 'C++', h: 'H', cs: 'C#' }

function extOf(p?: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(p || '')
  return m ? EXT_LABEL[m[1].toLowerCase()] || m[1].toUpperCase().slice(0, 4) : 'FILE'
}

function previewLines(p: LivePreview, max: number): DiffLine[] {
  if (p.kind === 'edit' && p.diff?.length) {
    const all = p.diff.flatMap((h, i) => (i ? [{ t: ' ' as const, l: '…' }, ...lineDiff(h.before, h.after)] : lineDiff(h.before, h.after)))
    return focusDiff(all, max)
  }
  if (p.kind === 'write' && p.content != null) {
    const lines = p.content.split('\n')
    return lines.slice(Math.max(0, lines.length - max)).map((l) => ({ t: '+' as const, l }))
  }
  return []
}

export function LiveBlock({ s, lines = 6 }: { s: Session; lines?: number }) {
  const p = s.preview
  const live = busy(s)
  if (!p) {
    if (s.phase === 'thinking')
      return (
        <div className="live-block live-quiet">
          <span className="shimmer">Thinking about the next step…</span>
        </div>
      )
    return null
  }
  if (p.kind === 'command')
    return (
      <div className="live-block live-term">
        <div className="live-head">
          <span className="live-ext term">
            <Icon name="terminal" size={11} />
          </span>
          <span className="live-file">Terminal</span>
          <span className="live-path mono">{shortPath(s.cwd)}</span>
        </div>
        <pre className="live-code mono">
          <span className="prompt">$ </span>
          {highlight(p.command || '', 'shell')}
          {live && <span className="type-caret" />}
        </pre>
      </div>
    )
  if (p.kind === 'edit' || p.kind === 'write') {
    const rows = previewLines(p, lines)
    const painted = highlightLines(
      rows.map((d) => d.l),
      langFromPath(p.path),
    )
    return (
      <div className="live-block">
        <div className="live-head">
          <span className="live-ext">{extOf(p.path)}</span>
          <span className="live-file">{base(p.path || '')}</span>
          {live && <span className="live-dot" title="Being edited" />}
          <span className="live-path mono">{p.path ? shortPath(p.path, s.cwd) : ''}</span>
          <span className="diffstat">
            {p.added ? <span className="add">+{p.added}</span> : null}
            {p.removed ? <span className="del">−{p.removed}</span> : null}
          </span>
        </div>
        <pre className="live-code diff mono">
          {rows.map((d, i) => (
            <div key={i} className={`dl ${d.t === '+' ? 'add' : d.t === '-' ? 'del' : 'ctx'}`}>
              <span className="dl-sign">{d.t === ' ' ? ' ' : d.t === '-' ? '−' : '+'}</span>
              {d.l ? painted[i] : ' '}
              {live && i === rows.length - 1 && d.t === '+' && <span className="type-caret" />}
            </div>
          ))}
        </pre>
      </div>
    )
  }
  const verb = p.kind === 'read' ? 'Reading' : p.kind === 'search' ? 'Searching' : p.kind === 'fetch' ? 'Fetching' : s.current?.verb || 'Working on'
  return (
    <div className="live-block live-quiet">
      <Icon name={p.kind === 'read' ? 'eye' : p.kind === 'search' ? 'search' : p.kind === 'fetch' ? 'globe' : 'bolt'} size={13} />
      <span className={live ? 'shimmer' : ''}>
        {verb} <span className="mono">{p.kind === 'read' ? shortPath(p.path || '', s.cwd) : p.path}</span>
      </span>
    </div>
  )
}

export function Meters({ s }: { s: Session }) {
  const plan = s.plan
  const done = plan ? plan.filter((p) => p.status === 'done').length : 0
  const active = plan?.find((p) => p.status === 'active')
  const ctx = s.context ? Math.round((s.context.used / s.context.window) * 100) : null
  if (!plan?.length && ctx == null) return null
  return (
    <div className="meters">
      {plan?.length ? (
        <div className="meter-col">
          <div className="meter-label">
            <span>
              Plan {done}/{plan.length}
            </span>
            {active && <span className="meter-sub">· {active.text}</span>}
          </div>
          <div className="bar">
            <span className="bar-fill tone-bar-accent" style={{ width: `${(done / plan.length) * 100}%` }} />
            {active && <span className="bar-active" style={{ left: `${(done / plan.length) * 100}%`, width: `${100 / plan.length}%` }} />}
          </div>
        </div>
      ) : null}
      {ctx != null && (
        <div className="meter-col">
          <div className="meter-label">
            <span>Context {ctx}%</span>
            <span className="meter-sub">
              · {Math.round(s.context!.used / 1000)}k of {s.context!.window >= 1_000_000 ? '1M' : `${Math.round(s.context!.window / 1000)}k`}
            </span>
          </div>
          <div className="bar">
            <span className={`bar-fill ${ctx > 85 ? 'tone-bar-red' : ctx > 65 ? 'tone-bar-amber' : 'tone-bar-green'}`} style={{ width: `${ctx}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

function Trail({ s, now }: { s: Session; now: number }) {
  const subs = s.subagents.filter((x) => x.status === 'running')
  const steps = [...s.steps]
    .reverse()
    .filter((x) => x.kind === 'tool' || x.kind === 'error' || x.kind === 'approval')
    .filter((x) => !(subs.length && x.verb === 'Delegate'))
    .slice(1, subs.length ? 3 : 4)
  if (!subs.length && !steps.length) return null
  return (
    <div className="trail">
      {subs.map((a) => (
        <div key={a.id} className="trail-row">
          <span className="trail-dot running" />
          <span className="trail-verb">{a.type}</span>
          <span className="trail-target shimmer">{a.description || 'working'}</span>
        </div>
      ))}
      {steps.map((st) => (
        <div key={st.id} className={`trail-row${st.ok === false ? ' failed' : ''}`}>
          <span className={`trail-dot${st.ok === false ? ' bad' : ''}`} />
          <span className="trail-verb">{st.verb}</span>
          <span className="trail-target">{st.target}</span>
          <span className="trail-time">{ago(st.at, now)}</span>
        </div>
      ))}
    </div>
  )
}

export function FocusCard({
  s,
  agent,
  now,
  others,
  onOpen,
  onOther,
  limits = [],
  agents = [],
}: {
  s: Session
  agent: AgentDescriptor
  now: number
  others: { s: Session; agent: AgentDescriptor }[]
  onOpen: () => void
  onOther: (key: string) => void
  limits?: AgentLimits[]
  agents?: AgentDescriptor[]
}) {
  const tone = phaseTone(s.phase)
  return (
    <div className="focus">
      <button className="focus-head" onClick={onOpen}>
        <span className="session-glyph" style={{ ['--agent' as string]: agent.color }}>
          <AgentGlyph agent={agent.id} color={agent.color} size={12} mark={agent.mark} />
        </span>
        <span className="focus-title">
          <span className="focus-project">{s.project}</span>
          <span className="focus-agent">{agent.name}</span>
        </span>
        <span className={`phase-pill tone-${tone}`}>
          <PhaseMark phase={s.phase} size="sm" />
          {PHASE_LABEL[s.phase]}
        </span>
        <span className="focus-time mono">{busy(s) ? clock(now - s.phaseSince) : ago(s.updatedAt, now)}</span>
      </button>

      {s.task && (s.phase === 'thinking' || !s.preview) && s.phase !== 'done' && <div className="focus-task">{s.task}</div>}
      {s.phase === 'done' && s.summary ? (
        <div className="focus-summary">
          <Markdown text={s.summary.length > 280 ? `${s.summary.slice(0, 279)}…` : s.summary} />
        </div>
      ) : s.phase === 'waiting' || s.phase === 'question' || s.phase === 'error' ? (
        <div className={`focus-notice tone-text-${tone}`}>{activityLine(s)}</div>
      ) : (
        <LiveBlock s={s} />
      )}

      <Meters s={s} />
      <Trail s={s} now={now} />

      {others.length > 0 && (
        <div className="focus-others">
          {others.slice(0, 4).map(({ s: o, agent: a }) => (
            <button key={o.key} className="other-chip" onClick={() => onOther(o.key)} title={activityLine(o)}>
              <AgentGlyph agent={a.id} color={a.color} size={11} mark={a.mark} />
              <span className="other-name">{o.project}</span>
              <PhaseMark phase={o.phase} size="sm" />
            </button>
          ))}
          {others.length > 4 && <span className="other-more">+{others.length - 4}</span>}
        </div>
      )}
      <LimitsRow limits={limits} agents={agents} now={now} />
    </div>
  )
}

export function pickFocus(list: Session[], approvalKeys: string[]): Session | undefined {
  const rank = (s: Session): number =>
    approvalKeys.includes(s.key) ? 0 : s.phase === 'waiting' || s.phase === 'question' ? 1 : s.phase === 'working' ? 2 : s.phase === 'thinking' ? 3 : s.phase === 'error' ? 4 : s.phase === 'done' ? 5 : 6
  return [...list].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)[0]
}
