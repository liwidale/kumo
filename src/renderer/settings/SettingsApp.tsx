import { tr } from '../shared/i18n'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ApprovalRule, DecisionRecord, HookPreview, IntegrationStatus, McpClientStatus, ProviderInfo, Settings, SettingsSection } from '../../shared/types'
import { ago } from '../shared/format'
import { useSettings, useSnapshot, useTheme } from '../shared/hooks'
import { AgentGlyph, Icon, type IconName } from '../shared/icons'
import { Kumo } from '../shared/Kumo'
import { ProviderLogo } from '../shared/logos'

const SECTIONS: { id: SettingsSection; label: string; icon: IconName }[] = [
  { id: 'general', label: tr('General'), icon: 'gear' },
  { id: 'appearance', label: tr('Appearance'), icon: 'eye' },
  { id: 'agents', label: tr('Agents'), icon: 'layers' },
  { id: 'approvals', label: tr('Approvals'), icon: 'shield' },
  { id: 'chat', label: tr('Chat'), icon: 'chat' },
  { id: 'privacy', label: tr('Privacy'), icon: 'pause' },
  { id: 'about', label: tr('About'), icon: 'sparkle' },
]

const isMac = window.kumo.platform === 'darwin'


function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
      <motion.span className="knob" layout transition={{ type: 'spring', stiffness: 700, damping: 40 }} />
    </button>
  )
}

function Row({ title, desc, children, wide }: { title: string; desc?: ReactNode; children?: ReactNode; wide?: boolean }) {
  return (
    <div className={`row${wide ? ' wide' : ''}`}>
      <div className="row-text">
        <div className="row-title">{title}</div>
        {desc && <div className="row-desc">{desc}</div>}
      </div>
      {children && <div className="row-control">{children}</div>}
    </div>
  )
}

function Group({ title, children, foot }: { title?: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <section className="group">
      {title && <h3 className="group-title">{title}</h3>}
      <div className="group-box">{children}</div>
      {foot && <div className="group-foot">{foot}</div>}
    </section>
  )
}

function Select<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="select-wrap">
      <select value={String(value)} onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="down" size={12} />
    </div>
  )
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${options.map((x) => x.value).join()}`} className="seg-bg" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

function Btn({ children, kind = 'secondary', onClick, disabled, icon }: { children: ReactNode; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; onClick?: () => void; disabled?: boolean; icon?: IconName }) {
  return (
    <button className={`sbtn sbtn-${kind}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </button>
  )
}


type Patch = (p: Partial<Settings>) => void

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

