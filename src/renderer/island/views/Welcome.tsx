import { useEffect, useMemo, useState, type RefObject } from 'react'
import type { IntegrationStatus, McpClientId } from '../../../shared/types'
import type { KumoHandle } from '../../shared/Kumo'
import { AgentGlyph, Icon } from '../../shared/icons'
import { useIsland } from '../store'
import { Button } from '../ui'
import { tr } from '../../shared/i18n'

const COLORS: Record<string, string> = {
  'claude-code': '#E0865F',
  antigravity: '#8EA2FF',
  gemini: '#7AA7F7',
  qwen: '#9B8CFF',
  windsurf: '#5EC4B6',
  kiro: '#B58CF0',
  opencode: '#E6A15C',
  amp: '#EB7FA7',
  cline: '#6FB3F2',
  aider: '#9CCB6A',
}

const MCP: Partial<Record<IntegrationStatus['id'], McpClientId>> = {
  'claude-code': 'claude-code',
  codex: 'codex',
  gemini: 'gemini',
  qwen: 'qwen',
  cursor: 'cursor',
  windsurf: 'windsurf',
  copilot: 'copilot',
  kiro: 'kiro',
  opencode: 'opencode',
  amp: 'amp',
  cline: 'cline',
}

const LANGUAGES = [
  { value: 'auto', label: tr('System') },
  { value: 'en', label: tr('English') },
  { value: 'ru', label: 'Русский' },
  { value: 'de', label: tr('Deutsch') },
  { value: 'fr', label: tr('Français') },
  { value: 'es', label: tr('Español') },
  { value: 'pt', label: tr('Português') },
  { value: 'ja', label: '日本語' },
  { value: 'zh', label: '简体中文' },
]

type RowState = 'idle' | 'working' | 'done' | 'error'

const where = (i: IntegrationStatus): string => [i.installed.desktop && 'app', i.installed.cli && 'CLI'].filter(Boolean).join(' + ')

