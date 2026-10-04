import { tr } from '../shared/i18n'
import type { AgentDescriptor, AgentLimits } from '../../shared/types'
import { agentOf } from './ui'

function resetsIn(at: number | undefined, now: number): string {
  if (!at) return ''
  const m = Math.max(0, Math.round((at - now) / 60_000))
  if (m < 60) return tr('resets in {0}m', m)
  const h = Math.floor(m / 60)
  if (h < 48) return tr('resets in {0}h {1}m', h, m % 60)
  return tr('resets in {0}d', Math.round(h / 24))
}

export function LimitsRow({ limits, agents, now }: { limits: AgentLimits[]; agents: AgentDescriptor[]; now: number }) {
  if (!limits.length) return null
  return (
    <div className="limits">
      {limits.map((l) => {
        const a = agentOf(agents, l.agent)
        return (
          <div key={l.agent} className="limit-group">
            <span className="limit-agent">
              <span className="limit-dot" style={{ background: a.color }} />
              {a.name.replace(/ Code$/, '')}
            </span>
            {l.windows
              .filter((w) => w.kind !== 'spend' || l.windows.length === 1)
              .map((w) => {
                const pct = Math.round(w.usedPct)
                const tone = pct >= 85 ? 'red' : pct >= 65 ? 'amber' : 'ok'
                return (
                  <span key={w.kind} className={`limit limit-${tone}`} title={`${tr('{0}: {1}% used', w.label, pct)}${w.resetsAt ? ` · ${resetsIn(w.resetsAt, now)}` : ''}`}>
                    <span className="limit-label">{w.label}</span>
                    <span className="limit-bar">
                      <span style={{ width: `${Math.min(100, pct)}%` }} />
                    </span>
                    <span className="limit-pct">{pct}%</span>
                  </span>
                )
              })}
          </div>
        )
      })}
    </div>
  )
}
