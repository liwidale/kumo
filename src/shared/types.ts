
export type Platform = 'darwin' | 'win32' | 'linux'

export type Phase =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'question'
  | 'done'
  | 'error'
  | 'ended'

export type Mood = 'idle' | 'working' | 'thinking' | 'waiting' | 'success' | 'attention' | 'error' | 'sleeping'

export type StepKind = 'prompt' | 'tool' | 'error' | 'subagent' | 'notice' | 'approval' | 'done' | 'context'

export interface Step {
  id: string
  at: number
  kind: StepKind
  verb: string
  target?: string
  detail?: string
  tool?: string
  ok?: boolean
  toolUseId?: string
}

export type FileAction = 'read' | 'edit' | 'create'

export interface FileTouch {
  path: string
  action: FileAction
  at: number
  count: number
}

export type HostKind = 'desktop' | 'cli' | 'ide' | 'unknown'

export interface HostInfo {
  kind: HostKind
  app: string
  pids: number[]
  termProgram?: string
  bundleId?: string
  tty?: string
}

export interface LivePreview {
  kind: 'edit' | 'write' | 'command' | 'read' | 'search' | 'fetch' | 'other'
  path?: string
  diff?: DiffHunk[]
  content?: string
  command?: string
  added: number
  removed: number
  at: number
}

export interface PlanItem {
  text: string
  status: 'pending' | 'active' | 'done'
}

export interface SubagentInfo {
  id: string
  type: string
  description: string
  status: 'running' | 'done'
  at: number
}

export interface Session {
  key: string
  sessionId: string
  agent: string
  cwd: string
  project: string
  title?: string
  task?: string
  model?: string
  phase: Phase
  phaseSince: number
  startedAt: number
  updatedAt: number
  host: HostInfo
  current?: Step
  steps: Step[]
  files: FileTouch[]
  summary?: string
  question?: { text: string; options: string[] }
  notice?: string
  toolCount: number
  errorCount: number
  alive: boolean
  pendingContext: number
  preview?: LivePreview
  plan?: PlanItem[]
  context?: { used: number; window: number }
  subagents: SubagentInfo[]
  queued: string[]
  stopping?: boolean
  usage?: SessionUsage
}

export interface SessionUsage {
  costUsd?: number
  inTokens?: number
  outTokens?: number
}

export interface ApprovalRule {
  id: string
  action: 'allow' | 'deny'
  agent: string
  project: string
  tool: string
  pattern: string
  createdAt: number
}

export type DecisionSource = 'you' | 'rule' | 'session' | 'timeout' | 'agent' | 'stop'

export interface DecisionRecord {
  id: string
  at: number
  agent: string
  project: string
  cwd: string
  title: string
  subject: string
  kind: ApprovalKind
  risk: Risk
  behavior: Behavior | 'none'
  by: DecisionSource
}

export interface DayTask {
  at: number
  agent: string
  project: string
  task: string
  summary?: string
}

export interface DayStats {
  date: string
  sessions: number
  files: number
  projects: Record<string, number>
  tasks: DayTask[]
  allowed: number
  denied: number
  toolCalls: number
  costUsd: number
}

export type ApprovalKind = 'command' | 'edit' | 'write' | 'read' | 'fetch' | 'mcp' | 'agent' | 'other'
export type Risk = 'normal' | 'elevated' | 'high'

export interface DiffHunk {
  path: string
  before: string
  after: string
}

export interface ApprovalSuggestion {
  id: string
  label: string
}

export interface Approval {
  id: string
  sessionKey: string
  agent: string
  project: string
  createdAt: number
  expiresAt: number
  tool: string
  kind: ApprovalKind
  title: string
  subject: string
  description?: string
  cwd?: string
  diff?: DiffHunk[]
  content?: string
  risk: Risk
  riskReason?: string
  suggestions: ApprovalSuggestion[]
}

export type Behavior = 'allow' | 'deny'

export interface Decision {
  id: string
  behavior: Behavior
  remember?: string
  message?: string
}

export interface AgentDescriptor {
  id: string
  name: string
  mark: string
  color: string
  capabilities: {
    approvals: boolean
    contextInjection: boolean
    launch: boolean
  }
}

export type IntegrationState = 'connected' | 'disconnected' | 'outdated' | 'error' | 'unavailable'

export type IntegrationId = 'claude-code' | 'antigravity' | 'codex' | 'gemini' | 'cursor'

export interface IntegrationStatus {
  id: IntegrationId
  name: string
  state: IntegrationState
  detail: string
  configPath: string
  installed: { cli: boolean; desktop: boolean }
  lastEventAt?: number
  limits?: boolean
}

