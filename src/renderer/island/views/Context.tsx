import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import type { ActiveWindow, ContextItem } from '../../../shared/types'
import { bytes, liveSessions } from '../../shared/format'
import { Icon, type IconName } from '../../shared/icons'
import { useChat, useIsland } from '../store'
import { Button, IconButton, Menu, SectionLabel, useAction } from '../ui'

export function kindIcon(k: ContextItem['kind']): IconName {
  return k === 'image' ? 'image' : k === 'window' ? 'window' : k === 'folder' ? 'folder' : k === 'text' ? 'text' : 'file'
}

function Item({ it, sessionName }: { it: ContextItem; sessionName?: string }) {
  return (
    <div className={`ctx-item${it.missing ? ' missing' : ''}`} title={it.path || it.snippet}>
      <span className="ctx-thumb">{it.thumb ? <img src={it.thumb} alt="" /> : <Icon name={kindIcon(it.kind)} size={15} />}</span>
      <span className="ctx-main">
        <span className="ctx-name">{it.name}</span>
        <span className="ctx-meta">
          {it.missing
            ? 'File moved or deleted'
            : sessionName
              ? `${it.delivered ? 'Shared with' : 'Waiting for'} ${sessionName}`
              : [it.kind === 'window' ? it.appName || 'Window' : it.kind === 'text' ? 'Snippet' : it.kind === 'folder' ? 'Folder' : null, bytes(it.size)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <button className="icon-btn tiny" title="Remove" onClick={() => void window.kumo.removeContext(it.id)}>
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

export function Context() {
  const snap = useIsland((s) => s.snap)
  const open = useIsland((s) => s.open)
  const set = useIsland((s) => s.set)
  const toast = useIsland((s) => s.showToast)
  const setChat = useChat((s) => s.set)
  const [activeWin, setActiveWin] = useState<ActiveWindow | null>(null)
  const [note, setNote] = useState('')
  const act = useAction()
  useEffect(() => {
    void window.kumo.activeWindow().then(setActiveWin)
  }, [])
  if (!snap) return null
  const items = snap.context.filter((i) => !i.chat)
  const loose = items.filter((i) => !i.sessionKey && !i.missing)
  const bound = items.filter((i) => i.sessionKey)
  const live = liveSessions(snap).filter((s) => s.alive)
  const nameOf = (k?: string): string | undefined => snap.sessions.find((s) => s.key === k)?.project

  const pick = async (): Promise<void> => {
    set({ dialogOpen: true })
    await window.kumo.pickFiles()
    set({ dialogOpen: false })
  }

  return (
    <div className="context">
      <div className="drop-mini">
        <Icon name="inbox" size={16} />
        <span>Drop files here, or</span>
        <button className="link" onClick={() => void pick()}>
          choose files
        </button>
        {activeWin && (
          <>
            <span>·</span>
            <button className="link" onClick={() => void act(window.kumo.captureWindow(), `Captured ${activeWin.app}`)}>
              capture {activeWin.app}
            </button>
          </>
        )}
      </div>

      {items.length === 0 ? (
        <div className="muted-note center">Context you add here can go to a chat, a running session, or a new one. It stays on this computer.</div>
      ) : (
        <div className="ctx-list scroll">
          {loose.map((it) => (
            <Item key={it.id} it={it} />
          ))}
          {bound.length > 0 && <SectionLabel>Shared with sessions</SectionLabel>}
          {bound.map((it) => (
            <Item key={it.id} it={it} sessionName={nameOf(it.sessionKey)} />
          ))}
        </div>
      )}

      <form
        className="note-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (!note.trim()) return
          void window.kumo.addText(note.trim()).then(() => setNote(''))
        }}
      >
        <input className="text-input" placeholder="Add a note or paste a snippet…" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" className="icon-btn" title="Add" aria-label="Add" disabled={!note.trim()}>
          <Icon name="plus" size={16} />
        </button>
      </form>

      {loose.length > 0 && (
        <div className="ctx-actions">
          <Button
            kind="primary"
            icon="chat"
            onClick={() => {
              setChat({ attachments: loose.map((l) => l.id), current: null })
              open('chat')
            }}
          >
            Ask in chat
          </Button>
          <Menu
            up
            trigger={(_o, toggle) => (
              <Button icon="clip" onClick={toggle} disabled={!live.length} title={live.length ? 'Hand these to a running session on its next turn' : 'No running sessions'}>
                Share with session
              </Button>
            )}
            items={live.map((s) => ({
              label: s.project,
              hint: s.agent === 'antigravity' ? 'Antigravity' : 'Claude Code',
              onClick: () => void act(window.kumo.bindContext(loose.map((l) => l.id), s.key), `Will share with ${s.project} on its next turn`),
            }))}
          />
          <Button icon="plus" onClick={() => open('launch')}>
            New session
          </Button>
          <span className="spacer" />
          <IconButton
            icon="copy"
            title="Copy as @paths"
            onClick={() => {
              const paths = loose.filter((l) => l.path).map((l) => `@${l.path}`)
              void window.kumo.copyText(paths.join(' '))
              toast('Copied - paste into your agent', 'success')
            }}
          />
          <IconButton icon="trash" title="Clear" onClick={() => void window.kumo.clearContext()} />
        </div>
      )}
    </div>
  )
}

export function DropZone() {
  const toChat = useIsland((s) => s.dropTarget === 'chat')
  return (
    <div className="dropzone">
      <motion.div className="dropzone-inner" initial={{ scale: 0.97 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 22 }}>
        <motion.span animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}>
          <Icon name="inbox" size={22} />
        </motion.span>
        <div className="dropzone-title">{toChat ? 'Drop to attach to this chat' : 'Drop to add context'}</div>
        <div className="dropzone-body">{toChat ? 'Images and files go with your next message.' : 'Files stay on this computer. Use them in chat, or hand them to a session.'}</div>
      </motion.div>
    </div>
  )
}
