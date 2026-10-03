import type { RefObject } from 'react'
import type { KumoHandle } from '../../shared/Kumo'
import { Icon } from '../../shared/icons'
import { useIsland } from '../store'
import { Button } from '../ui'

export function Welcome({ kumoRef }: { kumoRef: RefObject<KumoHandle | null> }) {
  const snap = useIsland((s) => s.snap)
  const open = useIsland((s) => s.open)
  const finish = (): void => {
    void window.kumo.setSettings({ onboarded: true })
    open('home', { reset: true })
  }
  const integrations = (snap?.integrations ?? []).filter((i) => i.state !== 'unavailable' || i.id === 'claude-code' || i.id === 'antigravity')
  return (
    <div className="welcome" onMouseEnter={() => kumoRef.current?.nudge()}>
      <div className="welcome-title">Hi, I’m Kumo.</div>
      <div className="welcome-body">I sit up here and keep an eye on your coding agents - what they’re doing, when they need you, and what changed. Everything stays on this computer.</div>
      <div className="welcome-list">
        {integrations.map((i) => (
          <div key={i.id} className="welcome-row">
            <span className={`dot dot-sm ${i.state === 'connected' ? 'tone-green' : i.state === 'unavailable' ? 'tone-muted' : 'tone-amber'}`} />
            <span className="welcome-name">{i.name}</span>
            <span className="welcome-state">
              {i.state === 'connected'
                ? 'Connected'
                : i.state === 'unavailable'
                  ? 'Not installed'
                  : [i.installed.desktop && 'Desktop app', i.installed.cli && 'CLI'].filter(Boolean).join(' + ') + ' found'}
            </span>
            {i.state !== 'connected' && i.state !== 'unavailable' && (
              <button className="link" onClick={() => window.kumo.openSettings('agents')}>
                Connect
                <Icon name="forward" size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="welcome-tips">
        <span>
          <kbd>{window.kumo.platform === 'darwin' ? '⌘⌥K' : 'Ctrl+Alt+K'}</kbd> opens me from anywhere
        </span>
        <span>Drop files on me to give your agents context</span>
      </div>
      <div className="welcome-actions">
        <Button onClick={() => window.kumo.openSettings('agents')}>Open settings</Button>
        <Button kind="primary" onClick={finish} autoFocus>
          Get started
        </Button>
      </div>
    </div>
  )
}
