import { create } from 'zustand'
import type { ChatMessage, Conversation, ConversationSummary, DisplayInfo, ModelInfo, ProviderInfo, Settings, Snapshot } from '../../shared/types'


export type Level = 'hidden' | 'idle' | 'active' | 'peek' | 'notify' | 'open'
export type View = 'home' | 'session' | 'approval' | 'chat' | 'context' | 'launch' | 'drop' | 'welcome' | 'diff' | 'today'
export type Tab = 'home' | 'chat' | 'context'
export type NotifyKind = 'done' | 'error' | 'question' | 'waiting'

export interface Toast {
  id: number
  text: string
  tone: 'neutral' | 'error' | 'success'
}

interface IslandState {
  snap: Snapshot | null
  settings: Settings | null
  display: DisplayInfo | null
  override: 'peek' | 'notify' | 'open' | null
  view: View
  history: View[]
  sessionKey: string | null
  notify: { key: string; kind: NotifyKind } | null
  pinned: boolean
  focused: boolean
  hovering: boolean
  away: boolean
  diff: { cwd: string; path: string } | null
  toast: Toast | null
  dialogOpen: boolean
  dropTarget: 'chat' | 'context'
  chatDrag: boolean
  leaving: 0 | 1 | 2 | 3 | 4

  set(p: Partial<IslandState>): void
  open(view?: View, opts?: { focus?: boolean; sessionKey?: string | null; reset?: boolean }): void
  go(view: View, sessionKey?: string | null): void
  back(): void
  collapse(): void
  showToast(text: string, tone?: Toast['tone']): void
}

let toastId = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useIsland = create<IslandState>((set, get) => ({
  snap: null,
  settings: null,
  display: null,
  override: null,
  view: 'home',
  history: [],
  sessionKey: null,
  notify: null,
  pinned: false,
  focused: false,
  hovering: false,
  away: false,
  diff: null,
  toast: null,
  dialogOpen: false,
  dropTarget: 'context',
  chatDrag: false,
  leaving: 0,

  set: (p) => set(p),

  open: (view, opts = {}) => {
    const s = get()
    const next: Partial<IslandState> = { override: 'open', notify: null }
    if (view) {
      next.view = view
      next.history = opts.reset || s.override !== 'open' ? [] : s.view !== view ? [...s.history, s.view].slice(-8) : s.history
    } else if (s.override !== 'open') {
      next.history = []
    }
    if (opts.sessionKey !== undefined) next.sessionKey = opts.sessionKey
    if (opts.focus) next.pinned = true
    set(next)
  },

  go: (view, sessionKey) => {
    const s = get()
    if (view === s.view && (sessionKey === undefined || sessionKey === s.sessionKey)) return
    set({ view, history: [...s.history, s.view].slice(-8), ...(sessionKey !== undefined ? { sessionKey } : {}) })
  },

  back: () => {
    const s = get()
    const h = [...s.history]
    let prev = h.pop()
    while (prev && (prev === 'approval' || prev === 'drop' || prev === s.view)) prev = h.pop()
    set({ view: prev || 'home', history: h })
  },

  collapse: () => set((s) => ({ override: null, pinned: false, notify: null, history: [], view: s.view === 'approval' || s.view === 'drop' ? 'home' : s.view })),

  showToast: (text, tone = 'neutral') => {
    if (toastTimer) clearTimeout(toastTimer)
    const t = { id: ++toastId, text, tone }
    set({ toast: t })
    toastTimer = setTimeout(() => {
      if (get().toast?.id === t.id) set({ toast: null })
    }, 3200)
  },
}))


interface ChatState {
  providers: ProviderInfo[]
  models: Record<string, ModelInfo[]>
  provider: string
  model: string
  conversations: ConversationSummary[]
  current: Conversation | null
  draft: string
  attachments: string[]
  sessionKey: string | null
  streaming: boolean
  showHistory: boolean
  set(p: Partial<ChatState>): void
}

export const useChat = create<ChatState>((set) => ({
  providers: [],
  models: {},
  provider: '',
  model: '',
  conversations: [],
  current: null,
  draft: '',
  attachments: [],
  sessionKey: null,
  streaming: false,
  showHistory: false,
  set: (p) => set(p),
}))

export function patchMessage(c: Conversation, id: string, fn: (m: ChatMessage) => ChatMessage): Conversation {
  return { ...c, messages: c.messages.map((m) => (m.id === id ? fn(m) : m)) }
}
