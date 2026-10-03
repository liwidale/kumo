export interface DiffLine {
  t: ' ' | '-' | '+'
  l: string
}

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  if (a.length * b.length > 40_000) return [...a.map((l) => ({ t: '-' as const, l })), ...b.map((l) => ({ t: '+' as const, l }))]
  const L: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ t: ' ', l: a[i] })
      i++
      j++
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', l: a[i++] })
    else out.push({ t: '+', l: b[j++] })
  }
  while (i < a.length) out.push({ t: '-', l: a[i++] })
  while (j < b.length) out.push({ t: '+', l: b[j++] })
  return out
}

export function focusDiff(lines: DiffLine[], max: number, context = 1): DiffLine[] {
  const first = lines.findIndex((d) => d.t !== ' ')
  if (first < 0) return lines.slice(0, max)
  let last = lines.length - 1
  while (last > first && lines[last].t === ' ') last--
  const start = Math.max(0, first - context)
  const end = Math.min(lines.length, last + 1 + context)
  const region = lines.slice(start, end)
  return region.length > max ? region.slice(region.length - max) : region
}
