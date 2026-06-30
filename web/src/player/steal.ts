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

// pluralGor returns the Russian plural form of "горутина" for n (accusative).
export function pluralGor(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (d === 1 && dd !== 11) return 'горутину'
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'горутины'
  return 'горутин'
}
