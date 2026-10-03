import type { ReactNode } from 'react'


export type Lang = 'js' | 'py' | 'rust' | 'go' | 'c' | 'java' | 'swift' | 'css' | 'json' | 'yaml' | 'shell' | 'sql' | 'html' | 'ruby' | 'php' | 'lua' | 'plain'

const EXT: Record<string, Lang> = {
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', vue: 'js', svelte: 'js', astro: 'js',
  py: 'py', pyi: 'py',
  rs: 'rust',
  go: 'go',
  c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', cs: 'c', m: 'c', mm: 'c', dart: 'c',
  java: 'java', kt: 'java', kts: 'java', scala: 'java', groovy: 'java', gradle: 'java',
  swift: 'swift',
  css: 'css', scss: 'css', less: 'css', sass: 'css',
  json: 'json', jsonc: 'json', json5: 'json',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml', cfg: 'yaml', conf: 'yaml', env: 'yaml',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'shell', psm1: 'shell', bat: 'shell', cmd: 'shell', dockerfile: 'shell', makefile: 'shell',
  sql: 'sql',
  html: 'html', htm: 'html', xml: 'html', svg: 'html', md: 'plain', mdx: 'html',
  rb: 'ruby', php: 'php', lua: 'lua',
}

const FENCE: Record<string, Lang> = {
  typescript: 'js', javascript: 'js', ts: 'js', js: 'js', tsx: 'js', jsx: 'js', python: 'py', py: 'py', rust: 'rust', rs: 'rust', go: 'go', golang: 'go',
  c: 'c', cpp: 'c', 'c++': 'c', csharp: 'c', cs: 'c', java: 'java', kotlin: 'java', kt: 'java', swift: 'swift', css: 'css', scss: 'css', json: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'yaml', bash: 'shell', sh: 'shell', shell: 'shell', zsh: 'shell', powershell: 'shell', ps1: 'shell', console: 'shell',
  sql: 'sql', html: 'html', xml: 'html', ruby: 'ruby', rb: 'ruby', php: 'php', lua: 'lua',
}

export function langFromPath(p?: string): Lang {
  if (!p) return 'plain'
  const name = p.split(/[\\/]/).pop() || ''
  if (/^(Dockerfile|Makefile)$/i.test(name)) return 'shell'
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase()
  return (ext && EXT[ext]) || 'plain'
}

export const langFromFence = (f?: string): Lang => (f ? FENCE[f.toLowerCase()] || langFromPath(`x.${f}`) : 'plain')

const words = (s: string): Set<string> => new Set(s.split(/\s+/).filter(Boolean))

const KW: Record<Lang, Set<string>> = {
  js: words('import export from as default const let var function return if else for while do switch case break continue new class extends super this typeof instanceof in of void delete try catch finally throw async await yield static get set interface type enum implements namespace declare readonly public private protected abstract keyof satisfies module require'),
  py: words('def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield global nonlocal assert del async await match case self'),
  rust: words('fn let mut const static struct enum impl trait pub use mod crate super self Self match if else loop while for in return break continue as where move ref async await dyn unsafe extern type'),
  go: words('package import func var const type struct interface map chan go defer return if else for range switch case default break continue select fallthrough goto'),
  c: words('int char float double void long short unsigned signed struct union enum typedef static const extern return if else for while do switch case break continue default sizeof goto auto register volatile class public private protected virtual override namespace using template typename new delete this include define ifdef ifndef endif using var string bool async await'),
  java: words('class interface enum extends implements public private protected static final abstract void return if else for while do switch case break continue new this super try catch finally throw throws import package fun val var when object companion data sealed override suspend is as in'),
  swift: words('func let var class struct enum protocol extension import return if else guard for while repeat switch case break continue in where self Self init deinit throws throw try catch defer async await public private internal fileprivate open static override mutating some any'),
  css: words('important media import supports keyframes font-face from to and not only'),
  json: words(''),
  yaml: words(''),
  shell: words('if then else elif fi for while do done case esac function in return export local echo cd exit set unset source alias sudo npm npx pnpm yarn git node python pip cargo go make docker Get-ChildItem Set-Location Remove-Item New-Item Copy-Item Write-Output'),
  sql: words('select from where and or not insert into values update set delete create table drop alter index join left right inner outer on group by order having limit offset as distinct union all primary key foreign references null default'),
  html: words(''),
  ruby: words('def class module end if elsif else unless while until for in do return yield begin rescue ensure raise require include extend self nil true false then case when'),
  php: words('function class public private protected static return if else elseif foreach for while echo new use namespace extends implements interface const array fn match'),
  lua: words('local function end if then else elseif for while do repeat until return break in and or not nil true false'),
  plain: words(''),
}

const LITERAL = words('true false null undefined None True False nil NaN Infinity')
const HASH_COMMENT = new Set<Lang>(['py', 'yaml', 'shell', 'ruby'])
const DASH_COMMENT = new Set<Lang>(['sql', 'lua'])
const SLASH_COMMENT = new Set<Lang>(['js', 'rust', 'go', 'c', 'java', 'swift', 'css', 'json', 'php'])

