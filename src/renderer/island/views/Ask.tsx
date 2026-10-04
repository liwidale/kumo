import { useEffect, useRef, useState } from 'react'
import type { AskRequest } from '../../../shared/types'
import { AgentGlyph, Icon } from '../../shared/icons'
import { play } from '../../shared/sound'
import { useIsland } from '../store'
import { agentOf, Button } from '../ui'
import { tr } from '../../shared/i18n'

export function AskCard({ ask, index, total, onIndex }: { ask: AskRequest; index: number; total: number; onIndex: (i: number) => void }) {
  const snap = useIsland((s) => s.snap)
  const focused = useIsland((s) => s.focused)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(Date.now())
  const input = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    setText('')
  }, [ask.id])

  const answer = async (value: string | null): Promise<void> => {
    if (busy) return
    setBusy(true)
    play(value === null ? 'close' : 'send')
    const r = await window.kumo.answerAsk(ask.id, value)
    setBusy(false)
    if (!r.ok) useIsland.getState().showToast(r.error || tr('Could not send the answer'), 'error')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest('input, textarea')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= ask.options.length) {
        e.preventDefault()
        void answer(ask.options[n - 1])
      } else if (e.key === 'ArrowRight' && total > 1) onIndex(Math.min(total - 1, index + 1))
      else if (e.key === 'ArrowLeft' && total > 1) onIndex(Math.max(0, index - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!snap) return null
  const agent = agentOf(snap.agents, ask.agent)
  const pct = Math.max(0, Math.min(1, (ask.expiresAt - tick) / (ask.expiresAt - ask.createdAt)))
  const session = ask.sessionKey ? snap.sessions.find((s) => s.key === ask.sessionKey) : undefined

  return (
    <div className="approval ask">
      <div className="ap-head">
        <span className="session-glyph" style={{ ['--agent' as string]: agent.color }}>
          <AgentGlyph agent={agent.id} color={agent.color} size={12} mark={agent.mark} />
        </span>
        <span className="ap-who">
          {agent.name} · <strong>{ask.project}</strong>
        </span>
        {total > 1 && (
          <span className="ap-queue">
            <button className="icon-btn tiny" disabled={index === 0} onClick={() => onIndex(index - 1)} title={tr('Previous')}>
              <Icon name="back" size={12} />
            </button>
            {tr('{0} of {1}', index + 1, total)}
            <button className="icon-btn tiny" disabled={index >= total - 1} onClick={() => onIndex(index + 1)} title={tr('Next')}>
              <Icon name="forward" size={12} />
            </button>
          </span>
        )}
      </div>

      <div className="ap-title ask-question selectable">
        <span>{ask.question}</span>
      </div>

      {ask.options.length > 0 && (
        <div className="notify-options ask-options">
          {ask.options.map((o, i) => (
            <button key={o} type="button" className="chip answer" disabled={busy} onClick={() => void answer(o)}>
              <span className="answer-n">{i + 1}</span>
              {o}
            </button>
          ))}
        </div>
      )}

      {ask.allowText && (
        <textarea
          ref={input}
          className="text-area ask-input"
          rows={2}
          placeholder={ask.options.length ? tr('Or type your own answer…') : tr('Type your answer…')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && text.trim()) {
              e.preventDefault()
              void answer(text.trim())
            }
          }}
        />
      )}

      <div className="ap-actions">
        {session ? (
          <Button kind="ghost" icon="jump" onClick={() => void window.kumo.jump(session.key)} title={tr('Open {0}', session.host.app)}>
            {session.host.app}
          </Button>
        ) : null}
        <span className="spacer" />
        <Button kind="secondary" onClick={() => void answer(null)} disabled={busy}>{tr('Skip')}</Button>
        {ask.allowText && (
          <Button kind="primary" kbd={focused && text.trim() ? '↵' : undefined} onClick={() => void answer(text.trim())} disabled={busy || !text.trim()}>{tr('Send')}</Button>
        )}
      </div>
      <div className="ap-timer" aria-hidden>
        <span style={{ transform: `scaleX(${pct})` }} />
      </div>
    </div>
  )
}
