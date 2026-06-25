import type { TimelineEvent } from '../model/timeline'
import { stealBurst, pluralGor } from './steal'

// narrate returns a short Russian sentence describing the most notable event in
// the trace just before t, for the "what's happening" caption. Empty string
// when nothing notable is nearby (e.g. steady running). Pure and unit-tested.

const WINDOW_NS = 8_000_000 // look back ~8ms of trace time for a notable event

export function narrate(events: TimelineEvent[], t: number): string {
  let best: { sal: number; text: string } | null = null
  for (const e of events) {
    if (e.t > t) break
    if (e.t < t - WINDOW_NS) continue
    const d = describe(e)
    // Iterating in time order, ">=" keeps the latest among equally-salient events.
    if (d && (best === null || d.sal >= best.sal)) best = d
  }
  // Steals are narrated as a batch (P took N), reflecting that the runtime grabs
  // ~half a victim's queue at once, not the per-goroutine flag we reconstruct.
  const burst = stealBurst(events, t, WINDOW_NS)
  if (burst) {
    const d = { sal: 3, text: `P${burst.pid} забрал ${burst.count} ${pluralGor(burst.count)}` }
    if (best === null || d.sal >= best.sal) best = d
  }
  return best?.text ?? ''
}

function describe(e: TimelineEvent): { sal: number; text: string } | null {
  switch (e.type) {
    case 'gc_range_begin':
      if (e.name?.includes('stop-the-world')) return { sal: 5, text: 'Stop-the-world: все горутины замерли' }
      if (e.name?.includes('mark phase')) return { sal: 4, text: 'GC: фаза разметки (concurrent mark)' }
      return null
    case 'g_block':
      return { sal: 2, text: `G${e.gid} заблокирован: ${e.reason ?? '?'}` }
    case 'g_exit':
      return { sal: 1, text: `G${e.gid} завершилась` }
    default:
      return null
  }
}
