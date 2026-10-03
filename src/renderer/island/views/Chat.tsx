import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ActiveWindow, ChatAttachment, ContextItem, Conversation } from '../../../shared/types'
import { ago, liveSessions } from '../../shared/format'
import { Icon, type IconName } from '../../shared/icons'
import { ProviderLogo } from '../../shared/logos'
import { Markdown } from '../../shared/Markdown'
import { play } from '../../shared/sound'
import { patchMessage, useChat, useIsland } from '../store'
import { Button, EmptyState, IconButton, Menu } from '../ui'

const PREFERRED = ['claude-cli', 'ollama', 'lmstudio', 'anthropic', 'openai', 'google', 'openrouter', 'mistral', 'deepseek', 'groq', 'xai', 'together', 'custom']

function kindIcon(k: ContextItem['kind']): IconName {
  return k === 'image' ? 'image' : k === 'window' ? 'window' : k === 'folder' ? 'folder' : k === 'text' ? 'text' : 'file'
}

async function ensureProviders(): Promise<void> {
  const c = useChat.getState()
  const settings = useIsland.getState().settings
  const providers = await window.kumo.providers()
  let provider = c.provider
  if (!provider || !providers.find((p) => p.id === provider)?.available) {
    const saved = settings?.chat.provider
    provider = (saved && providers.find((p) => p.id === saved && p.available)?.id) || PREFERRED.find((id) => providers.find((p) => p.id === id)?.available) || ''
  }
  useChat.getState().set({ providers, provider })
  if (provider) await ensureModels(provider)
}

async function ensureModels(provider: string): Promise<void> {
  const r = await window.kumo.models(provider)
  const list = r.ok && r.value ? r.value : []
  const c = useChat.getState()
  const saved = useIsland.getState().settings?.chat
  let model = c.provider === provider && c.model && list.some((m) => m.id === c.model) ? c.model : ''
  if (!model && saved?.provider === provider && saved.model && list.some((m) => m.id === saved.model)) model = saved.model
  if (!model) model = list.find((m) => /sonnet|flash|mini/i.test(m.id))?.id || list[0]?.id || ''
  useChat.getState().set({ models: { ...c.models, [provider]: list }, provider, model })
}

