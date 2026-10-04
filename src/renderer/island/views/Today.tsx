import { tr } from '../../shared/i18n'
import { useEffect, useState } from 'react'
import type { DayStats } from '../../../shared/types'
import { firstSentence } from '../../shared/format'
import { AgentGlyph, Icon } from '../../shared/icons'
import { useIsland } from '../store'
import { agentOf, EmptyState, IconButton, SectionLabel } from '../ui'

function dayLabel(date: string): string {
  const today = new Date()
  const k = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (date === k(today)) return tr('Today')
  const y = new Date(today)
  y.setDate(y.getDate() - 1)
  if (date === k(y)) return tr('Yesterday')
  const [yy, mm, dd] = date.split('-').map(Number)
  return new Date(yy, mm - 1, dd).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

const time = (t: number): string => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

export function Today() {
  const snap = useIsland((s) => s.snap)
  const back = useIsland((s) => s.back)
  const [days, setDays] = useState<DayStats[] | null>(null)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    void window.kumo.days().then(setDays)
  }, [snap?.sessions.length])

  if (!days) return <div className="muted-note shimmer">{tr('Gathering the day…')}</div>
  const day = days[index]

  return (
    <div className="today">
      <div className="detail-head">
        <IconButton icon="back" title={tr('Back (Esc)')} onClick={back} />
        <div className="detail-title">
          <div className="detail-project">{day ? dayLabel(day.date) : tr('Today')}</div>
          <div className="detail-sub">{tr('What your agents got done · stays on this computer')}</div>
        </div>
        <IconButton icon="back" title={tr('Earlier day')} onClick={() => setIndex((i) => Math.min(days.length - 1, i + 1))} className={index >= days.length - 1 ? 'dim' : ''} />
        <IconButton icon="forward" title={tr('Later day')} onClick={() => setIndex((i) => Math.max(0, i - 1))} className={index === 0 ? 'dim' : ''} />
      </div>

      {!day || (day.sessions === 0 && day.tasks.length === 0) ? (
        <EmptyState title={tr('Nothing yet')} body={tr('As your agents work, Kumo keeps a quiet tally here: sessions, files changed, finished tasks and approvals.')} />
      ) : (
        <>
          <div className="day-stats">
            <div className="day-stat">
              <span className="day-num">{day.sessions}</span>
              <span className="day-label">{tr('session|sessions', day.sessions)}</span>
            </div>
            <div className="day-stat">
              <span className="day-num">{day.tasks.length}</span>
              <span className="day-label">{tr('task done|tasks done', day.tasks.length)}</span>
            </div>
            <div className="day-stat">
              <span className="day-num">{day.files}</span>
              <span className="day-label">{tr('file changed|files changed', day.files)}</span>
            </div>
            <div className="day-stat">
              <span className="day-num">
                {day.allowed}
                <span className="day-sep">/</span>
                {day.denied}
              </span>
              <span className="day-label">{tr('allowed / denied')}</span>
            </div>
            {day.costUsd > 0 && (
              <div className="day-stat">
                <span className="day-num">${day.costUsd.toFixed(2)}</span>
                <span className="day-label">{tr('reported spend')}</span>
              </div>
            )}
          </div>

          {Object.keys(day.projects).length > 0 && (
            <div className="day-projects">
              {Object.entries(day.projects)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([name, n]) => (
                  <span key={name} className="chip static">
                    <Icon name="folder" size={12} />
                    <span className="chip-name">{name}</span>
                    <span className="muted">{n}</span>
                  </span>
                ))}
            </div>
          )}

          {day.tasks.length > 0 && (
            <>
              <SectionLabel>{tr('Finished')}</SectionLabel>
              <div className="day-tasks">
                {[...day.tasks].reverse().map((t, i) => {
                  const a = agentOf(snap?.agents ?? [], t.agent)
                  return (
                    <div key={i} className="day-task">
                      <span className="day-time mono">{time(t.at)}</span>
                      <span className="session-glyph">
                        <AgentGlyph agent={a.id} color={a.color} size={12} mark={a.mark} />
                      </span>
                      <span className="day-task-main">
                        <span className="day-task-title">
                          <strong>{t.project}</strong> {t.task}
                        </span>
                        {t.summary && <span className="day-task-summary">{firstSentence(t.summary)}</span>}
                      </span>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
