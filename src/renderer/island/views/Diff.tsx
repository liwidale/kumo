import { tr } from '../../shared/i18n'
import { useEffect, useState } from 'react'
import { base } from '../../shared/format'
import { highlightLines, langFromPath } from '../../shared/syntax'
import { useIsland } from '../store'
import { Button, IconButton, useAction } from '../ui'

export function DiffLines({ text, max = 400, path }: { text: string; max?: number; path?: string }) {
  const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n')
  const shown = lines.slice(0, max)
  const kinds = shown.map((l) =>
    l.startsWith('\\') || l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('new file') || l.startsWith('deleted file')
      ? 'meta'
      : l.startsWith('@@')
        ? 'hunk'
        : l.startsWith('+')
          ? 'add'
          : l.startsWith('-')
            ? 'del'
            : 'ctx',
  )
  const lang = langFromPath(path)
  const codeIdx = shown.map((_, i) => i).filter((i) => kinds[i] === 'add' || kinds[i] === 'del' || kinds[i] === 'ctx')
  const painted = highlightLines(
    codeIdx.map((i) => shown[i].slice(1)),
    lang,
  )
  const byLine = new Map(codeIdx.map((i, n) => [i, painted[n]]))
  const nums: ({ a?: number; b?: number } | null)[] = []
  let oldNo = 0
  let newNo = 0
  for (let i = 0; i < shown.length; i++) {
    const kind = kinds[i]
    if (kind === 'hunk') {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(shown[i])
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
      }
      nums.push(null)
    } else if (kind === 'add') nums.push({ b: newNo++ })
    else if (kind === 'del') nums.push({ a: oldNo++ })
    else if (kind === 'ctx') nums.push(oldNo || newNo ? { a: oldNo++, b: newNo++ } : {})
    else nums.push(null)
  }
  const hasNums = nums.some((n) => n && (n.a || n.b))
  return (
    <pre className={`diff selectable${hasNums ? ' numbered' : ''}`}>
      {shown.map((l, i) => {
        const kind = kinds[i]
        if (kind === 'meta') return null
        if (kind === 'hunk')
          return (
            <div key={i} className="dl hunk">
              {hasNums && <span className="ln-gap" />}
              {l.replace(/^(@@[^@]*@@)\s*/, '$1  ')}
            </div>
          )
        const n = nums[i]
        return (
          <div key={i} className={`dl ${kind}`}>
            {hasNums && (
              <>
                <span className="ln">{n?.a ?? ''}</span>
                <span className="ln">{n?.b ?? ''}</span>
              </>
            )}
            <span className="dl-sign">{kind === 'add' ? '+' : kind === 'del' ? '−' : ' '}</span>
            {byLine.get(i)?.length ? byLine.get(i) : ' '}
          </div>
        )
      })}
      {lines.length > max && <div className="dl hunk">… {tr('{0} more line|{0} more lines', lines.length - max)}</div>}
    </pre>
  )
}

export function DiffView() {
  const diff = useIsland((s) => s.diff)
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [confirm, setConfirm] = useState(false)
  const back = useIsland((s) => s.back)
  const toast = useIsland((s) => s.showToast)
  const act = useAction()
  useEffect(() => {
    if (!diff) return
    setText(null)
    void window.kumo.gitDiff(diff.cwd, diff.path).then((r) => (r.ok ? setText(r.value || '') : setErr(r.error || tr('Could not read the diff'))))
  }, [diff])
  if (!diff) return null
  return (
    <div className="diff-view">
      <div className="detail-head">
        <IconButton icon="back" title={tr('Back (Esc)')} onClick={back} />
        <div className="detail-title">
          <div className="detail-project">{base(diff.path)}</div>
          <div className="detail-sub mono">{diff.path}</div>
        </div>
        <Button
          kind={confirm ? 'danger' : 'ghost'}
          icon="refresh"
          title={tr('Put this file back the way it is in the last commit')}
          onClick={() => {
            if (!confirm) {
              setConfirm(true)
              setTimeout(() => setConfirm(false), 4000)
              return
            }
            void window.kumo.revertFile(diff.cwd, diff.path).then((r) => {
              toast(r.ok ? tr('{0} is back to the last commit', base(diff.path)) : r.error || tr('Could not revert'), r.ok ? 'success' : 'error')
              if (r.ok) back()
            })
          }}
        >
          {confirm ? tr('Revert?') : tr('Revert')}
        </Button>
        <Button icon="edit" onClick={() => void act(window.kumo.openInEditor(diff.path, diff.cwd))}>{tr('Open')}</Button>
      </div>
      <div className="diff-scroll scroll">{err ? <div className="muted-note">{err}</div> : text === null ? <div className="muted-note shimmer">{tr('Loading diff…')}</div> : <DiffLines text={text} path={diff.path} />}</div>
    </div>
  )
}
