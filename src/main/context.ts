import { desktopCapturer, nativeImage } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import type { ActiveWindow, ContextItem, Session } from '../shared/types'
import { basename, dataDir, debounce, ensureDir, exists, id, readJson, truncate, writeJson } from './util'


const IMAGE = /\.(png|jpe?g|gif|webp|bmp|heic)$/i
const TEXT = /\.(txt|md|mdx|json|jsonc|ya?ml|toml|ini|cfg|conf|env\.example|csv|tsv|xml|html?|css|scss|less|js|jsx|mjs|cjs|ts|tsx|vue|svelte|py|rb|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|ps1|psm1|sql|graphql|gql|proto|lua|dart|ex|exs|erl|hs|scala|r|jl|tf|dockerfile|gradle|makefile|lock|log)$/i

export const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
}

export function mimeOf(p: string): string {
  const ext = path.extname(p).slice(1).toLowerCase()
  if (MIME[ext]) return MIME[ext]
  if (TEXT.test(p) || /(^|[\\/])(Dockerfile|Makefile|LICENSE|README)$/i.test(p)) return 'text/plain'
  return 'application/octet-stream'
}

export function isText(p: string): boolean {
  return mimeOf(p) === 'text/plain'
}

function thumbFor(p: string): string | undefined {
  try {
    const img = nativeImage.createFromPath(p)
    if (img.isEmpty()) return undefined
    const { width, height } = img.getSize()
    const scale = Math.min(1, 320 / Math.max(width, height))
    return img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' }).toDataURL()
  } catch {
    return undefined
  }
}

function snippetFor(p: string, size: number): string | undefined {
  if (!isText(p) || size > 2_000_000) return undefined
  try {
    const fd = fs.openSync(p, 'r')
    const buf = Buffer.alloc(Math.min(size, 600))
    fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    return buf.toString('utf8').replace(/\r/g, '').split('\n').slice(0, 6).join('\n')
  } catch {
    return undefined
  }
}

class ContextStore extends EventEmitter {
  private items: ContextItem[] = []
  private save = debounce(() => writeJson(dataDir('context.json'), this.items), 300)

  load(): void {
    this.items = readJson<ContextItem[]>(dataDir('context.json'), []).filter((i) => Date.now() - i.addedAt < 7 * 86_400_000)
    this.revalidate()
  }

  list(): ContextItem[] {
    return this.items
  }

  get(ids: string[]): ContextItem[] {
    return this.items.filter((i) => ids.includes(i.id))
  }

  private changed(): void {
    this.save()
    this.emit('change')
  }

  revalidate(): void {
    let dirty = false
    for (const i of this.items) {
      if (!i.path) continue
      const missing = !exists(i.path)
      if (missing !== Boolean(i.missing)) {
        i.missing = missing
        dirty = true
      }
    }
    if (dirty) this.changed()
  }

  addPaths(paths: string[], chat = false): ContextItem[] {
    const added: ContextItem[] = []
    for (const p of paths) {
      if (!p) continue
      const existing = this.items.find((i) => i.path === p && !i.sessionKey && Boolean(i.chat) === chat)
      if (existing) {
        added.push(existing)
        continue
      }
      let stat: fs.Stats
      try {
        stat = fs.statSync(p)
      } catch {
        continue
      }
      const folder = stat.isDirectory()
      const image = !folder && IMAGE.test(p)
      const item: ContextItem = {
        id: id(),
        kind: folder ? 'folder' : image ? 'image' : 'file',
        name: basename(p),
        path: p,
        size: folder ? undefined : stat.size,
        mime: folder ? undefined : mimeOf(p),
        thumb: image ? thumbFor(p) : undefined,
        snippet: folder ? undefined : snippetFor(p, stat.size),
        addedAt: Date.now(),
        chat: chat || undefined,
      }
      this.items.unshift(item)
      added.push(item)
    }
    this.items = this.items.slice(0, 40)
    if (added.length) this.changed()
    return added
  }

