import { tr } from '../shared/i18n'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ActiveWindow, Mood } from '../../shared/types'
import { liveSessions } from '../shared/format'
import type { KumoHandle } from '../shared/Kumo'
import { Icon } from '../shared/icons'
import { useIsland, type Level, type Tab, type View } from './store'
import { IconButton, Segmented } from './ui'
import { Approval } from './views/Approval'
import { Chat } from './views/Chat'
import { Context, DropZone } from './views/Context'
import { DiffView } from './views/Diff'
import { Home } from './views/Home'
import { Launch } from './views/Launch'
import { Notify, Peek } from './views/Peek'
import { SessionDetail } from './views/SessionDetail'
import { Today } from './views/Today'
import { Welcome } from './views/Welcome'

interface Props {
  level: Level
  maxHeight: number
  onHeight(h: number): void
  kumoRef: RefObject<KumoHandle | null>
  mood: Mood
  now: number
}

const TAB_OF: Record<View, Tab | null> = {
  home: 'home',
  session: 'home',
  diff: 'home',
  launch: 'home',
  today: 'home',
  approval: null,
  chat: 'chat',
  context: 'context',
  drop: 'context',
  welcome: null,
}

function Header() {
  const view = useIsland((s) => s.view)
  const open = useIsland((s) => s.open)
  const snap = useIsland((s) => s.snap)
  const collapse = useIsland((s) => s.collapse)
  const showToast = useIsland((s) => s.showToast)
  const [from, setFrom] = useState<ActiveWindow | null>(null)
  useEffect(() => {
    void window.kumo.activeWindow().then(setFrom)
  }, [])
  const tab = TAB_OF[view]
  const live = liveSessions(snap).length
  const ctx = snap?.context.filter((c) => !c.sessionKey && !c.chat).length ?? 0
  if (!tab) return null
  return (
    <div className="body-header">
      <Segmented<Tab>
        value={tab}
        onChange={(t) => open(t, { reset: true })}
        options={[
          { value: 'home', label: tr('Sessions'), badge: live || undefined },
          { value: 'chat', label: tr('Chat') },
          { value: 'context', label: tr('Context'), badge: ctx || undefined },
        ]}
      />
      <div className="header-actions">
        {from && (
          <button
            type="button"
            className="back-to"
            title={tr('Back to {0}{1}', from.app, from.title ? ` - ${from.title}` : '')}
            onClick={() =>
              void window.kumo.returnToWindow().then((r) => {
                if (r.ok) collapse()
                else showToast(r.error || tr('That window is gone'), 'error')
              })
            }
          >
            <Icon name="back" size={12} />
            <span>{from.app}</span>
          </button>
        )}
        <IconButton icon="plus" title={tr('New session (Ctrl/⌘ N)')} onClick={() => open('launch')} />
        <IconButton icon="gear" title={tr('Settings')} onClick={() => window.kumo.openSettings()} />
      </div>
    </div>
  )
}

function ViewFor({ view, kumoRef, mood, now }: { view: View; kumoRef: RefObject<KumoHandle | null>; mood: Mood; now: number }) {
  switch (view) {
    case 'home':
      return <Home now={now} mood={mood} />
    case 'session':
      return <SessionDetail now={now} />
    case 'approval':
      return <Approval now={now} />
    case 'chat':
      return <Chat />
    case 'context':
      return <Context />
    case 'drop':
      return <DropZone />
    case 'launch':
      return <Launch />
    case 'diff':
      return <DiffView />
    case 'welcome':
      return <Welcome kumoRef={kumoRef} />
    case 'today':
      return <Today />
  }
}

export function Body({ level, maxHeight, onHeight, kumoRef, mood, now }: Props) {
  const inner = useRef<HTMLDivElement>(null)
  const view = useIsland((s) => s.view)
  const sessionKey = useIsland((s) => s.sessionKey)
  const toast = useIsland((s) => s.toast)

  const key = level === 'open' ? `${view}:${view === 'session' ? sessionKey : ''}` : level

  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const measure = (): void => {
      const head = el.querySelector<HTMLElement>(':scope > .body-header')
      const cur = el.querySelector<HTMLElement>(`:scope > [data-key="${CSS.escape(key)}"]`)
      const content = (head?.offsetHeight ?? 0) + (cur?.scrollHeight ?? 0)
      if (content <= 0) return
      const cs = getComputedStyle(el)
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      onHeight(Math.min(maxHeight, Math.ceil(content + pad)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const mo = new MutationObserver(() => {
      for (const c of Array.from(el.children)) ro.observe(c)
      measure()
    })
    mo.observe(el, { childList: true })
    for (const c of Array.from(el.children)) ro.observe(c)
    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [maxHeight, onHeight, key])

  useLayoutEffect(() => () => onHeight(0), [onHeight])

  return (
    <div className="body-inner" ref={inner} style={{ ['--max-body' as string]: `${maxHeight}px` }}>
      {level === 'open' && <Header />}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={key}
          data-key={key}
          className="view"
          initial={{ opacity: 0, y: 6, filter: 'blur(3px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.1 } }}
        >
          {level === 'peek' ? <Peek now={now} /> : level === 'notify' ? <Notify now={now} /> : <ViewFor view={view} kumoRef={kumoRef} mood={mood} now={now} />}
        </motion.div>
      </AnimatePresence>
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            className={`toast toast-${toast.tone}`}
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 500, damping: 36 }}
            role="status"
          >
            {toast.tone === 'error' ? <Icon name="alert" size={13} /> : toast.tone === 'success' ? <Icon name="check" size={13} /> : null}
            <span>{toast.text}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
