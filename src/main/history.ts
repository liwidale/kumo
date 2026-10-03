import type { DayStats, DayTask, DecisionRecord } from '../shared/types'
import { settings } from './settings'
import { dataDir, debounce, readJson, writeJson } from './util'

interface DayInternal extends DayStats {
  sessionKeys: string[]
  fileKeys: string[]
}

const MAX_DECISIONS = 600

const dayKey = (t = Date.now()): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

class History {
  private days = new Map<string, DayInternal>()
  private decisionsList: DecisionRecord[] = []
  private loaded = false
  private saveDays = debounce(() => writeJson(dataDir('history.json'), [...this.days.values()]), 1500)
  private saveDecisions = debounce(() => writeJson(dataDir('decisions.json'), this.decisionsList), 1500)

  load(): void {
    if (this.loaded) return
    this.loaded = true
    for (const d of readJson<DayInternal[]>(dataDir('history.json'), [])) this.days.set(d.date, d)
    this.decisionsList = readJson<DecisionRecord[]>(dataDir('decisions.json'), [])
    this.prune()
  }

  private prune(): void {
    const keep = Math.max(1, settings.get().privacy.historyDays)
    const cutoff = dayKey(Date.now() - keep * 86_400_000)
    for (const k of this.days.keys()) if (k < cutoff) this.days.delete(k)
    const ms = Date.now() - keep * 86_400_000
    this.decisionsList = this.decisionsList.filter((d) => d.at >= ms).slice(-MAX_DECISIONS)
  }

  private today(): DayInternal {
    this.load()
    const k = dayKey()
    let d = this.days.get(k)
    if (!d) {
      d = { date: k, sessions: 0, files: 0, projects: {}, tasks: [], allowed: 0, denied: 0, toolCalls: 0, costUsd: 0, sessionKeys: [], fileKeys: [] }
      this.days.set(k, d)
      this.prune()
    }
    return d
  }

  session(key: string): void {
    const d = this.today()
    if (d.sessionKeys.includes(key)) return
    d.sessionKeys.push(key)
    d.sessions = d.sessionKeys.length
    this.saveDays()
  }

  file(project: string, path: string): void {
    const d = this.today()
    const k = path.toLowerCase()
    if (d.fileKeys.includes(k)) return
    d.fileKeys.push(k)
    d.files = d.fileKeys.length
    d.projects[project] = (d.projects[project] || 0) + 1
    this.saveDays()
  }

  tool(): void {
    this.today().toolCalls++
    this.saveDays()
  }

  task(t: DayTask): void {
    const d = this.today()
    d.tasks.push({ ...t, task: t.task.slice(0, 240), summary: t.summary?.slice(0, 400) })
    if (d.tasks.length > 200) d.tasks.splice(0, d.tasks.length - 200)
    this.saveDays()
  }

  cost(delta: number): void {
    if (!(delta > 0) || delta > 1000) return
    this.today().costUsd += delta
    this.saveDays()
  }

  decision(r: DecisionRecord): void {
    this.load()
    const d = this.today()
    if (r.behavior === 'allow') d.allowed++
    if (r.behavior === 'deny') d.denied++
    this.decisionsList.push({ ...r, subject: r.subject.slice(0, 400) })
    if (this.decisionsList.length > MAX_DECISIONS) this.decisionsList.splice(0, this.decisionsList.length - MAX_DECISIONS)
    this.saveDays()
    this.saveDecisions()
  }

  list(): DayStats[] {
    this.load()
    this.prune()
    return [...this.days.values()]
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map(({ sessionKeys: _s, fileKeys: _f, ...rest }) => rest)
  }

  decisions(): DecisionRecord[] {
    this.load()
    return [...this.decisionsList].reverse()
  }

  clearDecisions(): void {
    this.decisionsList = []
    this.saveDecisions()
  }

  clearAll(): void {
    this.days.clear()
    this.decisionsList = []
    this.saveDays()
    this.saveDecisions()
  }

  flush(): void {
    this.saveDays.flush()
    this.saveDecisions.flush()
  }
}

export const history = new History()