function General({ s, patch }: { s: Settings; patch: Patch }) {
  const snap = useSnapshot()
  const macTerminals = [...new Set([...(snap?.installed.terminals ?? []), s.terminal])].filter((t) => t !== 'Terminal' && t !== 'auto')
  const [displays, setDisplays] = useState<{ id: string; label: string; primary: boolean }[]>([])
  useEffect(() => {
    void window.kumo.displays().then(setDisplays)
  }, [])
  const hotkeys = isMac
    ? ['Command+Alt+K', 'Command+Shift+K', 'Control+Alt+Space', 'Command+Alt+J', '']
    : ['Control+Alt+K', 'Control+Shift+K', 'Control+Alt+Space', 'Alt+Shift+K', '']
  const launchKeys = isMac ? ['Command+Shift+Space', 'Command+Alt+Space', 'Command+Shift+L', ''] : ['Control+Alt+Space', 'Control+Shift+Space', 'Alt+Shift+Space', 'Control+Alt+L', '']
  const prettyKey = (k: string): string => (k ? (isMac ? k.replace('Command', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace('Control', '⌃').replace(/\+/g, '') : k.replace(/\+/g, ' + ')) : tr('None'))
  return (
    <>
      <Group title={tr('Kumo')}>
        <Row title={tr('Open at login')} desc={tr('Start Kumo quietly when you sign in.')}>
          <Toggle label={tr('Open at login')} on={s.launchAtLogin} onChange={(v) => patch({ launchAtLogin: v })} />
        </Row>
        <Row title={tr('Show on')} desc={isMac ? tr('Automatic prefers the display with a notch.') : tr('Where the island sits.')}>
          <Select
            value={s.display}
            onChange={(v) => patch({ display: v })}
            options={[{ value: 'auto', label: tr('Automatic') }, { value: 'primary', label: tr('Main display') }, ...displays.map((d) => ({ value: d.id, label: `${d.label}${d.primary ? ' (main)' : ''}` }))]}
          />
        </Row>
        <Row
          title={tr('Show Kumo as')}
          desc={
            isMac
              ? tr('Menu bar only keeps the screen clear: the icon shows what your agents are doing, and the island opens by itself only when a request needs your OK.')
              : tr('Tray only keeps the screen clear: the tray icon shows what your agents are doing, and the island opens by itself only when a request needs your OK.')
          }
        >
          <Seg
            value={s.presence}
            onChange={(v) => patch({ presence: v })}
            options={[
              { value: 'island', label: tr('Island') },
              { value: 'tray', label: isMac ? tr('Menu bar only') : tr('Tray only') },
            ]}
          />
        </Row>
        <Row title={tr('When nothing is running')} desc={tr('Kumo can stay visible as a small character, or step out of the way until you hover the top of the screen.')}>
          <Seg
            value={s.idle}
            onChange={(v) => patch({ idle: v })}
            options={[
              { value: 'character', label: tr('Show Kumo') },
              { value: 'hide', label: tr('Hide') },
            ]}
          />
        </Row>
        <Row title={tr('Keyboard shortcut')} desc={tr('Opens and closes Kumo from anywhere.')}>
          <Select value={s.hotkey} onChange={(v) => patch({ hotkey: v })} options={hotkeys.map((k) => ({ value: k, label: prettyKey(k) }))} />
        </Row>
        <Row title={tr('Quick launch')} desc={tr('A search-style bar: type a task, pick a project and an agent, press Enter.')}>
          <Select value={s.launcherHotkey} onChange={(v) => patch({ launcherHotkey: v })} options={launchKeys.map((k) => ({ value: k, label: prettyKey(k) }))} />
        </Row>
        <Row title={tr('Language')}>
          <Select value={s.language} onChange={(v) => patch({ language: v })} options={LANGUAGES} />
        </Row>
      </Group>
      <Group title={tr('Behaviour')}>
        <Row title={tr('Show a card when a session finishes')} desc={tr('A short summary appears for a few seconds, then folds away.')}>
          <Toggle label={tr('Completion cards')} on={s.showCompletion} onChange={(v) => patch({ showCompletion: v })} />
        </Row>
        <Row title={tr('Fold away after')} desc={tr('When open and you\'ve moved on.')}>
          <Select
            value={s.autoCollapseSec}
            onChange={(v) => patch({ autoCollapseSec: v })}
            options={[
              { value: 15, label: tr('15 seconds') },
              { value: 30, label: tr('30 seconds') },
              { value: 60, label: tr('1 minute') },
              { value: 0, label: tr('Never') },
            ]}
          />
        </Row>
        <Row title={tr('Pause notifications')} desc={tr('Kumo keeps watching but won\'t open by itself. Agents ask for permission in their own windows.')}>
          <Toggle label={tr('Pause')} on={s.paused} onChange={(v) => patch({ paused: v })} />
        </Row>
      </Group>
      <Group title={tr('Opening things')}>
        <Row title={tr('Terminal for new sessions')}>
          <Select
            value={s.terminal}
            onChange={(v) => patch({ terminal: v })}
            options={isMac ? [{ value: 'auto', label: tr('Terminal') }, ...macTerminals.map((t) => ({ value: t, label: t }))] : [{ value: 'auto', label: tr('Windows Terminal') }, { value: 'cmd', label: tr('Command Prompt') }]}
          />
        </Row>
        <Row title={tr('Editor for files')}>
          <Select
            value={s.editor}
            onChange={(v) => patch({ editor: v })}
            options={[
              { value: 'auto', label: tr('Automatic') },
              { value: 'code', label: tr('VS Code') },
              { value: 'cursor', label: tr('Cursor') },
              { value: 'zed', label: tr('Zed') },
              { value: 'antigravity', label: tr('Antigravity') },
              { value: 'system', label: tr('System default') },
            ]}
          />
        </Row>
      </Group>
    </>
  )
}

function Appearance({ s, patch, theme }: { s: Settings; patch: Patch; theme: 'light' | 'dark' }) {
  return (
    <>
      <Group title={tr('Theme')}>
        <div className="theme-picker">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} className={`theme-card${s.theme === t ? ' on' : ''}`} onClick={() => patch({ theme: t })}>
              <span className={`theme-preview tp-${t}`}>
                <span className="tp-pill">
                  <span className="tp-char" />
                  <span className="tp-line" />
                </span>
              </span>
              <span className="theme-label">{t === 'system' ? tr('Automatic') : t === 'light' ? tr('Light') : tr('Dark')}</span>
            </button>
          ))}
        </div>
        {isMac && <div className="inline-note">{tr('On a MacBook notch, Kumo stays black like the hardware it extends.')}</div>}
      </Group>
      <Group title={tr('Motion & sound')}>
        <Row title={tr('Motion')} desc={tr('Reduced keeps transitions short and still.')}>
          <Seg
            value={s.motion}
            onChange={(v) => patch({ motion: v })}
            options={[
              { value: 'full', label: tr('Full') },
              { value: 'reduced', label: tr('Reduced') },
            ]}
          />
        </Row>
        <Row title={tr('Sounds')} desc={tr('Soft cues for approvals, completions and errors.')}>
          <Toggle label={tr('Sounds')} on={s.sounds} onChange={(v) => patch({ sounds: v })} />
        </Row>
        <Row title={tr('Volume')}>
          <div className="volume">
            <input type="range" min={0} max={1} step={0.05} value={s.volume} disabled={!s.sounds} onChange={(e) => patch({ volume: Number(e.target.value) })} />
            <Btn kind="ghost" onClick={() => window.kumo.playTestSound()} disabled={!s.sounds}>{tr('Test')}</Btn>
          </div>
        </Row>
      </Group>
      <div className="mascot-preview">
        <Kumo size={64} mood="idle" palette={{ body: theme === 'dark' ? '#f4f4f6' : '#1d1d1f', eye: theme === 'dark' ? '#202022' : '#f6f6f8', accent: '#ffb547' }} reduced={s.motion === 'reduced'} />
      </div>
    </>
  )
}

