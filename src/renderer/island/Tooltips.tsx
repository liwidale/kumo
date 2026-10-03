import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

interface Tip {
  text: string
  x: number
  y: number
  below: boolean
}

const DELAY = 450
const MARGIN = 8

export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = useRef<HTMLElement | null>(null)
  const bubble = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const hide = (): void => {
      if (timer.current) clearTimeout(timer.current)
      current.current = null
      setTip(null)
    }
    const over = (e: MouseEvent): void => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[title], [data-tip]')
      if (!el || el === current.current) return
      const title = el.getAttribute('title')
      if (title) {
        el.dataset.tip = title
        el.removeAttribute('title')
        if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', title)
      }
      const text = el.dataset.tip
      if (!text) return
      hide()
      current.current = el
      timer.current = setTimeout(() => {
        if (current.current !== el || !el.isConnected) return
        const r = el.getBoundingClientRect()
        const surface = el.closest('.surface')?.getBoundingClientRect()
        const below = !surface || r.bottom + 34 < surface.bottom
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below })
      }, DELAY)
    }
    const out = (e: MouseEvent): void => {
      const to = e.relatedTarget as Node | null
      if (current.current && to && current.current.contains(to)) return
      if (current.current && (e.target as HTMLElement | null)?.closest('[data-tip]') === current.current) hide()
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mouseout', out)
    document.addEventListener('mousedown', hide, true)
    document.addEventListener('wheel', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mouseout', out)
      document.removeEventListener('mousedown', hide, true)
      document.removeEventListener('wheel', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  const [shift, setShift] = useState(0)
  useEffect(() => {
    if (!tip || !bubble.current) return
    const b = bubble.current.getBoundingClientRect()
    const surface = document.querySelector('.surface')?.getBoundingClientRect()
    const left = surface ? surface.left + MARGIN : MARGIN
    const right = surface ? surface.right - MARGIN : window.innerWidth - MARGIN
    let dx = 0
    if (b.left < left) dx = left - b.left
    else if (b.right > right) dx = right - b.right
    setShift(dx)
  }, [tip])

  return (
    <AnimatePresence>
      {tip && (
        <motion.div
          key={`${tip.text}-${tip.x}-${tip.y}`}
          ref={bubble}
          className={`tip ${tip.below ? 'tip-below' : 'tip-above'}`}
          style={{ left: tip.x + shift, top: tip.y }}
          initial={{ opacity: 0, y: tip.below ? -3 : 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.14 }}
          role="tooltip"
        >
          {tip.text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
