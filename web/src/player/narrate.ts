import type { TimelineEvent } from '../model/timeline'
import { stealBurst, pluralGor, STEAL_LOOKBACK_NS } from './steal'

// narrate returns a short Russian sentence describing the most notable thing
// happening at t, for the "what's happening" caption. Empty when nothing notable
// is nearby. Pure and unit-tested.
//
// GC phase (STW / concurrent mark) is read from the folded `gcActive` so the
// caption stays consistent with the scene — it never claims stop-the-world after
// the range has ended (the previous version re-scanned raw events in an 8ms window
// and lied for ~8ms of trace time, i.e. seconds of wall time at 1x). Point events
// (steals, blocks, exits) still come from a short look-back window.

const WINDOW_NS = STEAL_LOOKBACK_NS // look back for a notable point event (steal/block/exit)

export function narrate(events: TimelineEvent[], t: number, gcActive: string[]): string {
  let bestSal = -1
  let bestText = ''
  const consider = (sal: number, text: string): void => {
    // ">=" keeps the latest among equally-salient events (events iterate in time order).
    if (sal >= bestSal) {
      bestSal = sal
      bestText = text
    }
  }

  // GC phase from the live folded state (truthful: only while actually active).
  if (gcActive.some((n) => n.includes('stop-the-world'))) consider(5, 'Stop-the-world: все горутины замерли')
  else if (gcActive.some((n) => n.includes('mark phase'))) consider(4, 'GC: фаза разметки (concurrent mark)')

  // Steals are narrated as a batch (P took N): the runtime grabs ~half a victim's
  // queue at once, not the per-goroutine flag we reconstruct.
  const burst = stealBurst(events, t, WINDOW_NS)
  if (burst) consider(3, `P${burst.pid} забрал ${burst.count} ${pluralGor(burst.count)}`)

  for (const e of events) {
    if (e.t > t) break
    if (e.t < t - WINDOW_NS) continue
    if (e.type === 'g_block') consider(2, `G${e.gid} заблокирован: ${e.reason ?? '?'}`)
    else if (e.type === 'g_exit') consider(1, `G${e.gid} завершилась`)
  }

  return bestText
}