function HookDialog({ preview, onClose, onApplied }: { preview: HookPreview; onClose: () => void; onApplied: (msg: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const limits = preview.integration === 'claude-limits'
  const mcp = preview.integration.startsWith('mcp:')
  const name = NAMES[preview.integration.replace(/^mcp:/, '').replace('claude-limits', 'claude-code')] || preview.integration
  const apply = async (): Promise<void> => {
    setBusy(true)
    const r = await window.kumo.applyHooks(preview.integration, preview.install, preview.fingerprint)
    setBusy(false)
    if (r.ok) onApplied(limits ? (preview.install ? tr('Plan limits will appear after Claude Code’s next update.') : tr('Plan limits turned off.')) : mcp ? (preview.install ? tr('{0} can now ask you questions through Kumo. Restart it to pick up the change.', name) : tr('{0} no longer uses Kumo\'s tools.', name)) : preview.install ? `${tr('{0} connected.', name)}${r.value ? ` ${tr('A backup of your settings was saved.')}` : ''}` : tr('{0} disconnected.', name))
    else setErr(r.error || tr('Could not write the file'))
  }
  return (
    <motion.div className="dialog-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        className="dialog"
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 460, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <div className="dialog-title">{limits ? (preview.install ? tr('Show Claude plan limits') : tr('Stop reading plan limits')) : mcp ? (preview.install ? tr('Let {0} ask you questions', name) : tr('Remove Kumo\'s tools from {0}', name)) : preview.install ? tr('Connect {0}', name) : tr('Disconnect {0}', name)}</div>
        <div className="dialog-body">
          {limits
            ? preview.install
              ? tr('Kumo adds itself to Claude Code’s status line, which is where Claude Code reports your 5-hour and weekly usage. If you already have a status line, it is kept and still shows the same thing; if not, the line stays empty.')
              : tr('Kumo removes itself from the status line and puts your original one back.')
            : mcp
            ? preview.install
              ? tr('Kumo will add itself as an MCP server in {0}\'s settings. {1} gets two tools: ask_user shows a question with answer buttons in the island, notify_user shows a short note. Your other servers stay as they are.', name, name)
              : tr('Kumo will remove only its own MCP server entry. Everything else stays.')
            : preview.install
            ? tr('Kumo will add its hook entries to {0}\'s settings so sessions, approvals and context can reach Kumo. Your other settings and hooks stay exactly as they are.', name)
            : tr('Kumo will remove only its own hook entries. Everything else stays.')}
        </div>
        <div className="dialog-path mono">{preview.configPath}</div>
        <pre className="dialog-diff">
          {preview.diff.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>
              {l}
            </div>
          ))}
        </pre>
        <div className="dialog-note">{tr('A backup is saved next to the file before anything changes. If Kumo isn\'t running, {0} works exactly as before.', name)}</div>
        {err && <div className="dialog-error">{err}</div>}
        <div className="dialog-actions">
          <Btn kind="ghost" onClick={onClose}>{tr('Cancel')}</Btn>
          <Btn kind={preview.install ? 'primary' : 'danger'} onClick={() => void apply()} disabled={busy}>
            {limits ? (preview.install ? tr('Turn on') : tr('Turn off')) : preview.install ? tr('Connect') : tr('Disconnect')}
          </Btn>
        </div>
      </motion.div>
    </motion.div>
  )
}

function IntegrationCard({ i, onPreview, onLimits, s, patch }: { i: IntegrationStatus; onPreview: (install: boolean) => void; onLimits?: (on: boolean) => void; s: Settings; patch: Patch }) {
  const meta = AGENT_META[i.id]
  const color = meta.color
  const stateLabel = { connected: tr('Connected'), disconnected: tr('Not connected'), outdated: tr('Needs reconnect'), error: tr('Problem'), unavailable: tr('Not installed') }[i.state]
  const where = [i.installed.desktop && meta.desktop, i.installed.cli && meta.cli].filter(Boolean).join(' · ')
  const routing = meta.routing
  return (
    <div className="int-card">
      <div className="int-head">
        <span className="int-glyph">
          <AgentGlyph agent={i.id} color={color} size={18} />
        </span>
        <div className="int-text">
          <div className="int-name">
            {i.name}
            {i.beta && <span className="int-tag">{tr('Beta')}</span>}
            {i.partial && <span className="int-tag">{tr('Alerts only')}</span>}
          </div>
          <div className="int-sub">{where || tr('Not found on this computer')}</div>
        </div>
        <span className={`int-state state-${i.state}`}>
          <span className="sdot" />
          {stateLabel}
        </span>
      </div>
      <div className="int-detail">{i.detail}</div>
      {i.lastEventAt && <div className="int-detail muted">{tr('Last event {0} ago', ago(i.lastEventAt))}</div>}
      {i.id === 'claude-code' && i.state === 'connected' && (
        <div className="int-option">
          <div className="row-text">
            <div className="row-title">{tr('Show plan limits in Kumo')}</div>
            <div className="row-desc">{tr('Reads your 5-hour and weekly usage from Claude Code\'s status line. Your own status line keeps working exactly as before.')}</div>
          </div>
          <Toggle label={tr('Claude plan limits')} on={Boolean(i.limits)} onChange={(v) => onLimits?.(v)} />
        </div>
      )}
      {routing && i.state === 'connected' && (
        <div className="int-option">
          <div className="row-text">
            <div className="row-title">{tr('Approve commands and edits in Kumo')}</div>
            <div className="row-desc">{tr('Kumo asks before {0} {1}. If you don\'t answer in time, {0} asks in its own window. Off: {0} follows its own permission settings.', i.name, meta.asks || tr('runs commands or writes files'))}</div>
          </div>
          <Toggle label={tr('{0} approvals', i.name)} on={s.approvals[routing]} onChange={(v) => patch({ approvals: { ...s.approvals, [routing]: v } })} />
        </div>
      )}
      <div className="int-actions">
        <span className="mono path">{i.configPath}</span>
        {i.state === 'connected' ? (
          <Btn kind="ghost" onClick={() => onPreview(false)}>{tr('Disconnect')}</Btn>
        ) : i.state === 'unavailable' ? (
          <Btn kind="secondary" onClick={() => onPreview(true)}>{tr('Connect anyway')}</Btn>
        ) : (
          <Btn kind="primary" onClick={() => onPreview(true)} disabled={i.state === 'error' && !i.detail.includes('JSON')}>
            {i.state === 'outdated' ? tr('Reconnect') : tr('Connect')}
          </Btn>
        )}
      </div>
    </div>
  )
}

