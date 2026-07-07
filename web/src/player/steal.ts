import type { TimelineEvent } from '../model/timeline'

// Work-stealing reconstruction helpers. The backend flags individual run-starts as
// `stolen` when a goroutine starts on a different P than it last became runnable
// on — a per-goroutine heuristic. The real runtime steals ~half of a victim P's
// local run queue in one `runqsteal`, so we aggregate the flags back into the
// burst they approximate and narrate it as a batch ("P3 забрал N"). This is an
// honest reconstruction, not a recorded fact (the trace exposes neither local
// queues nor steals).

// Trailing window over which stolen run-starts are aggregated into a burst, shared
// by the narration caption and the scene's destination-P glow so they agree.
export const STEAL_LOOKBACK_NS = 8_000_000

export interface StealBurst {
  pid: number
  count: number
}

// stealBurst counts stolen run-starts per destination P within the lookback
// window and returns the largest burst, or null if none.
export function stealBurst(events: TimelineEvent[], t: number, windowNs: number): StealBurst | null {
  const counts = new Map<number, number>()
  for (const e of events) {
    if (e.t > t) break
    if (e.t < t - windowNs) continue
    if (e.type === 'g_run_start' && e.stolen && e.pid >= 0) counts.set(e.pid, (counts.get(e.pid) ?? 0) + 1)
  }
  let best: StealBurst | null = null
  for (const [pid, count] of counts) if (best === null || count > best.count) best = { pid, count }
  return best
}

export interface StealMark {
  /** time of the first stolen run-start in the burst (ns). */
  tNs: number
  pid: number
  /** number of stolen run-starts folded into this burst mark. */
  count: number
}

// stealMarks collapses runs of stolen g_run_start events into representative burst
// marks for the timeline (one diamond per burst): consecutive stolen starts on the
// same destination P, each within `windowNs` of the previous one, fold into a single
// mark whose count is the burst size and whose tNs is the first start. This mirrors
// the runtime's single runqsteal (~half a queue) that our per-goroutine `stolen`
// flag scatters across several starts. Events must be time-ordered (they are). Pure.
export function stealMarks(events: TimelineEvent[], windowNs: number): StealMark[] {
  const marks: StealMark[] = []
  const openIdx = new Map<number, number>() // pid -> index of its open burst in marks
  const lastT = new Map<number, number>() // pid -> time of its last stolen start
  for (const e of events) {
    if (e.type !== 'g_run_start' || !e.stolen || e.pid < 0) continue
    const idx = openIdx.get(e.pid)
    const prev = lastT.get(e.pid)
    if (idx !== undefined && prev !== undefined && e.t - prev <= windowNs) {
      marks[idx].count++
    } else {
      openIdx.set(e.pid, marks.length)
      marks.push({ tNs: e.t, pid: e.pid, count: 1 })
    }
    lastT.set(e.pid, e.t)
  }
  return marks
}

// pluralGor returns the Russian plural form of "горутина" for n (accusative).
export function pluralGor(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'горутину'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'горутины'
  return 'горутин'
}
