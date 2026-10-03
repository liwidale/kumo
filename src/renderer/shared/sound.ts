type Cue = 'open' | 'close' | 'approval' | 'done' | 'error' | 'attention' | 'tap' | 'send' | 'drop'

let ctx: AudioContext | null = null
let enabled = true
let volume = 0.5

export function configureSound(on: boolean, vol: number): void {
  enabled = on
  volume = Math.max(0, Math.min(1, vol))
}

function audio(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' })
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(a: AudioContext, freq: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine'): void {
  const o = a.createOscillator()
  const g = a.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, at)
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(a.destination)
  o.start(at)
  o.stop(at + dur + 0.02)
}

const NOTES: Record<Cue, [number, number, number, number][]> = {
  open: [[880, 0, 0.09, 0.35]],
  close: [[660, 0, 0.08, 0.25]],
  tap: [[1320, 0, 0.04, 0.18]],
  send: [
    [740, 0, 0.07, 0.3],
    [1110, 0.05, 0.09, 0.25],
  ],
  drop: [
    [520, 0, 0.08, 0.35],
    [780, 0.06, 0.12, 0.3],
  ],
  approval: [
    [988, 0, 0.16, 0.45],
    [1319, 0.11, 0.24, 0.4],
  ],
  attention: [[1047, 0, 0.18, 0.4]],
  done: [
    [784, 0, 0.12, 0.35],
    [988, 0.08, 0.12, 0.33],
    [1319, 0.16, 0.28, 0.3],
  ],
  error: [
    [392, 0, 0.18, 0.4],
    [330, 0.12, 0.26, 0.38],
  ],
}

export function play(cue: Cue): void {
  if (!enabled || volume <= 0) return
  const a = audio()
  if (!a) return
  const now = a.currentTime + 0.01
  const master = 0.16 * volume
  for (const [f, off, dur, g] of NOTES[cue]) {
    tone(a, f, now + off, dur, master * g)
    tone(a, f * 2, now + off, dur * 0.6, master * g * 0.12)
  }
}
