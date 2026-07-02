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

// captionWindowNs bounds the caption's look-back to the smaller of the 8ms steal
// window and 1% of the whole run, so a short trace (e.g. workstealing ~39ms, where
// a fixed 8ms is ~20% of the timeline and would persist ~9s of wall time at 1x)
// does not leave the caption describing something that scrolled off long ago.
export function captionWindowNs(durationNs: number): number {
  return Math.max(1, Math.min(STEAL_LOOKBACK_NS, Math.round(durationNs * 0.01)))
}

export function narrate(
  events: TimelineEvent[],
  t: number,
  gcActive: string[],
  windowNs: number = STEAL_LOOKBACK_NS,
  midAlias?: Map<number, number>,
): string {
  let bestSal = -1
  let bestText = ''
  const consider = (sal: number, text: string): void => {
    // Precedence: higher salience always wins (STW > mark > syscall > steal >
    // block > exit); among equal salience, ">=" keeps the latest (events
    // iterate in time order).
    if (sal >= bestSal) {
      bestSal = sal
      bestText = text
    }
  }
  // Same ordinal aliases as the carrier tags (raw darwin thread ids are huge).
  const mName = (mid: number): string => `M${midAlias?.get(mid) ?? mid}`

  // GC phase from the live folded state (truthful: only while actually active).
  if (gcActive.some((n) => n.includes('stop-the-world'))) consider(6, 'Stop-the-world: все горутины замерли')
  else if (gcActive.some((n) => n.includes('mark phase'))) consider(5, 'GC: фаза разметки (concurrent mark)')

  // Steals are narrated as a batch (P took N): the runtime grabs ~half a victim's
  // queue at once, not the per-goroutine flag we reconstruct.
  const burst = stealBurst(events, t, windowNs)
  if (burst) consider(3, `P${burst.pid} забрал ${burst.count} ${pluralGor(burst.count)}`)

  for (const e of events) {
    if (e.t > t) break
    if (e.t < t - windowNs) continue
    // Syscall enter/exit are own-execution events, so e.mid really is the
    // goroutine's M (unlike g_unblock, whose mid is the waker's — not shown).
    if (e.type === 'g_syscall_enter')
      consider(4, `G${e.gid} ушла в syscall${e.mid >= 0 ? ` — ${mName(e.mid)} блокируется с ней в ядре` : ''}`)
    else if (e.type === 'g_syscall_exit') consider(4, `G${e.gid} вернулась из syscall на P${e.pid}`)
    else if (e.type === 'g_block') consider(2, `G${e.gid} заблокирован: ${e.reason ?? '?'}`)
    else if (e.type === 'g_exit') consider(1, `G${e.gid} завершилась`)
  }

  return bestText
}
