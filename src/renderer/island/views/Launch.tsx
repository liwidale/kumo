import { tr } from '../../shared/i18n'
import { useEffect, useRef, useState } from 'react'
import type { LaunchRequest } from '../../../shared/types'
import { base } from '../../shared/format'
import { AgentGlyph, Icon } from '../../shared/icons'
import { useIsland } from '../store'
import { Button, IconButton, Menu, useAction } from '../ui'
import { kindIcon } from './Context'
import { availability, DIRECT, TARGETS } from '../../shared/targets'

type Target = LaunchRequest['target']

export function Launch() {
  const snap = useIsland((s) => s.snap)
  const settings = useIsland((s) => s.settings)
  const back = useIsland((s) => s.back)
  const set = useIsland((s) => s.set)
  const collapse = useIsland((s) => s.collapse)
  const act = useAction()
  const inst = snap?.installed
  const available = availability(inst)
  const firstAvailable = TARGETS.find((t) => available[t.id])?.id ?? 'claude-cli'
  const [target, setTarget] = useState<Target>(firstAvailable)
  const [cwd, setCwd] = useState<string>(settings?.recentProjects[0] || '')
  const [prompt, setPrompt] = useState('')
  const loose = (snap?.context || []).filter((c) => !c.sessionKey && !c.missing && !c.chat)
  const [useCtx, setUseCtx] = useState<string[]>(loose.map((l) => l.id))
  const [busy, setBusy] = useState(false)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!available[target]) setTarget(firstAvailable)
  }, [firstAvailable])

  const pick = async (): Promise<void> => {
    set({ dialogOpen: true })
    const p = await window.kumo.pickFolder()
    set({ dialogOpen: false })
    if (p) setCwd(p)
  }

  const start = async (): Promise<void> => {
    if (!cwd) {
      await pick()
      return
    }
    setBusy(true)
    const ok = await act(window.kumo.launch({ target, cwd, prompt, contextIds: useCtx }))
    setBusy(false)
    if (ok) setTimeout(collapse, 900)
  }

  const recents = settings?.recentProjects || []
  const nothing = !Object.values(available).some(Boolean)

  return (
    <div className="launch">
      <div className="detail-head">
        <IconButton icon="back" title={tr('Back (Esc)')} onClick={back} />
        <div className="detail-title">
          <div className="detail-project">{tr('New session')}</div>
          <div className="detail-sub">{tr('Start an agent on a project - Kumo follows it from here.')}</div>
        </div>
      </div>

      {nothing ? (
        <div className="muted-note">{tr('Kumo didn\'t find a coding agent on this computer. Install one, like Claude Code, Codex, Gemini CLI or Cursor, and it\'ll show up here.')}</div>
      ) : (
        <>
          <div className="targets">
            {TARGETS.filter((t) => available[t.id]).map((t) => (
              <button key={t.id} className={`target${target === t.id ? ' on' : ''}`} disabled={!available[t.id]} onClick={() => setTarget(t.id)} title={available[t.id] ? '' : tr('Not installed')}>
                <AgentGlyph agent={t.agent} color={available[t.id] ? t.color : 'currentColor'} size={15} />
                <span className="target-label">{t.label}</span>
                <span className="target-sub">{available[t.id] ? t.sub : tr('Not installed')}</span>
              </button>
            ))}
          </div>

          <div className="field">
            <label>{tr('Project')}</label>
            <Menu
              trigger={(_o, toggle) => (
                <button className="select" onClick={recents.length ? toggle : () => void pick()}>
                  <Icon name="folder" size={14} />
                  <span className="select-value">{cwd ? base(cwd) : tr('Choose a folder…')}</span>
                  {cwd && <span className="select-hint mono">{cwd}</span>}
                  <Icon name="down" size={12} />
                </button>
              )}
              items={[
                ...recents.slice(0, 8).map((p) => ({ label: base(p), hint: p.length > 38 ? `…${p.slice(-36)}` : p, checked: p === cwd, onClick: () => setCwd(p) })),
                'sep' as const,
                { label: tr('Choose folder…'), icon: 'folder' as const, onClick: () => void pick() },
              ]}
            />
          </div>

          <div className="field">
            <label>{tr('Task')}{' '}{DIRECT.includes(target) ? '' : <span className="muted">{tr('(copied to the clipboard)')}</span>}</label>
            <textarea
              ref={promptRef}
              className="text-area"
              rows={3}
              placeholder={tr('What should the agent work on? (optional)')}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void start()
                }
              }}
            />
          </div>

          {loose.length > 0 && (
            <div className="field">
              <label>{tr('Include context')}</label>
              <div className="chips">
                {loose.map((l) => {
                  const on = useCtx.includes(l.id)
                  return (
                    <button key={l.id} className={`chip toggle${on ? ' on' : ''}`} onClick={() => setUseCtx(on ? useCtx.filter((x) => x !== l.id) : [...useCtx, l.id])}>
                      <Icon name={on ? 'check' : kindIcon(l.kind)} size={12} />
                      <span className="chip-name">{l.name}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div className="launch-actions">
            <span className="muted small">{tr('{0} to start', window.kumo.platform === 'darwin' ? '⌘↩' : 'Ctrl+Enter')}</span>
            <span className="spacer" />
            <Button kind="primary" icon="forward" onClick={() => void start()} disabled={busy || !available[target]}>
              {cwd ? tr('Start') : tr('Choose folder')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
