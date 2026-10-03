import { Fragment, useState, type ReactNode } from 'react'
import { Icon } from './icons'
import { highlightLines, langFromFence } from './syntax'


function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)]+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={k}>{m[2].slice(2, -2)}</strong>)
    else if (m[3]) out.push(<em key={k}>{m[3].slice(1, -1)}</em>)
    else if (m[4]) {
      const label = m[4].slice(1, m[4].indexOf(']'))
      out.push(<ExtLink key={k} href={m[5]}>{label}</ExtLink>)
    } else if (m[6]) out.push(<ExtLink key={k} href={m[6]}>{m[6]}</ExtLink>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        void window.kumo.openExternal(href)
      }}
    >
      {children}
    </a>
  )
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || 'code'}</span>
        <button
          className="icon-btn tiny"
          title="Copy"
          onClick={() => {
            void window.kumo.copyText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={13} />
        </button>
      </div>
      <pre className="selectable">
        <code>
          {highlightLines(code.split('\n'), langFromFence(lang)).map((nodes, i) => (
            <span key={i} className="code-line">
              {nodes}
              {'\n'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const blocks: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let i = 0
  let k = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^\s*```(\S*)/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++
      blocks.push(<CodeBlock key={k++} code={body.join('\n')} lang={fence[1]} />)
      continue
    }
    const h = /^(#{1,4})\s+(.*)/.exec(line)
    if (h) {
      blocks.push(
        <div key={k++} className={`md-h md-h${h[1].length}`}>
          {inline(h[2], k)}
        </div>,
      )
      i++
      continue
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line)
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''), i)}</li>)
        i++
      }
      blocks.push(ordered ? <ol key={k++}>{items}</ol> : <ul key={k++}>{items}</ul>)
      continue
    }
    if (/^\s*>\s?/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''))
      blocks.push(<blockquote key={k++}>{inline(q.join(' '), k)}</blockquote>)
      continue
    }
    if (!line.trim()) {
      i++
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,4}\s|[-*•]\s|\d+[.)]\s|>)/.test(lines[i])) para.push(lines[i++])
    blocks.push(
      <p key={k++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, j)}
          </Fragment>
        ))}
      </p>,
    )
  }
  return (
    <div className={`md selectable${streaming ? ' streaming' : ''}`}>
      {blocks}
      {streaming && <span className="caret" />}
    </div>
  )
}