type Routing = 'antigravity' | 'gemini' | 'cursor' | 'windsurf' | 'kiro' | 'opencode' | 'amp' | 'cline'

const NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  antigravity: 'Antigravity',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  cursor: 'Cursor',
  copilot: 'Copilot CLI',
  qwen: 'Qwen Code',
  windsurf: 'Windsurf',
  kiro: 'Kiro CLI',
  opencode: 'OpenCode',
  amp: 'Amp',
  cline: 'Cline',
  aider: 'Aider',
  roo: 'Roo Code',
}

const AGENT_META: Record<IntegrationStatus['id'], { color: string; desktop: string; cli: string; routing?: Routing; asks?: string }> = {
  'claude-code': { color: '#E0865F', desktop: 'Claude Desktop', cli: 'claude CLI' },
  antigravity: { color: '#8EA2FF', desktop: tr('{0} app', 'Antigravity'), cli: 'agy CLI', routing: 'antigravity', asks: tr('runs commands or opens web pages') },
  codex: { color: '#C9CDD6', desktop: tr('{0} app', 'Codex'), cli: 'codex CLI' },
  gemini: { color: '#7AA7F7', desktop: '', cli: 'gemini CLI', routing: 'gemini', asks: tr('runs commands or writes files') },
  cursor: { color: '#C9CDD6', desktop: tr('{0} app', 'Cursor'), cli: '', routing: 'cursor', asks: tr('runs terminal commands or MCP tools') },
  copilot: { color: '#C9CDD6', desktop: '', cli: 'copilot CLI' },
  qwen: { color: '#9B8CFF', desktop: '', cli: 'qwen CLI' },
  windsurf: { color: '#5EC4B6', desktop: tr('{0} app', 'Windsurf'), cli: '', routing: 'windsurf', asks: tr('runs commands, writes files or uses MCP tools') },
  kiro: { color: '#B58CF0', desktop: '', cli: 'kiro-cli', routing: 'kiro', asks: tr('uses a tool') },
  opencode: { color: '#E6A15C', desktop: '', cli: 'opencode CLI', routing: 'opencode', asks: tr('needs a permission') },
  amp: { color: '#EB7FA7', desktop: '', cli: 'amp CLI', routing: 'amp', asks: tr('uses a tool') },
  cline: { color: '#6FB3F2', desktop: tr('{0} extension', 'Cline'), cli: 'cline CLI', routing: 'cline', asks: tr('uses a tool') },
  aider: { color: '#9CCB6A', desktop: '', cli: 'aider CLI' },
}

