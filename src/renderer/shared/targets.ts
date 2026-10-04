import type { InstalledAgents, LaunchTarget } from '../../shared/types'
import { tr } from './i18n'

export interface TargetInfo {
  id: LaunchTarget
  label: string
  sub: string
  agent: string
  color: string
}

export const TARGETS: TargetInfo[] = [
  { id: 'claude-cli', label: 'Claude Code', sub: tr('In a new terminal'), agent: 'claude-code', color: '#E0865F' },
  { id: 'claude-desktop', label: 'Claude', sub: tr('Desktop app'), agent: 'claude-code', color: '#E0865F' },
  { id: 'antigravity-desktop', label: 'Antigravity', sub: tr('Desktop app'), agent: 'antigravity', color: '#8EA2FF' },
  { id: 'agy-cli', label: 'agy', sub: tr('Antigravity CLI'), agent: 'antigravity', color: '#8EA2FF' },
  { id: 'codex-cli', label: 'Codex', sub: tr('In a new terminal'), agent: 'codex', color: '#C9CDD6' },
  { id: 'gemini-cli', label: 'Gemini CLI', sub: tr('In a new terminal'), agent: 'gemini', color: '#7AA7F7' },
  { id: 'cursor', label: 'Cursor', sub: tr('Editor'), agent: 'cursor', color: '#C9CDD6' },
  { id: 'windsurf', label: 'Windsurf', sub: tr('Editor'), agent: 'windsurf', color: '#5EC4B6' },
  { id: 'copilot-cli', label: 'Copilot CLI', sub: tr('In a new terminal'), agent: 'copilot', color: '#C9CDD6' },
  { id: 'qwen-cli', label: 'Qwen Code', sub: tr('In a new terminal'), agent: 'qwen', color: '#9B8CFF' },
  { id: 'opencode-cli', label: 'OpenCode', sub: tr('In a new terminal'), agent: 'opencode', color: '#E6A15C' },
  { id: 'amp-cli', label: 'Amp', sub: tr('In a new terminal'), agent: 'amp', color: '#EB7FA7' },
  { id: 'kiro-cli', label: 'Kiro CLI', sub: tr('In a new terminal'), agent: 'kiro', color: '#B58CF0' },
  { id: 'aider-cli', label: 'Aider', sub: tr('In a new terminal'), agent: 'aider', color: '#9CCB6A' },
]

export const DIRECT: LaunchTarget[] = ['claude-cli', 'codex-cli', 'gemini-cli', 'copilot-cli', 'qwen-cli', 'opencode-cli', 'kiro-cli']

export function availability(inst: InstalledAgents | undefined): Record<LaunchTarget, boolean> {
  return {
    'claude-cli': Boolean(inst?.claudeCli),
    'claude-desktop': Boolean(inst?.claudeDesktop),
    'antigravity-desktop': Boolean(inst?.antigravityDesktop),
    'agy-cli': Boolean(inst?.agyCli),
    'codex-cli': Boolean(inst?.codexCli),
    'gemini-cli': Boolean(inst?.geminiCli),
    cursor: Boolean(inst?.cursorApp),
    windsurf: Boolean(inst?.windsurfApp),
    'copilot-cli': Boolean(inst?.copilotCli),
    'qwen-cli': Boolean(inst?.qwenCli),
    'opencode-cli': Boolean(inst?.opencodeCli),
    'amp-cli': Boolean(inst?.ampCli),
    'kiro-cli': Boolean(inst?.kiroCli),
    'aider-cli': Boolean(inst?.aiderCli),
  }
}
