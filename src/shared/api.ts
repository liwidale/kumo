import type {
  ActiveWindow,
  ChatEvent,
  ChatSendRequest,
  ContextItem,
  Conversation,
  DayStats,
  DecisionRecord,
  ConversationSummary,
  Decision,
  DisplayInfo,
  GitInfo,
  HookPreview,
  InstalledAgents,
  IntegrationStatus,
  LaunchRequest,
  McpClientStatus,
  ModelInfo,
  ProviderInfo,
  Result,
  Settings,
  SettingsSection,
  Snapshot,
  UpdateState,
} from './types'

export interface AgentNoteEvent {
  agent: string
  agentName: string
  project: string
  title: string
  text: string
  sessionKey?: string
}

export type AlertKind = 'approval' | 'done' | 'error' | 'question' | 'waiting' | 'resolved' | 'ask' | 'message'

export interface PointerInfo {
  x: number
  y: number
  inside: boolean
  gx: number
  gy: number
}

export interface IslandCommand {
  type: 'toggle' | 'expand' | 'collapse' | 'chat' | 'new-session' | 'focus-approval' | 'decide' | 'goodbye'
  behavior?: 'allow' | 'deny'
}

export interface KumoApi {
  platform: 'darwin' | 'win32' | 'linux'
  snapshot(): Promise<Snapshot>
  onSnapshot(cb: (s: Snapshot) => void): () => void
  settings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  onSettings(cb: (s: Settings) => void): () => void
  theme(): Promise<'light' | 'dark'>
  onTheme(cb: (t: 'light' | 'dark') => void): () => void

  display(): Promise<DisplayInfo>
  onDisplay(cb: (d: DisplayInfo) => void): () => void
  onPointer(cb: (p: PointerInfo) => void): () => void
  onCommand(cb: (c: IslandCommand) => void): () => void
  onAlert(cb: (a: { kind: AlertKind; sessionKey: string; note?: AgentNoteEvent }) => void): () => void
  setHitRect(r: { x: number; y: number; w: number; h: number } | null): void
  setFocusable(focus: boolean): void
  setExpanded(expanded: boolean): void
  setCompact(compact: boolean): void
  goodbyeDone(): void
  activeWindow(): Promise<ActiveWindow | null>
  returnToWindow(): Promise<Result>

  decide(d: Decision): Promise<Result>
  jump(sessionKey: string): Promise<Result>
  dismiss(sessionKey: string): Promise<void>
  openFolder(path: string): Promise<Result>
  openInEditor(path: string, cwd?: string): Promise<Result>
  git(cwd: string): Promise<GitInfo>
  gitDiff(cwd: string, path: string): Promise<Result<string>>
  launch(req: LaunchRequest): Promise<Result<string>>
  pickFolder(): Promise<string | null>
  pickFiles(): Promise<ContextItem[]>

  queueMessage(sessionKey: string, text: string): Promise<Result>
  unqueueMessage(sessionKey: string, index: number): Promise<void>
  stopSession(sessionKey: string, force?: boolean): Promise<Result>
  revertFile(cwd: string, path: string): Promise<Result>
  decisions(): Promise<DecisionRecord[]>
  clearDecisions(): Promise<void>
  days(): Promise<DayStats[]>

  pathForFile(file: File): string
  addContext(paths: string[], chat?: boolean): Promise<ContextItem[]>
  pasteContext(chat?: boolean): Promise<ContextItem[]>
  addText(text: string): Promise<ContextItem>
  captureWindow(): Promise<Result<ContextItem>>
  removeContext(id: string): Promise<void>
  clearContext(): Promise<void>
  bindContext(ids: string[], sessionKey: string | null): Promise<Result>
  copyText(text: string): Promise<void>

  providers(): Promise<ProviderInfo[]>
  models(provider: string): Promise<Result<ModelInfo[]>>
  conversations(): Promise<ConversationSummary[]>
  conversation(id: string): Promise<Conversation | null>
  deleteConversation(id: string): Promise<void>
  send(req: ChatSendRequest): Promise<Result<string>>
  stop(conversationId: string): Promise<void>
  onChat(cb: (e: ChatEvent) => void): () => void

  integrations(): Promise<IntegrationStatus[]>
  previewHooks(id: HookPreview['integration'], install: boolean): Promise<Result<HookPreview>>
  applyHooks(id: HookPreview['integration'], install: boolean, fingerprint: string): Promise<Result<string>>
  mcpStatus(): Promise<McpClientStatus[]>
  answerAsk(id: string, text: string | null): Promise<Result>
  checkUpdates(): Promise<UpdateState>
  installUpdate(): Promise<void>
  refreshAgents(): Promise<InstalledAgents>
  hideLauncher(): void
  setLauncherHeight(h: number): void
  onLauncher(cb: (e: 'show' | 'hide') => void): () => void
  setSecret(provider: string, key: string): Promise<Result>
  hasSecret(provider: string): Promise<boolean>
  relayCommand(agent: string): Promise<string>

  displays(): Promise<{ id: string; label: string; primary: boolean }[]>
  openSettings(section?: SettingsSection): void
  onSection(cb: (s: SettingsSection) => void): () => void
  openExternal(url: string): Promise<void>
  openDataFolder(): Promise<void>
  clearHistory(): Promise<void>
  quit(): void
  playTestSound(): void
}

declare global {
  interface Window {
    kumo: KumoApi
  }
}