function Agents({ s, patch, flash }: { s: Settings; patch: Patch; flash: (m: string) => void }) {
  const snap = useSnapshot()
  const [preview, setPreview] = useState<HookPreview | null>(null)
  const [agent, setAgent] = useState('my-agent')
  const [cmd, setCmd] = useState('')
  useEffect(() => {
    void window.kumo.relayCommand(agent).then(setCmd)
  }, [agent])
  const [mcp, setMcp] = useState<McpClientStatus[]>([])
  const loadMcp = (): void => void window.kumo.mcpStatus().then(setMcp)
  useEffect(loadMcp, [snap?.integrations])
  const open = async (id: HookPreview['integration'], install: boolean): Promise<void> => {
    const r = await window.kumo.previewHooks(id, install)
    if (r.ok && r.value) setPreview(r.value)
    else flash(r.error || tr('Could not read the settings file'))
  }
  return (
    <>
      <Group title={tr('Coding agents')}>
        <div className="int-list">
          {[...(snap?.integrations ?? [])]
            .sort((a, b) => Number(a.state === 'unavailable') - Number(b.state === 'unavailable'))
            .map((i) => (
            <IntegrationCard key={i.id} i={i} s={s} patch={patch} onPreview={(install) => void open(i.id, install)} onLimits={(on) => void open('claude-limits', on)} />
          ))}
        </div>
      </Group>
      <Group title={tr('Questions from agents')} foot={tr('Adds Kumo as an MCP server. The agent can then ask you a question with answer buttons right in the island, or leave you a short note - handy when you\'re in another window.')}>
        <div className="mcp-list">
          {[...mcp]
            .sort((a, b) => Number(b.installed) - Number(a.installed))
            .map((m) => (
              <div key={m.id} className="mcp-row">
                <span className="int-glyph small">
                  <AgentGlyph agent={m.id} color={AGENT_META[m.id as IntegrationStatus['id']]?.color || 'currentColor'} size={15} />
                </span>
                <div className="row-text">
                  <div className="row-title">{m.name}</div>
                  <div className="row-desc" title={m.configPath}>
                    {m.error ? m.error : m.connected ? tr('Can ask you questions') : m.installed ? tr('Not set up') : tr('Not found on this computer')}
                  </div>
                </div>
                {m.connected ? (
                  <Btn kind="ghost" onClick={() => void open(`mcp:${m.id}`, false)}>{tr('Remove')}</Btn>
                ) : (
                  <Btn kind={m.installed ? 'primary' : 'secondary'} onClick={() => void open(`mcp:${m.id}`, true)}>{tr('Add')}</Btn>
                )}
              </div>
            ))}
        </div>
      </Group>
      <Group title={tr('Other agents')} foot={tr('Any tool with command hooks can report to Kumo. Use your agent\'s name; its sessions get their own row, approvals and context hand-off.')}>
        <div className="relay">
          <input className="field-input" value={agent} onChange={(e) => setAgent(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24))} placeholder="agent-name" />
          <code className="mono relay-cmd selectable">{cmd}</code>
          <Btn kind="ghost" icon="copy" onClick={() => void window.kumo.copyText(cmd).then(() => flash(tr('Command copied')))}>{tr('Copy')}</Btn>
        </div>
      </Group>
      <AnimatePresence>
        {preview && (
          <HookDialog
            preview={preview}
            onClose={() => setPreview(null)}
            onApplied={(m) => {
              setPreview(null)
              flash(m)
              loadMcp()
            }}
          />
        )}
      </AnimatePresence>
      {!snap?.serverOk && snap && <div className="inline-note error">{tr('Kumo\'s local event server isn\'t running')}{snap.serverError ? `: ${snap.serverError}` : ''}. {tr('Quit and reopen Kumo.')}</div>}
    </>
  )
}

function Approvals({ s, patch }: { s: Settings; patch: Patch }) {
  const a = s.approvals
  const set = (p: Partial<Settings['approvals']>): void => patch({ approvals: { ...a, ...p } })
  return (
    <>
      <Group title={tr('Approvals')} foot={tr('If you don\'t answer in time - or Kumo isn\'t running - the agent asks in its own window as usual. Kumo never approves anything on its own.')}>
        <Row title={tr('Ask me in Kumo')} desc={tr('Permission requests from connected agents show up in the island with Allow and Deny.')}>
          <Toggle label={tr('Approvals in Kumo')} on={a.enabled} onChange={(v) => set({ enabled: v })} />
        </Row>
        <Row title={tr('Wait for my answer')} desc={tr('After this, the request goes back to the agent.')}>
          <Select
            value={a.timeoutSec}
            onChange={(v) => set({ timeoutSec: v })}
            options={[
              { value: 30, label: tr('30 seconds') },
              { value: 60, label: tr('1 minute') },
              { value: 110, label: tr('2 minutes') },
              { value: 300, label: tr('5 minutes') },
              { value: 600, label: tr('10 minutes') },
            ]}
          />
        </Row>
        <Row title={tr('Global shortcuts while a request waits')} desc={isMac ? tr('⌘⌥Y allows, ⌘⌥N denies - without switching windows.') : tr('Ctrl+Alt+Y allows, Ctrl+Alt+N denies - without switching windows.')}>
          <Toggle label={tr('Global approval shortcuts')} on={a.globalKeys} onChange={(v) => set({ globalKeys: v })} />
        </Row>
        <Row title={tr('Also send a system notification')} desc={tr('Useful when Kumo is on another display.')}>
          <Toggle label={tr('Notifications')} on={a.notify} onChange={(v) => set({ notify: v })} />
        </Row>
      </Group>
      <Rules s={s} patch={patch} />
      <DecisionHistory />
    </>
  )
}

const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

