import { tr } from '../shared/i18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LaunchTarget } from '../../shared/types'
import { base } from '../shared/format'
import { useSettings, useSnapshot, useTheme } from '../shared/hooks'
import { AgentGlyph, Icon } from '../shared/icons'
import { availability, DIRECT, TARGETS } from '../shared/targets'

const LAST = 'kumo.launcher.target'

const remembered = (): LaunchTarget | null => {
  try {
    return (localStorage.getItem(LAST) as LaunchTarget | null) || null
  } catch {
    return null
  }
}

const remember = (t: LaunchTarget): void => {
  try {
    localStorage.setItem(LAST, t)
  } catch {
  }
}

export function LauncherApp() {
  useTheme()
  const s = useSettings()
  const snap = useSnapshot()
  const [prompt, setPrompt] = useState('')
  const [cwd, setCwd] = useState('')
  const [target, setTarget] = useState<LaunchTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const card = useRef<HTMLDivElement>(null)

  const available = availability(snap?.installed)
  const targets = TARGETS.filter((t) => available[t.id])
  const recents = (s?.recentProjects || []).slice(0, 6)
  const current = target && available[target] ? target : targets.find((t) => t.id === remembered())?.id || targets[0]?.id || null
  const project = cwd || recents[0] || ''

  useEffect(
    () =>
      window.kumo.onLauncher((e) => {
        if (e === 'show') {
          setError('')
          setBusy(false)
          setCwd('')
          void window.kumo.refreshAgents()
          requestAnimationFrame(() => {
            input.current?.focus()
            input.current?.select()
          })
        }
      }),
    [],
  )

  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    const measure = (): void => window.kumo.setLauncherHeight(el.offsetHeight + 40)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pick = async (): Promise<void> => {
    const p = await window.kumo.pickFolder()
    if (p) setCwd(p)
    input.current?.focus()
  }

  const start = async (): Promise<void> => {
    if (busy || !current) return
    if (!project) {
      await pick()
      return
    }
    setBusy(true)
    setError('')
    remember(current)
    const r = await window.kumo.launch({ target: current, cwd: project, prompt: prompt.trim(), contextIds: [] })
    setBusy(false)
    if (r.ok) {
      setPrompt('')
      window.kumo.hideLauncher()
    } else setError(r.error || tr('Could not start the session.'))
  }

  const cycle = <T,>(list: T[], cur: T | null, dir: number): T | undefined => {
    if (!list.length) return undefined
    const i = cur === null ? -1 : list.indexOf(cur)
    return list[(i + dir + list.length) % list.length]
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      window.kumo.hideLauncher()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void start()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const next = cycle(
        targets.map((t) => t.id),
        current,
        e.shiftKey ? -1 : 1,
      )
      if (next) setTarget(next)
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (e.altKey || !prompt.includes('\n'))) {
      e.preventDefault()
      const next = cycle(recents, project, e.key === 'ArrowDown' ? 1 : -1)
      if (next) setCwd(next)
    }
  }

  const info = TARGETS.find((t) => t.id === current)
  const pasted = current ? !DIRECT.includes(current) : false

  return (
    <div className="launcher" onKeyDown={onKey}>
      <div className="lc-card" ref={card}>
        <div className="lc-input-row">
          <span className="lc-glyph">{info ? <AgentGlyph agent={info.agent} color={info.color} size={20} /> : <Icon name="sparkle" size={18} />}</span>
          <textarea
            ref={input}
            className="lc-input"
            rows={1}
            autoFocus
            placeholder={targets.length ? tr('What should {0} do?', info?.label || 'the agent') : tr('No coding agents found on this computer')}
            value={prompt}
            disabled={!targets.length}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {busy && <span className="lc-spinner" />}
        </div>
        {targets.length > 0 && (
          <>
            <div className="lc-row">
              <span className="lc-label">{tr('Project')}</span>
              <div className="lc-chips">
                {recents.map((p) => (
                  <button key={p} type="button" tabIndex={-1} className={`lc-chip${p === project ? ' on' : ''}`} title={p} onClick={() => setCwd(p)}>
                    <Icon name="folder" size={12} />
                    {base(p)}
                  </button>
                ))}
                {cwd && !recents.includes(cwd) && (
                  <button type="button" tabIndex={-1} className="lc-chip on" title={cwd}>
                    <Icon name="folder" size={12} />
                    {base(cwd)}
                  </button>
                )}
                <button type="button" tabIndex={-1} className="lc-chip ghost" onClick={() => void pick()}>{tr('Choose…')}</button>
              </div>
            </div>
            <div className="lc-row">
              <span className="lc-label">{tr('Agent')}</span>
              <div className="lc-chips">
                {targets.map((t) => (
                  <button key={t.id} type="button" tabIndex={-1} className={`lc-chip${t.id === current ? ' on' : ''}`} title={t.sub} onClick={() => setTarget(t.id)}>
                    <AgentGlyph agent={t.agent} color={t.color} size={12} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="lc-foot">
          {error ? (
            <span className="lc-error">{error}</span>
          ) : (
            <span>
              <kbd>↵</kbd> {tr('start')} · <kbd>{tr('Tab')}</kbd> {tr('agent')} · <kbd>↑↓</kbd> {tr('project')} · <kbd>{tr('Esc')}</kbd> {tr('close')}
              {pasted && prompt.trim() ? ` · ${tr('the task is copied to the clipboard')}` : ''}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