  addImage(png: Buffer, chat = false): ContextItem {
    const dir = dataDir('captures')
    ensureDir(dir)
    const file = path.join(dir, `pasted-${Date.now()}.png`)
    fs.writeFileSync(file, png)
    const item: ContextItem = {
      id: id(),
      kind: 'image',
      name: 'Pasted image',
      path: file,
      mime: 'image/png',
      size: png.length,
      thumb: thumbFor(file),
      addedAt: Date.now(),
      chat: chat || undefined,
    }
    this.items.unshift(item)
    this.changed()
    return item
  }

  addText(text: string): ContextItem {
    const item: ContextItem = {
      id: id(),
      kind: 'text',
      name: truncate(text.split('\n')[0], 40) || 'Snippet',
      snippet: text.slice(0, 20_000),
      size: text.length,
      addedAt: Date.now(),
    }
    this.items.unshift(item)
    this.changed()
    return item
  }

  async captureWindow(win: ActiveWindow | null): Promise<ContextItem> {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 1600, height: 1000 }, fetchWindowIcons: false })
    const winId = win?.windowId ?? win?.handle
    let src = winId ? sources.find((s) => s.id.startsWith(`window:${winId}:`)) : undefined
    if (!src && win) src = sources.find((s) => s.name && win.title && s.name === win.title)
    if (!src) src = sources.find((s) => s.id.startsWith('screen:'))
    if (!src || src.thumbnail.isEmpty()) throw new Error('Kumo could not capture that window. On macOS, allow Screen Recording in System Settings.')
    const dir = dataDir('captures')
    ensureDir(dir)
    const file = path.join(dir, `capture-${Date.now()}.png`)
    fs.writeFileSync(file, src.thumbnail.toPNG())
    const size = src.thumbnail.getSize()
    const scale = Math.min(1, 320 / Math.max(size.width, size.height))
    const item: ContextItem = {
      id: id(),
      kind: 'window',
      name: win?.title ? truncate(win.title, 60) : src.name || 'Screen',
      appName: win?.app,
      path: file,
      mime: 'image/png',
      size: fs.statSync(file).size,
      thumb: src.thumbnail.resize({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }).toDataURL(),
      addedAt: Date.now(),
    }
    this.items.unshift(item)
    this.changed()
    return item
  }

  remove(itemId: string): void {
    this.items = this.items.filter((i) => i.id !== itemId)
    this.changed()
  }

  clear(): void {
    this.items = this.items.filter((i) => i.sessionKey && !i.delivered)
    this.changed()
  }

  bind(ids: string[], sessionKey: string | null): void {
    for (const i of this.items) {
      if (!ids.includes(i.id)) continue
      i.sessionKey = sessionKey || undefined
      i.delivered = false
    }
    this.changed()
  }

  pendingFor(sessionKey: string): ContextItem[] {
    return this.items.filter((i) => i.sessionKey === sessionKey && !i.delivered && !i.missing)
  }

  forSession(sessionKey: string): ContextItem[] {
    return this.items.filter((i) => i.sessionKey === sessionKey)
  }

  deliver(sessionKey: string, s: Session): string {
    const items = this.pendingFor(sessionKey)
    if (!items.length) return ''
    for (const i of items) i.delivered = true
    this.changed()
    return describeForAgent(items, s.cwd)
  }

  purge(): void {
    this.items = []
    try {
      fs.rmSync(dataDir('captures'), { recursive: true, force: true })
    } catch {
    }
    this.changed()
  }
}

export function describeForAgent(items: ContextItem[], cwd?: string): string {
  const lines = ['The user shared the following context with you through Kumo. Use it if it is relevant to the task.']
  for (const i of items) {
    if (i.kind === 'text') {
      lines.push(`- Snippet:\n\`\`\`\n${(i.snippet || '').slice(0, 8000)}\n\`\`\``)
      continue
    }
    const rel = i.path && cwd && i.path.startsWith(cwd) ? path.relative(cwd, i.path) : i.path
    const label = i.kind === 'window' ? `Screenshot of ${i.appName ? `${i.appName} - ` : ''}${i.name}` : i.kind === 'folder' ? 'Folder' : i.kind === 'image' ? 'Image' : 'File'
    lines.push(`- ${label}: ${rel}`)
  }
  return lines.join('\n')
}

export const context = new ContextStore()
