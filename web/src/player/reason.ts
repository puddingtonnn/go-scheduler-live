// reasonCategory buckets a goroutine's block reason (from the trace, e.g.
// "chan receive", "sync.Mutex.Lock", "sleep", "GC mark assist wait for work")
// into a small set of human categories for grouping and narration.

export type ReasonCategory = 'канал' | 'сон' | 'sync' | 'GC' | 'прочее'

export const REASON_CATEGORIES: readonly ReasonCategory[] = ['канал', 'сон', 'sync', 'GC', 'прочее']

export function reasonCategory(reason: string | undefined): ReasonCategory {
  const r = (reason ?? '').toLowerCase()
  if (r.includes('chan') || r.includes('select')) return 'канал'
  if (r.includes('sleep')) return 'сон'
  if (r.includes('sync') || r.includes('mutex')) return 'sync'
  if (r.includes('gc')) return 'GC'
  return 'прочее'
}
