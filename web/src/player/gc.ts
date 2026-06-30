import type { Timeline } from '../model/timeline'

// gcSummary reduces a Timeline's GC ranges into the cycle/STW/mark intervals the
// chrome needs to surface REAL GC behavior. The trace records two short
// stop-the-world pauses per cycle (sweep-termination, mark-termination) bracketing
// a long concurrent-mark phase, plus a "start trace" STW. At the 45s-normalized
// playback those STW pauses are sub-frame, so the per-frame state misses them —
// this summary (computed once) lets the UI show the GC strip, a cycle counter and
// the real longest-STW duration honestly, at true wall-time proportion. Pure.

export interface Interval {
  startNs: number
  endNs: number
}

export interface StwInterval extends Interval {
  ns: number
}

export interface GcSummary {
  /** number of GC cycles (one concurrent-mark phase each). */
  cycles: number
  /** stop-the-world pauses, paired begin→end, in trace-time order. */
  stw: StwInterval[]
  /** concurrent-mark phases, paired begin→end. */
  mark: Interval[]
  /** longest real STW pause in ns (0 if none). */
  maxStwNs: number
}

// "stop-the-world (start trace)" is the tracer starting up, not a GC pause, so it
// is excluded — counting it would inflate the longest-STW readout misleadingly.
const isStw = (name: string): boolean => name.includes('stop-the-world') && !name.includes('start trace')
const isMark = (name: string): boolean => name.includes('mark phase')

// gcSummary pairs each gc_range_begin with its matching gc_range_end (by name,
// LIFO) and buckets the closed intervals into STW vs concurrent-mark.
export function gcSummary(timeline: Timeline): GcSummary {
  const open = new Map<string, number[]>() // name -> stack of begin times
  const stw: StwInterval[] = []
  const mark: Interval[] = []

  for (const e of timeline.events) {
    if (e.type === 'gc_range_begin' && e.name) {
      const stack = open.get(e.name) ?? []
      stack.push(e.t)
      open.set(e.name, stack)
    } else if (e.type === 'gc_range_end' && e.name) {
      const stack = open.get(e.name)
      const start = stack?.pop()
      if (start === undefined) continue
      if (isStw(e.name)) stw.push({ startNs: start, endNs: e.t, ns: e.t - start })
      else if (isMark(e.name)) mark.push({ startNs: start, endNs: e.t })
    }
  }

  const maxStwNs = stw.reduce((m, s) => Math.max(m, s.ns), 0)
  return { cycles: mark.length, stw, mark, maxStwNs }
}

// stwInWindow returns the STW pause overlapping the half-open step window (t0, t1]
// — used to catch a sub-frame STW that began and ended between two render frames,
// so the in-world STW cue still fires. Returns the longest such pause, or null.
export function stwInWindow(s: GcSummary, t0: number, t1: number): StwInterval | null {
  let best: StwInterval | null = null
  for (const iv of s.stw) {
    // overlap of (t0, t1] with [startNs, endNs]
    if (iv.endNs > t0 && iv.startNs <= t1) {
      if (best === null || iv.ns > best.ns) best = iv
    }
  }
  return best
}

// STEP_WINDOW_PCT bounds what counts as a single normal playback step (vs a
// scrub/seek): a forward advance under this fraction of the run. Large enough to
// span a 16-33ms render frame at any speed, small enough to exclude a scrub jump.
export const STEP_WINDOW_PCT = 0.03

// isPlaybackStep reports whether (lastT, t] is one forward playback step, so the
// in-world GC/steal cues fire during play but not when scrubbing. Shared by the
// scene (vignette) and the chrome (banner) so both detect the same window.
export function isPlaybackStep(lastT: number, t: number, durationNs: number): boolean {
  return lastT >= 0 && t > lastT && t - lastT < Math.max(1, durationNs * STEP_WINDOW_PCT)
}
