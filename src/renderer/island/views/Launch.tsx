import { useEffect, useRef, useState } from 'react'
import type { LaunchRequest } from '../../../shared/types'
import { base } from '../../shared/format'
import { AgentGlyph, Icon } from '../../shared/icons'
import { useIsland } from '../store'
import { Button, IconButton, Menu, useAction } from '../ui'
import { kindIcon } from './Context'

type Target = LaunchRequest['target']

const TARGETS: { id: Target; label: string; sub: string; agent: string; color: string }[] = [
  { id: 'claude-cli', label: 'Claude Code', sub: 'In a new terminal', agent: 'claude-code', color: '#E0865F' },
  { id: 'claude-desktop', label: 'Claude', sub: 'Desktop app', agent: 'claude-code', color: '#E0865F' },
  { id: 'antigravity-desktop', label: 'Antigravity', sub: 'Desktop app', agent: 'antigravity', color: '#8EA2FF' },
  { id: 'agy-cli', label: 'agy', sub: 'Antigravity CLI', agent: 'antigravity', color: '#8EA2FF' },
  { id: 'codex-cli', label: 'Codex', sub: 'In a new terminal', agent: 'codex', color: '#C9CDD6' },
  { id: 'gemini-cli', label: 'Gemini CLI', sub: 'In a new terminal', agent: 'gemini', color: '#7AA7F7' },
  { id: 'cursor', label: 'Cursor', sub: 'Editor', agent: 'cursor', color: '#C9CDD6' },
]

export function Launch() {
  const snap = useIsland((s) => s.snap)
  const settings = useIsland((s) => s.settings)
  const back = useIsland((s) => s.back)
  const set = useIsland((s) => s.set)
  const collapse = useIsland((s) => s.collapse)
  const act = useAction()
  const inst = snap?.installed
  const available: Record<Target, boolean> = {
    'claude-cli': Boolean(inst?.claudeCli),
    'claude-desktop': Boolean(inst?.claudeDesktop),
    'antigravity-desktop': Boolean(inst?.antigravityDesktop),
    'agy-cli': Boolean(inst?.agyCli),
    'codex-cli': Boolean(inst?.codexCli),
    'gemini-cli': Boolean(inst?.geminiCli),
    cursor: Boolean(inst?.cursorApp),
  }
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
        <IconButton icon="back" title="Back (Esc)" onClick={back} />
        <div className="detail-title">
          <div className="detail-project">New session</div>
          <div className="detail-sub">Start an agent on a project - Kumo follows it from here.</div>
        </div>
      </div>

      {nothing ? (
        <div className="muted-note">Kumo didn't find a coding agent on this computer (Claude Code, Antigravity, Codex, Gemini CLI or Cursor). Install one of them and it'll show up here.</div>
      ) : (
        <>
          <div className="targets">
            {[...TARGETS].sort((a, b) => Number(available[b.id]) - Number(available[a.id])).map((t) => (
              <button key={t.id} className={`target${target === t.id ? ' on' : ''}`} disabled={!available[t.id]} onClick={() => setTarget(t.id)} title={available[t.id] ? '' : 'Not installed'}>
                <AgentGlyph agent={t.agent} color={available[t.id] ? t.color : 'currentColor'} size={15} />
                <span className="target-label">{t.label}</span>
                <span className="target-sub">{available[t.id] ? t.sub : 'Not installed'}</span>
              </button>
            ))}
          </div>

          <div className="field">
            <label>Project</label>
            <Menu
              trigger={(_o, toggle) => (
                <button className="select" onClick={recents.length ? toggle : () => void pick()}>
                  <Icon name="folder" size={14} />
                  <span className="select-value">{cwd ? base(cwd) : 'Choose a folder…'}</span>
                  {cwd && <span className="select-hint mono">{cwd}</span>}
                  <Icon name="down" size={12} />
                </button>
              )}
              items={[
                ...recents.slice(0, 8).map((p) => ({ label: base(p), hint: p.length > 38 ? `…${p.slice(-36)}` : p, checked: p === cwd, onClick: () => setCwd(p) })),
                'sep' as const,
                { label: 'Choose folder…', icon: 'folder' as const, onClick: () => void pick() },
              ]}
            />
          </div>

          <div className="field">
            <label>Task {['claude-cli', 'codex-cli', 'gemini-cli'].includes(target) ? '' : <span className="muted">(copied to the clipboard)</span>}</label>
            <textarea
              ref={promptRef}
              className="text-area"
              rows={3}
              placeholder="What should the agent work on? (optional)"
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
              <label>Include context</label>
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
            <span className="muted small">{window.kumo.platform === 'darwin' ? '⌘↩' : 'Ctrl+Enter'} to start</span>
            <span className="spacer" />
            <Button kind="primary" icon="forward" onClick={() => void start()} disabled={busy || !available[target]}>
              {cwd ? 'Start' : 'Choose folder'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
