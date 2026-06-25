import { describe, it, expect } from 'vitest'
import { narrate } from './narrate'
import { NO_RESOURCE, type TimelineEvent } from '../model/timeline'

function ev(t: number, type: TimelineEvent['type'], extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return { t, type, gid: NO_RESOURCE, pid: NO_RESOURCE, ...extra }
}

describe('narrate', () => {
  it('returns empty when nothing notable is near t', () => {
    expect(narrate([ev(1, 'p_start', { pid: 0 })], 100)).toBe('')
  })

  it('prefers stop-the-world over a steal in the window', () => {
    const events = [ev(100, 'g_run_start', { gid: 7, pid: 1, stolen: true }), ev(101, 'gc_range_begin', { name: 'stop-the-world (GC mark termination)' })]
    expect(narrate(events, 101)).toContain('Stop-the-world')
  })

  it('describes a steal as a batch (P took N)', () => {
    expect(narrate([ev(50, 'g_run_start', { gid: 12, pid: 3, stolen: true })], 50)).toBe('P3 забрал 1 горутину')
  })

  it('aggregates several steals onto the same P', () => {
    const events = [
      ev(48, 'g_run_start', { gid: 10, pid: 2, stolen: true }),
      ev(49, 'g_run_start', { gid: 11, pid: 2, stolen: true }),
      ev(50, 'g_run_start', { gid: 12, pid: 2, stolen: true }),
    ]
    expect(narrate(events, 50)).toBe('P2 забрал 3 горутины')
  })

  it('describes a block with its reason', () => {
    expect(narrate([ev(50, 'g_block', { gid: 5, reason: 'chan receive' })], 50)).toBe('G5 заблокирован: chan receive')
  })

  it('ignores events outside the look-back window', () => {
    expect(narrate([ev(0, 'g_block', { gid: 5, reason: 'sync' })], 100_000_000)).toBe('')
  })
})