const prettyKey = (k: string): string =>
  k ? (window.kumo.platform === 'darwin' ? k.replace('Command', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace('Control', '⌃').replace(/\+/g, '') : k.replace('Control', 'Ctrl')) : ''

export function Welcome({ kumoRef }: { kumoRef: RefObject<KumoHandle | null> }) {
  const snap = useIsland((s) => s.snap)
  const settings = useIsland((s) => s.settings)
  const open = useIsland((s) => s.open)
  const [step, setStep] = useState<'agents' | 'done'>('agents')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [questions, setQuestions] = useState(true)
  const [rows, setRows] = useState<Record<string, { state: RowState; error?: string }>>({})
  const [busy, setBusy] = useState(false)

  const found = useMemo(() => (snap?.integrations ?? []).filter((i) => i.installed.cli || i.installed.desktop || i.state === 'connected' || i.state === 'outdated'), [snap?.integrations])
  const pending = found.filter((i) => i.state !== 'connected')

  useEffect(() => {
    if (picked === null && snap) setPicked(new Set(pending.filter((i) => i.state !== 'error').map((i) => i.id)))
  }, [snap, picked, pending])

  const toggle = (id: string): void => {
    const next = new Set(picked ?? [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPicked(next)
  }

  const apply = async (target: Parameters<typeof window.kumo.previewHooks>[0]): Promise<string | null> => {
    const p = await window.kumo.previewHooks(target, true)
    if (!p.ok || !p.value) return p.error || tr('Could not read the settings file')
    const r = await window.kumo.applyHooks(target, true, p.value.fingerprint)
    return r.ok ? null : r.error || tr('Could not write the settings file')
  }

  const connect = async (): Promise<void> => {
    const list = pending.filter((i) => picked?.has(i.id))
    if (!list.length) {
      setStep('done')
      return
    }
    setBusy(true)
    for (const i of list) {
      setRows((r) => ({ ...r, [i.id]: { state: 'working' } }))
      let error = await apply(i.id)
      const mcp = MCP[i.id]
      if (!error && questions && mcp) error = await apply(`mcp:${mcp}`)
      setRows((r) => ({ ...r, [i.id]: error ? { state: 'error', error } : { state: 'done' } }))
    }
    setBusy(false)
    setStep('done')
  }

  const finish = (): void => {
    void window.kumo.setSettings({ onboarded: true })
    open('home', { reset: true })
  }

  if (step === 'done') {
    const failed = Object.values(rows).filter((r) => r.state === 'error').length
    return (
      <div className="welcome" onMouseEnter={() => kumoRef.current?.nudge()}>
        <div className="welcome-title">{failed ? tr('Almost there.') : tr('All set.')}</div>
        <div className="welcome-body">
          {failed
            ? tr('Some agents could not be connected - you can retry them in Settings, where you can also review every change.')
            : tr('Start an agent as usual and it shows up here. A backup of every settings file was saved before anything changed.')}
        </div>
        <div className="welcome-tips">
          <span>
            <kbd>{prettyKey(settings?.hotkey || '')}</kbd>{' '}{tr('opens me from anywhere')}</span>
          {settings?.launcherHotkey && (
            <span>
              <kbd>{prettyKey(settings.launcherHotkey)}</kbd>{' '}{tr('starts a new task in any project')}</span>
          )}
          <span>{tr('Drop files on me to give your agents context')}</span>
        </div>
        <div className="welcome-lang">
          <span>{tr('Language')}</span>
          <select value={settings?.language || 'auto'} onChange={(e) => void window.kumo.setSettings({ language: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div className="welcome-actions">
          {failed > 0 && <Button onClick={() => window.kumo.openSettings('agents')}>{tr('Open settings')}</Button>}
          <Button kind="primary" onClick={finish} autoFocus>{tr('Get started')}</Button>
        </div>
      </div>
    )
  }

  const count = pending.filter((i) => picked?.has(i.id)).length
  return (
    <div className="welcome" onMouseEnter={() => kumoRef.current?.nudge()}>
      <div className="welcome-title">{tr('Hi, I’m Kumo.')}</div>
      <div className="welcome-body">
        {found.length
          ? tr('I keep an eye on your coding agents - what they’re doing, when they need you, and what changed. I found these on your computer:')
          : tr('I keep an eye on your coding agents - what they’re doing, when they need you, and what changed. I didn’t find any agents yet; once you install one, connect it in Settings.')}
      </div>
      {found.length > 0 && (
        <div className="welcome-list">
          {found.map((i) => {
            const row = rows[i.id]
            const connected = i.state === 'connected'
            return (
              <label key={i.id} className={`welcome-row${connected ? ' done' : ''}`}>
                {connected ? (
                  <span className="welcome-check on">
                    <Icon name="check" size={11} />
                  </span>
                ) : (
                  <input type="checkbox" className="welcome-box" checked={Boolean(picked?.has(i.id))} disabled={busy} onChange={() => toggle(i.id)} />
                )}
                <AgentGlyph agent={i.id} color={COLORS[i.id] || 'currentColor'} size={14} />
                <span className="welcome-name">{i.name}</span>
                <span className="welcome-state">
                  {row?.state === 'working'
                    ? tr('Connecting…')
                    : row?.state === 'error'
                      ? row.error
                      : connected
                        ? tr('Connected')
                        : i.state === 'outdated'
                          ? tr('Needs reconnect')
                          : i.state === 'error'
                            ? tr('Settings file needs a look')
                            : tr('{0} found', where(i))}
                </span>
                {(i.beta || i.partial) && <span className="welcome-tag">{i.partial ? tr('Alerts only') : tr('Beta')}</span>}
              </label>
            )
          })}
        </div>
      )}
      {pending.some((i) => MCP[i.id]) && (
        <label className="welcome-option">
          <input type="checkbox" className="welcome-box" checked={questions} disabled={busy} onChange={(e) => setQuestions(e.target.checked)} />
          <span>{tr('Let agents ask me questions with answer buttons, right here')}</span>
        </label>
      )}
      <div className="welcome-actions">
        <Button kind="ghost" onClick={() => window.kumo.openSettings('agents')}>{tr('Review in Settings')}</Button>
        <span className="spacer" />
        <Button kind="primary" onClick={() => void connect()} disabled={busy} autoFocus>
          {count ? tr('Connect {0}', count === 1 ? '1 agent' : `${count} agents`) : tr('Continue')}
        </Button>
      </div>
    </div>
  )
}