function Rules({ s, patch }: { s: Settings; patch: Patch }) {
  const a = s.approvals
  const rules = a.rules || []
  const [draft, setDraft] = useState<{ action: 'allow' | 'deny'; tool: string; pattern: string; project: string }>({ action: 'allow', tool: 'command', pattern: '', project: '*' })
  const save = (next: ApprovalRule[]): void => patch({ approvals: { ...a, rules: next } })
  const add = (): void => {
    const pattern = draft.pattern.trim()
    if (!pattern) return
    save([...rules, { id: Math.random().toString(36).slice(2, 10), action: draft.action, agent: '*', project: draft.project, tool: draft.tool, pattern, createdAt: Date.now() }])
    setDraft({ ...draft, pattern: '' })
  }
  const projects = s.recentProjects
  return (
    <Group
      title={tr('Your rules')}
      foot={tr('Kumo answers matching requests for you, before they reach the island. Use * as a wildcard - for example npm test* or git push --force*. Deny rules always win.')}
    >
      {rules.length === 0 && <div className="rules-empty">{tr('No rules yet. Add one below, or pick “Always allow / deny” on a request.')}</div>}
      {rules.map((r) => (
        <div key={r.id} className="rule-row">
          <span className={`rule-action rule-${r.action}`}>{r.action === 'allow' ? tr('Allow') : tr('Deny')}</span>
          <span className="rule-tool">{r.tool === 'command' ? tr('Command') : r.tool === '*' ? tr('Anything') : r.tool}</span>
          <code className="rule-pattern mono">{r.pattern}</code>
          <span className="rule-scope">{r.project === '*' ? tr('All projects') : baseName(r.project)}</span>
          <button type="button" className="rule-x" title={tr('Remove rule')} onClick={() => save(rules.filter((x) => x.id !== r.id))}>
            <Icon name="close" size={12} />
          </button>
        </div>
      ))}
      <form
        className="rule-add"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Seg
          value={draft.action}
          onChange={(v) => setDraft({ ...draft, action: v })}
          options={[
            { value: 'allow', label: tr('Allow') },
            { value: 'deny', label: tr('Deny') },
          ]}
        />
        <Select
          value={draft.tool}
          onChange={(v) => setDraft({ ...draft, tool: v })}
          options={[
            { value: 'command', label: tr('Command') },
            { value: 'Edit', label: tr('Edit file') },
            { value: 'Write', label: tr('Write file') },
            { value: 'WebFetch', label: tr('Web fetch') },
            { value: '*', label: tr('Anything') },
          ]}
        />
        <input className="field-input" placeholder={draft.tool === 'command' ? tr('npm test*') : draft.tool === 'WebFetch' ? 'https://docs.*' : tr('*.md')} value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} spellCheck={false} />
        <Select value={draft.project} onChange={(v) => setDraft({ ...draft, project: v })} options={[{ value: '*', label: tr('All projects') }, ...projects.map((p) => ({ value: p, label: baseName(p) }))]} />
        <Btn kind="primary" disabled={!draft.pattern.trim()}>{tr('Add')}</Btn>
      </form>
    </Group>
  )
}

const BY_LABEL: Record<DecisionRecord['by'], string> = { you: tr('You'), rule: tr('Rule'), session: tr('Session'), timeout: tr('Timed out'), agent: tr('In the agent'), stop: tr('Stopped') }