const cls = (t: string): string => `tk-${t}`

export function highlightLines(lines: string[], lang: Lang): ReactNode[][] {
  let inBlock = false
  return lines.map((line, li) => {
    const out: ReactNode[] = []
    let i = 0
    let k = 0
    const push = (text: string, type?: string): void => {
      if (!text) return
      out.push(type ? <span key={`${li}-${k++}`} className={cls(type)}>{text}</span> : text)
    }
    if (lang === 'plain') return [line]
    const kw = KW[lang]
    while (i < line.length) {
      if (inBlock) {
        const end = lang === 'html' ? line.indexOf('-->', i) : line.indexOf('*/', i)
        if (end < 0) {
          push(line.slice(i), 'c')
          break
        }
        const stop = end + (lang === 'html' ? 3 : 2)
        push(line.slice(i, stop), 'c')
        i = stop
        inBlock = false
        continue
      }
      const rest = line.slice(i)
      const ch = line[i]
      if ((SLASH_COMMENT.has(lang) && rest.startsWith('//')) || (HASH_COMMENT.has(lang) && ch === '#' && !(lang === 'shell' && rest.startsWith('#!') && li > 0)) || (DASH_COMMENT.has(lang) && rest.startsWith('--'))) {
        if (!(lang === 'css' && rest.startsWith('//'))) {
          push(rest, 'c')
          break
        }
      }
      if ((SLASH_COMMENT.has(lang) && rest.startsWith('/*')) || (lang === 'html' && rest.startsWith('<!--'))) {
        inBlock = true
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        let j = i + 1
        while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1
        const s = line.slice(i, Math.min(j + 1, line.length))
        const isKey = (lang === 'json' || lang === 'yaml') && /^\s*:/.test(line.slice(j + 1))
        push(s, isKey ? 'p' : 's')
        i += s.length
        continue
      }
      const before = line.slice(0, i).trimEnd()
      const tagSpot = lang === 'html' || rest.startsWith('</') || before === '' || /[(=,{}?:>&|[]$/.test(before) || /\breturn$/.test(before)
      if (ch === '<' && (lang === 'html' || lang === 'js') && tagSpot) {
        const m = /^<\/?([A-Za-z][\w.:-]*)/.exec(rest)
        if (m && (lang === 'html' || /^[A-Z]|^[a-z][\w-]*(\s|>|\/|$)/.test(m[1] + (rest[m[0].length] ?? '')))) {
          push(rest.slice(0, m[0].length - m[1].length), 'o')
          push(m[1], 'tag')
          i += m[0].length
          continue
        }
      }
      const num = /^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)\b/.exec(rest)
      if (num && !/[\w$]/.test(line[i - 1] || '')) {
        push(num[0], 'n')
        i += num[0].length
        continue
      }
      if ((lang === 'css' || lang === 'yaml') && /^[A-Za-z_-][\w-]*\s*:/.test(rest) && /^\s*$/.test(line.slice(0, i))) {
        const m = /^[A-Za-z_-][\w-]*/.exec(rest)!
        push(m[0], 'p')
        i += m[0].length
        continue
      }
      const id = /^[A-Za-z_$@][\w$-]*/.exec(rest)
      if (id) {
        let word = id[0]
        if (!(lang === 'css' || lang === 'shell' || lang === 'yaml')) word = word.replace(/-.*$/, '')
        const before = line[i - 1] || ''
        const after = line.slice(i + word.length)
        let type: string | undefined
        if (kw.has(word) || (lang === 'sql' && kw.has(word.toLowerCase()))) type = 'k'
        else if (LITERAL.has(word)) type = 'l'
        else if (word.startsWith('@')) type = 'k'
        else if (before === '.' ) type = /^\s*\(/.test(after) ? 'f' : 'p'
        else if (/^\s*\(/.test(after)) type = 'f'
        else if (/^[A-Z][A-Za-z0-9]*[a-z]/.test(word) && lang !== 'shell') type = 't'
        else if (lang === 'shell' && /^-{1,2}[\w-]+/.test(word)) type = 'p'
        push(word, type)
        i += word.length
        continue
      }
      if (lang === 'shell' && ch === '-' && /^-{1,2}[A-Za-z][\w-]*/.test(rest) && /\s/.test(line[i - 1] || ' ')) {
        const m = /^-{1,2}[A-Za-z][\w-]*/.exec(rest)!
        push(m[0], 'p')
        i += m[0].length
        continue
      }
      const op = /^[=<>!+\-*/%&|^~?:]+/.exec(rest)
      if (op) {
        push(op[0], 'o')
        i += op[0].length
        continue
      }
      push(ch)
      i++
    }
    return out
  })
}

export function highlight(line: string, lang: Lang): ReactNode[] {
  return highlightLines([line], lang)[0]
}