function Message({ m, onRetry }: { m: Conversation['messages'][number]; onRetry?: () => void }) {
  if (m.role === 'user')
    return (
      <div className="msg msg-user">
        {m.attachments?.length ? (
          <div className="msg-atts">
            {m.attachments.map((a) =>
              a.thumb ? (
                <img key={a.id} className="msg-image" src={a.thumb} alt={a.name} title={`${a.name} - click to open`} onClick={() => a.path && void window.kumo.openFolder(a.path)} />
              ) : (
                <span key={a.id} className="chip static small">
                  <Icon name={kindIcon(a.kind)} size={12} />
                  <span className="chip-name">{a.name}</span>
                </span>
              ),
            )}
          </div>
        ) : null}
        {m.text && <div className="bubble selectable">{m.text}</div>}
      </div>
    )
  return (
    <div className="msg msg-assistant">
      {m.text ? <Markdown text={m.text} streaming={m.streaming} /> : m.streaming ? <div className="thinking-dots"><i /><i /><i /></div> : null}
      {m.error && (
        <div className="msg-error">
          <Icon name="alert" size={13} />
          <span>{m.error}</span>
          {onRetry && (
            <button className="link" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}
      {!m.streaming && m.text && !m.error && (
        <div className="msg-tools">
          <button className="icon-btn tiny" title="Copy" onClick={() => void window.kumo.copyText(m.text)}>
            <Icon name="copy" size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

export function Chat() {
  const c = useChat()
  const snap = useIsland((s) => s.snap)
  const settings = useIsland((s) => s.settings)
  const toast = useIsland((s) => s.showToast)
  const setIsland = useIsland((s) => s.set)
  const chatDrag = useIsland((s) => s.chatDrag)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const [activeWin, setActiveWin] = useState<ActiveWindow | null>(null)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    void ensureProviders()
    void window.kumo.conversations().then((list) => useChat.getState().set({ conversations: list }))
    void window.kumo.activeWindow().then(setActiveWin)
    setTimeout(() => inputRef.current?.focus(), 120)
  }, [])

  useEffect(() => {
    return window.kumo.onChat((e) => {
      const st = useChat.getState()
      if (e.type === 'start') {
        const base = st.current && st.current.id === e.conversationId ? st.current : { id: e.conversationId, title: e.userMessage.text.slice(0, 48) || 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [], sessionKey: st.sessionKey || undefined }
        st.set({
          current: { ...base, messages: [...base.messages, e.userMessage, { id: e.assistantId, role: 'assistant', text: '', at: Date.now(), streaming: true }] },
          streaming: true,
        })
        return
      }
      if (!st.current || st.current.id !== e.conversationId) return
      if (e.type === 'delta') st.set({ current: patchMessage(st.current, e.assistantId, (m) => ({ ...m, text: m.text + e.text })) })
      else if (e.type === 'done') {
        st.set({ current: patchMessage(st.current, e.assistantId, (m) => ({ ...m, streaming: false })), streaming: false })
        void window.kumo.conversations().then((list) => useChat.getState().set({ conversations: list }))
      } else if (e.type === 'error') {
        st.set({ current: patchMessage(st.current, e.assistantId, (m) => ({ ...m, streaming: false, error: e.error })), streaming: false })
      }
    })
  }, [])

  useLayoutEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [c.current])

  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(140, el.scrollHeight)}px`
  }, [c.draft])

  const provider = c.providers.find((p) => p.id === c.provider)
  const models = c.models[c.provider] || []
  const model = models.find((m) => m.id === c.model)
  const attachments = (snap?.context || []).filter((i) => c.attachments.includes(i.id))
  const tray = (snap?.context || []).filter((i) => !c.attachments.includes(i.id) && !i.sessionKey && !i.chat)
  const session = c.sessionKey ? snap?.sessions.find((s) => s.key === c.sessionKey) : undefined
  const live = liveSessions(snap)

  const send = async (text = c.draft): Promise<void> => {
    if (c.streaming) return
    if (!provider?.available) {
      toast('Set up a model provider first', 'error')
      return
    }
    if (!text.trim() && !attachments.length) return
    const atts: ChatAttachment[] = attachments.map((a) => ({ id: a.id, kind: a.kind, name: a.name, path: a.path, mime: a.mime, thumb: a.thumb }))
    c.set({ draft: '', attachments: [] })
    stick.current = true
    play('send')
    const r = await window.kumo.send({ conversationId: c.current?.id, text, attachments: atts, sessionKey: c.sessionKey || undefined, provider: c.provider, model: c.model })
    if (!r.ok) {
      toast(r.error || 'Could not send', 'error')
      c.set({ draft: text })
    }
    void window.kumo.setSettings({ chat: { ...(settings?.chat ?? ({} as never)), provider: c.provider, model: c.model } })
  }

  const retry = (): void => {
    const lastUser = [...(c.current?.messages || [])].reverse().find((m) => m.role === 'user')
    if (lastUser) void send(lastUser.text)
  }

  const capture = async (): Promise<void> => {
    setCapturing(true)
    const r = await window.kumo.captureWindow()
    setCapturing(false)
    if (r.ok && r.value) c.set({ attachments: [...useChat.getState().attachments, r.value.id] })
    else toast(r.error || 'Capture failed', 'error')
  }

  const pickFiles = async (): Promise<void> => {
    setIsland({ dialogOpen: true })
    const items = await window.kumo.pickFiles()
    setIsland({ dialogOpen: false })
    if (items.length) c.set({ attachments: [...useChat.getState().attachments, ...items.map((i) => i.id)] })
  }

  const newChat = (): void => {
    if (c.streaming && c.current) void window.kumo.stop(c.current.id)
    c.set({ current: null, draft: '', streaming: false, showHistory: false })
    inputRef.current?.focus()
  }

  const messages = c.current?.messages || []
  const noProvider = c.providers.length > 0 && !c.providers.some((p) => p.available)

  const suggestions: string[] = session
    ? [`What is ${session.project} doing right now?`, 'Summarize the changes so far', 'What should I check before merging?']
    : live.length
      ? ['Summarize what my agents are doing', 'Which session needs me first?']
      : ['Explain a concept in plain words', 'Review a snippet I paste']

  return (
    <div className="chat">
      <AnimatePresence>
        {chatDrag && (
          <motion.div className="chat-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={{ duration: 0.16 }}>
            <Icon name="image" size={18} />
            <span>Drop to attach to this chat</span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="chat-bar">
        {c.showHistory ? (
          <>
            <IconButton icon="back" title="Back" onClick={() => c.set({ showHistory: false })} />
            <span className="chat-title">History</span>
          </>
        ) : (
          <>
            <IconButton icon="history" title="History" onClick={() => c.set({ showHistory: true })} />
            <span className="chat-title">{c.current?.title || 'New chat'}</span>
          </>
        )}
        <span className="spacer" />
        {session && !c.showHistory && (
          <span className="chip session-chip" title={session.cwd}>
            <Icon name="link" size={12} />
            <span className="chip-name">{session.project}</span>
            <button className="chip-x" title="Unlink session" onClick={() => c.set({ sessionKey: null })}>
              <Icon name="close" size={10} />
            </button>
          </span>
        )}
        {!session && live.length > 0 && !c.showHistory && (
          <Menu
            align="right"
            trigger={(_o, toggle) => (
              <button className="chip ghost" onClick={toggle} title="Give the chat a session's context">
                <Icon name="link" size={12} />
                <span>Session</span>
              </button>
            )}
            items={live.map((s) => ({ label: s.project, hint: s.phase, onClick: () => c.set({ sessionKey: s.key }) }))}
          />
        )}
        <IconButton icon="plus" title="New chat" onClick={newChat} />
      </div>

      {c.showHistory ? (
        <div className="history scroll">
          {c.conversations.length === 0 ? (
            <div className="muted-note">No saved chats{settings?.privacy.keepChats ? '' : ' - history is turned off in Settings'}.</div>
          ) : (
            c.conversations.map((h) => (
              <div key={h.id} className={`history-row${c.current?.id === h.id ? ' on' : ''}`}>
                <button
                  className="history-open"
                  onClick={() =>
                    void window.kumo.conversation(h.id).then((conv) => {
                      c.set({ current: conv, showHistory: false, sessionKey: conv?.sessionKey || null })
                    })
                  }
                >
                  <span className="history-title">{h.title}</span>
                  <span className="history-meta">{ago(h.updatedAt)}</span>
                </button>
                <button
                  className="icon-btn tiny"
                  title="Delete"
                  onClick={() =>
                    void window.kumo.deleteConversation(h.id).then(async () => {
                      if (c.current?.id === h.id) c.set({ current: null })
                      c.set({ conversations: await window.kumo.conversations() })
                    })
                  }
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      ) : noProvider ? (
        <EmptyState title="Choose how Kumo thinks" body="Use Claude Code's sign-in, a local model (Ollama, LM Studio), or your own API key. Nothing is sent anywhere until you pick one.">
          <Button kind="primary" icon="gear" onClick={() => window.kumo.openSettings('chat')}>
            Set up chat
          </Button>
          <Button icon="refresh" onClick={() => void ensureProviders()}>
            Check again
          </Button>
        </EmptyState>
      ) : (
        <div
          className="messages scroll"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
        >
          {messages.length === 0 ? (
            <div className="chat-empty">
              <div className="chat-empty-title">{session ? `Ask about ${session.project}` : 'Ask anything'}</div>
              <div className="suggestions">
                {suggestions.map((sg) => (
                  <button key={sg} className="suggestion" onClick={() => void send(sg)}>
                    {sg}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => <Message key={m.id} m={m} onRetry={i === messages.length - 1 ? retry : undefined} />)
          )}
        </div>
      )}

      {!c.showHistory && !noProvider && (
        <div className="composer">
          <AnimatePresence initial={false}>
            {(attachments.length > 0 || (activeWin && !attachments.some((a) => a.kind === 'window'))) && (
              <motion.div className="composer-atts" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                {attachments.map((a) =>
                  a.thumb ? (
                    <span key={a.id} className={`att-tile${a.missing ? ' missing' : ''}`} title={a.name}>
                      <img src={a.thumb} alt={a.name} onClick={() => a.path && void window.kumo.openFolder(a.path)} />
                      <button className="tile-x" title="Remove" aria-label={`Remove ${a.name}`} onClick={() => c.set({ attachments: c.attachments.filter((x) => x !== a.id) })}>
                        <Icon name="close" size={9} strokeWidth={2} />
                      </button>
                    </span>
                  ) : (
                    <span key={a.id} className={`chip${a.missing ? ' missing' : ''}`} title={a.path || a.name}>
                      <Icon name={kindIcon(a.kind)} size={12} />
                      <span className="chip-name">{a.name}</span>
                      <button className="chip-x" title="Remove" onClick={() => c.set({ attachments: c.attachments.filter((x) => x !== a.id) })}>
                        <Icon name="close" size={10} />
                      </button>
                    </span>
                  ),
                )}
                {activeWin && !attachments.some((a) => a.kind === 'window') && (
                  <button className="chip ghost" onClick={() => void capture()} disabled={capturing} title={`Attach a screenshot of ${activeWin.app}`}>
                    <Icon name={capturing ? 'refresh' : 'window'} size={12} />
                    <span className="chip-name">{capturing ? 'Capturing…' : `${activeWin.app}${activeWin.title ? ` - ${activeWin.title}` : ''}`}</span>
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="composer-box">
            <Menu
              up
              trigger={(_o, toggle) => <IconButton icon="clip" title="Attach" onClick={toggle} />}
              items={[
                { label: 'Choose files…', icon: 'file', onClick: () => void pickFiles() },
                { label: activeWin ? `Screenshot of ${activeWin.app}` : 'Screenshot of the screen', icon: 'window', onClick: () => void capture() },
                ...(tray.length ? (['sep', { header: 'From your context' }] as const) : []),
                ...tray.slice(0, 6).map((t) => ({ label: t.name, icon: kindIcon(t.kind), onClick: () => c.set({ attachments: [...c.attachments, t.id] }) })),
              ]}
            />
            <textarea
              ref={inputRef}
              className="composer-input"
              rows={1}
              placeholder={session ? `Ask about ${session.project}…` : 'Ask Kumo…'}
              value={c.draft}
              onChange={(e) => c.set({ draft: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
              onPaste={(e) => {
                const types = [...e.clipboardData.types]
                const hasFiles = types.includes('Files') || types.some((t) => t.startsWith('image/'))
                if (!hasFiles && e.clipboardData.getData('text/plain')) return
                e.preventDefault()
                void window.kumo.pasteContext(true).then((items) => {
                  if (items.length) c.set({ attachments: [...useChat.getState().attachments, ...items.map((i) => i.id).filter((id) => !useChat.getState().attachments.includes(id))] })
                })
              }}
            />
            <Menu
              up
              align="right"
              trigger={(_o, toggle) => (
                <button className="model-chip" onClick={toggle} title="Model">
                  {provider && <ProviderLogo provider={provider.id} size={13} />}
                  <span>{provider ? `${provider.name}${model ? ` · ${model.name}` : ''}` : 'Choose model'}</span>
                  <Icon name="down" size={11} />
                </button>
              )}
              items={[
                { header: 'Provider' },
                ...c.providers
                  .filter((p) => p.available)
                  .map((p) => ({
                    label: p.name,
                    logo: <ProviderLogo provider={p.id} size={14} />,
                    hint: p.local ? 'local' : undefined,
                    checked: p.id === c.provider,
                    onClick: () => void ensureModels(p.id),
                  })),
                { label: 'More providers…', icon: 'plus' as const, onClick: () => window.kumo.openSettings('chat') },
                ...(models.length ? (['sep', { header: 'Model' }] as const) : []),
                ...models.slice(0, 14).map((m) => ({ label: m.name, checked: m.id === c.model, onClick: () => c.set({ model: m.id }) })),
              ]}
            />
            {c.streaming ? (
              <button className="send-btn stop" title="Stop" onClick={() => c.current && void window.kumo.stop(c.current.id)}>
                <Icon name="stop" size={12} />
              </button>
            ) : (
              <button className="send-btn" title="Send (Enter)" disabled={!c.draft.trim() && !attachments.length} onClick={() => void send()}>
                <Icon name="send" size={14} strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