export interface HookPreview {
  integration: IntegrationStatus['id'] | 'claude-limits'
  install: boolean
  diff: string
  configPath: string
  backupPath: string
  fingerprint: string
}

export type ContextKind = 'file' | 'folder' | 'image' | 'window' | 'text'

export interface ContextItem {
  id: string
  kind: ContextKind
  name: string
  path?: string
  size?: number
  mime?: string
  thumb?: string
  snippet?: string
  addedAt: number
  sessionKey?: string
  delivered?: boolean
  missing?: boolean
  appName?: string
  chat?: boolean
}

export interface ActiveWindow {
  app: string
  title: string
  pid: number
  handle?: string
  windowId?: number
}

export interface GitChange {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | '?' | 'U'
  added: number
  removed: number
}

export interface GitInfo {
  ok: boolean
  error?: string
  branch?: string
  ahead?: number
  behind?: number
  changes: GitChange[]
}


export interface ProviderInfo {
  id: string
  name: string
  kind: 'anthropic' | 'openai-compatible' | 'claude-cli'
  local: boolean
  needsKey: boolean
  hasKey: boolean
  available: boolean
  detail?: string
  baseUrl?: string
}

export interface ModelInfo {
  id: string
  name: string
}

export type ChatRole = 'user' | 'assistant'

export interface ChatAttachment {
  id: string
  kind: ContextKind
  name: string
  path?: string
  mime?: string
  thumb?: string
  text?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  text: string
  at: number
  attachments?: ChatAttachment[]
  provider?: string
  model?: string
  error?: string
  streaming?: boolean
  sessionKey?: string
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
  sessionKey?: string
  remoteId?: string
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
  count: number
}

export interface ChatSendRequest {
  conversationId?: string
  text: string
  attachments: ChatAttachment[]
  sessionKey?: string
  provider: string
  model: string
}

export type ChatEvent =
  | { type: 'start'; conversationId: string; userMessage: ChatMessage; assistantId: string }
  | { type: 'delta'; conversationId: string; assistantId: string; text: string }
  | { type: 'done'; conversationId: string; assistantId: string }
  | { type: 'error'; conversationId: string; assistantId: string; error: string }


export type ThemePref = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemePref
  motion: 'full' | 'reduced'
  sounds: boolean
  volume: number
  display: 'auto' | 'primary' | string
  idle: 'character' | 'hide'
  presence: 'island' | 'tray'
  showCompletion: boolean
  autoCollapseSec: number
  awayMinutes: number
  hotkey: string
  launchAtLogin: boolean
  paused: boolean
  approvals: {
    enabled: boolean
    timeoutSec: number
    rules: ApprovalRule[]
    antigravity: boolean
    gemini: boolean
    cursor: boolean
    globalKeys: boolean
    notify: boolean
  }
  chat: {
    provider: string
    model: string
    includeContext: boolean
    ollamaUrl: string
    lmstudioUrl: string
    customUrl: string
    customName: string
  }
  privacy: {
    keepChats: boolean
    historyDays: number
    windowContext: boolean
  }
  terminal: string
  editor: string
  aliases: Record<string, string>
  recentProjects: string[]
  onboarded: boolean
  debug: boolean
  settingsVersion: number
}

export interface DisplayInfo {
  mode: 'notch' | 'floating'
  platform: Platform
  notchWidth: number
  notchHeight: number
  width: number
  height: number
  top: number
  scale: number
}

export interface InstalledAgents {
  claudeCli: boolean
  claudeDesktop: boolean
  agyCli: boolean
  antigravityDesktop: boolean
  codexCli: boolean
  geminiCli: boolean
  cursorApp: boolean
  editors: string[]
  terminals: string[]
}

export interface LimitWindow {
  kind: 'five_hour' | 'seven_day' | 'spend'
  label: string
  usedPct: number
  resetsAt?: number
}

export interface AgentLimits {
  agent: string
  windows: LimitWindow[]
  updatedAt: number
}

export interface Snapshot {
  sessions: Session[]
  approvals: Approval[]
  context: ContextItem[]
  integrations: IntegrationStatus[]
  agents: AgentDescriptor[]
  installed: InstalledAgents
  serverOk: boolean
  serverError?: string
  version: string
  limits: AgentLimits[]
}

export interface LaunchRequest {
  target: 'claude-cli' | 'claude-desktop' | 'agy-cli' | 'antigravity-desktop' | 'codex-cli' | 'gemini-cli' | 'cursor'
  cwd: string
  prompt: string
  contextIds: string[]
}

export interface Result<T = undefined> {
  ok: boolean
  error?: string
  value?: T
}

export type SettingsSection = 'general' | 'appearance' | 'agents' | 'approvals' | 'chat' | 'privacy' | 'about'