function DecisionHistory() {
  const [list, setList] = useState<DecisionRecord[] | null>(null)
  const [project, setProject] = useState('*')
  const [query, setQuery] = useState('')
  const load = (): void => {
    void window.kumo.decisions().then(setList)
  }
  useEffect(load, [])
  const projects = [...new Set((list || []).map((d) => d.project))].sort()
  const q = query.trim().toLowerCase()
  const shown = (list || []).filter((d) => (project === '*' || d.project === project) && (!q || d.subject.toLowerCase().includes(q) || d.title.toLowerCase().includes(q))).slice(0, 150)
  return (
    <Group title={tr('History')} foot={tr('Every request Kumo handled - who decided and how. Kept on this computer, for as long as your history setting in Privacy allows.')}>
      <div className="hist-tools">
        <input className="field-input" placeholder={tr('Search commands and files')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={project} onChange={setProject} options={[{ value: '*', label: tr('All projects') }, ...projects.map((p) => ({ value: p, label: p }))]} />
        <Btn kind="ghost" icon="refresh" onClick={load}>{tr('Refresh')}</Btn>
        <Btn kind="ghost" icon="trash" onClick={() => void window.kumo.clearDecisions().then(load)} disabled={!list?.length}>{tr('Clear')}</Btn>
      </div>
      {!list ? null : shown.length === 0 ? (
        <div className="rules-empty">{list.length ? tr('Nothing matches.') : tr('No decisions yet.')}</div>
      ) : (
        <div className="hist-list">
          {shown.map((d) => (
            <div key={d.id} className="hist-row" title={d.subject}>
              <span className={`hist-dot ${d.behavior === 'allow' ? 'ok' : d.behavior === 'deny' ? 'no' : 'none'}`} />
              <span className="hist-main">
                <span className="hist-title">
                  {d.behavior === 'allow' ? tr('Allowed') : d.behavior === 'deny' ? tr('Denied') : tr('Not answered')} · {d.title}
                </span>
                <code className="hist-subject mono">{d.subject}</code>
              </span>
              <span className="hist-meta">
                <span>{d.project}</span>
                <span>
                  {BY_LABEL[d.by]} · {ago(d.at)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </Group>
  )
}

const KEYED = ['anthropic', 'openai', 'google', 'openrouter', 'mistral', 'deepseek', 'groq', 'xai', 'together']

function ProviderRow({ p, onChange }: { p: ProviderInfo; onChange: () => void }) {
  const [key, setKey] = useState('')
  const [err, setErr] = useState('')
  const save = async (): Promise<void> => {
    const r = await window.kumo.setSecret(p.id, key)
    if (r.ok) {
      setKey('')
      setErr('')
      onChange()
    } else setErr(r.error || tr('Could not save'))
  }
  return (
    <div className="prov-row">
      <div className="prov-head">
        <ProviderLogo provider={p.id} size={16} />
        <span className="prov-name">{p.name}</span>
        {p.local && <span className="prov-tag">{tr('Local')}</span>}
        <span className={`prov-state${p.available ? ' ok' : ''}`}>{KEYED.includes(p.id) ? (p.hasKey ? tr('Key saved in your keychain') : tr('No key yet')) : p.id === 'custom' ? (p.available ? tr('Ready') : tr('Add a base URL above')) : p.detail}</span>
      </div>
      {KEYED.includes(p.id) && (
        <div className="prov-key">
          <input className="field-input" type="password" placeholder={p.hasKey ? tr('•••••••••••• saved - paste to replace') : tr('Paste API key')} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          <Btn kind="secondary" onClick={() => void save()} disabled={!key.trim()}>{tr('Save')}</Btn>
          {p.hasKey && (
            <Btn
              kind="ghost"
              onClick={() =>
                void window.kumo.setSecret(p.id, '').then(() => {
                  onChange()
                })
              }
            >{tr('Remove')}</Btn>
          )}
        </div>
      )}
      {err && <div className="dialog-error">{err}</div>}
    </div>
  )
}

function Chat({ s, patch }: { s: Settings; patch: Patch }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const load = (): void => {
    void window.kumo.providers().then(setProviders)
  }
  useEffect(load, [s.chat.ollamaUrl, s.chat.lmstudioUrl, s.chat.customUrl])
  const c = s.chat
  const set = (p: Partial<Settings['chat']>): void => patch({ chat: { ...c, ...p } })
  const [custom, setCustom] = useState({ url: c.customUrl, name: c.customName })
  const byId = (id: string): ProviderInfo | undefined => providers.find((p) => p.id === id)
  return (
    <>
      <Group title={tr('On this computer')} foot={tr('Local models never leave your machine. Claude Code uses the sign-in you already have.')}>
        {['claude-cli', 'ollama', 'lmstudio'].map((id) => {
          const p = byId(id)
          return p ? <ProviderRow key={id} p={p} onChange={load} /> : null
        })}
        <Row title={tr('Ollama address')}>
          <input className="field-input short" value={c.ollamaUrl} onChange={(e) => set({ ollamaUrl: e.target.value })} spellCheck={false} />
        </Row>
        <Row title={tr('LM Studio address')}>
          <input className="field-input short" value={c.lmstudioUrl} onChange={(e) => set({ lmstudioUrl: e.target.value })} spellCheck={false} />
        </Row>
      </Group>
      <Group title={tr('With your own key')} foot={tr('Keys are sealed in your system keychain and only sent to their provider.')}>
        {KEYED.map((id) => {
          const p = byId(id)
          return p ? <ProviderRow key={id} p={p} onChange={load} /> : null
        })}
      </Group>
      <Group title={tr('Any OpenAI-compatible endpoint')}>
        <Row title={tr('Name')}>
          <input className="field-input short" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} onBlur={() => set({ customName: custom.name })} />
        </Row>
        <Row title={tr('Base URL')} desc={tr('For example http://localhost:8000/v1')}>
          <input className="field-input short" value={custom.url} onChange={(e) => setCustom({ ...custom, url: e.target.value })} onBlur={() => set({ customUrl: custom.url.trim() })} spellCheck={false} />
        </Row>
        {byId('custom') && <ProviderRow p={{ ...byId('custom')!, id: 'custom' }} onChange={load} />}
      </Group>
      <Group title={tr('Context')}>
        <Row title={tr('Include session context')} desc={tr('When a chat is linked to a session, Kumo shares its project, task, recent steps and changed files with the model.')}>
          <Toggle label={tr('Session context')} on={c.includeContext} onChange={(v) => set({ includeContext: v })} />
        </Row>
      </Group>
    </>
  )
}

function Privacy({ s, patch, flash }: { s: Settings; patch: Patch; flash: (m: string) => void }) {
  const p = s.privacy
  const set = (x: Partial<Settings['privacy']>): void => patch({ privacy: { ...p, ...x } })
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <div className="privacy-hero">
        <Icon name="shield" size={20} />
        <div>
          <div className="row-title">{tr('Everything stays on this computer.')}</div>
          <div className="row-desc">{tr('No account, no telemetry, no cloud. Kumo only talks to the AI provider you choose for chat, and only when you send a message.')}</div>
        </div>
      </div>
      <Group title={tr('History')}>
        <Row title={tr('Keep chat history')} desc={tr('Conversations are saved locally so you can return to them.')}>
          <Toggle label={tr('Keep chats')} on={p.keepChats} onChange={(v) => set({ keepChats: v })} />
        </Row>
        <Row title={tr('Keep for')}>
          <Select
            value={p.historyDays}
            onChange={(v) => set({ historyDays: v })}
            options={[
              { value: 1, label: tr('1 day') },
              { value: 7, label: tr('1 week') },
              { value: 14, label: tr('2 weeks') },
              { value: 30, label: tr('1 month') },
              { value: 365, label: tr('1 year') },
            ]}
          />
        </Row>
        <Row title={tr('Notice the window you came from')} desc={tr('Lets Kumo offer to capture it as context and take you back to it. The title is only read when you open Kumo.')}>
          <Toggle label={tr('Window context')} on={p.windowContext} onChange={(v) => set({ windowContext: v })} />
        </Row>
      </Group>
      <Group title={tr('Your data')}>
        <Row title={tr('Data folder')} desc={tr('Settings, chats and captured context.')}>
          <Btn kind="secondary" icon="folder" onClick={() => void window.kumo.openDataFolder()}>{tr('Show')}</Btn>
        </Row>
        <Row title={tr('Erase chats and context')} desc={tr('Removes saved conversations, captures and the context tray.')}>
          {confirm ? (
            <div className="confirm">
              <Btn kind="ghost" onClick={() => setConfirm(false)}>{tr('Cancel')}</Btn>
              <Btn
                kind="danger"
                onClick={() =>
                  void window.kumo.clearHistory().then(() => {
                    setConfirm(false)
                    flash(tr('Chats and context erased'))
                  })
                }
              >{tr('Erase')}</Btn>
            </div>
          ) : (
            <Btn kind="secondary" onClick={() => setConfirm(true)}>{tr('Erase…')}</Btn>
          )}
        </Row>
      </Group>
    </>
  )
}

function Updates({ s, patch }: { s: Settings; patch: Patch }) {
  const snap = useSnapshot()
  const u = snap?.update
  if (!u) return null
  if (u.status === 'unsupported') return <div className="about-update muted">{tr('Updates are checked in installed builds.')}</div>
  const line =
    u.status === 'checking'
      ? tr('Checking for updates…')
      : u.status === 'available'
        ? tr('Kumo {0} is available.', u.version)
        : u.status === 'downloading'
          ? tr('Downloading Kumo {0}… {1}%', u.version, u.progress ?? 0)
          : u.status === 'ready'
            ? tr('Kumo {0} is ready to install.', u.version)
            : u.status === 'latest'
              ? tr('Kumo is up to date.')
              : u.status === 'error'
                ? tr('Couldn\'t check for updates: {0}', u.error || 'unknown error')
                : ''
  return (
    <div className="about-update">
      {line && <div className="about-update-line">{line}</div>}
      <div className="about-update-actions">
        {u.status === 'ready' ? (
          <Btn kind="primary" onClick={() => void window.kumo.installUpdate()}>{tr('Restart to update')}</Btn>
        ) : u.status === 'available' ? (
          <Btn kind="primary" onClick={() => void window.kumo.installUpdate()}>
            {u.manual ? tr('Download') : tr('Update')}
          </Btn>
        ) : (
          <Btn kind="secondary" disabled={u.status === 'checking' || u.status === 'downloading'} onClick={() => void window.kumo.checkUpdates()}>{tr('Check for updates')}</Btn>
        )}
      </div>
      <label className="about-update-auto">
        <Toggle label={tr('Check automatically')} on={s.updates.auto} onChange={(v) => patch({ updates: { auto: v } })} />
        <span>{isMac ? tr('Check for updates automatically') : tr('Download updates automatically')}</span>
      </label>
    </div>
  )
}

function About({ theme, s, patch }: { theme: 'light' | 'dark'; s: Settings; patch: Patch }) {
  const snap = useSnapshot()
  const [mood, setMood] = useState<'idle' | 'success'>('idle')
  return (
    <div className="about">
      <button className="about-char" onClick={() => {
        setMood('success')
        setTimeout(() => setMood('idle'), 2400)
      }} aria-label={tr('Say hi')}>
        <Kumo size={96} mood={mood} palette={{ body: theme === 'dark' ? '#f4f4f6' : '#1d1d1f', eye: theme === 'dark' ? '#202022' : '#f6f6f8', accent: '#ffb547' }} />
      </button>
      <div className="about-name">{tr('Kumo')}</div>
      <div className="about-version">{tr('Version {0}', snap?.version)}</div>
      <div className="about-line">{tr('A quiet companion for your AI coding agents.')}</div>
      <Updates s={s} patch={patch} />
      <div className="about-actions">
        <Btn kind="ghost" onClick={() => window.kumo.quit()}>{tr('Quit Kumo')}</Btn>
      </div>
    </div>
  )
}

export function SettingsApp() {
  const theme = useTheme()
  const s = useSettings()
  const [section, setSection] = useState<SettingsSection>(() => (location.hash.slice(1) as SettingsSection) || 'general')
  const [toast, setToast] = useState('')
  useEffect(() => window.kumo.onSection(setSection), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(t)
  }, [toast])
  const patch = useMemo<Patch>(() => (p) => void window.kumo.setSettings(p), [])
  if (!s) return null
  const label = SECTIONS.find((x) => x.id === section)?.label
  return (
    <div className="settings">
      <aside className="sidebar">
        <div className="drag" />
        <nav>
          {SECTIONS.map((x) => (
            <button key={x.id} className={`nav-item${section === x.id ? ' on' : ''}`} onClick={() => setSection(x.id)}>
              <Icon name={x.icon} size={15} />
              <span>{x.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="content">
        <div className="drag content-drag" />
        <h1 className="content-title">{label}</h1>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={section} className="content-body" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.08 } }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}>
            {section === 'general' && <General s={s} patch={patch} />}
            {section === 'appearance' && <Appearance s={s} patch={patch} theme={theme} />}
            {section === 'agents' && <Agents s={s} patch={patch} flash={setToast} />}
            {section === 'approvals' && <Approvals s={s} patch={patch} />}
            {section === 'chat' && <Chat s={s} patch={patch} />}
            {section === 'privacy' && <Privacy s={s} patch={patch} flash={setToast} />}
            {section === 'about' && <About theme={theme} s={s} patch={patch} />}
          </motion.div>
        </AnimatePresence>
      </main>
      <AnimatePresence>
        {toast && (
          <motion.div className="stoast" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ type: 'spring', stiffness: 500, damping: 36 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
