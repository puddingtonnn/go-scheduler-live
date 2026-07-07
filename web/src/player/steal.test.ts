import { describe, it, expect } from 'vitest'
import { stealBurst, stealMarks, pluralGor } from './steal'
import { NO_RESOURCE, type TimelineEvent } from '../model/timeline'

function ev(t: number, type: TimelineEvent['type'], extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return { t, type, gid: NO_RESOURCE, pid: NO_RESOURCE, mid: NO_RESOURCE, ...extra }
}

describe('stealBurst', () => {
  it('returns null when there are no steals in the window', () => {
    expect(stealBurst([ev(10, 'g_run_start', { gid: 1, pid: 0 })], 10, 100)).toBeNull()
  })

  it('counts stolen run-starts per destination P and returns the largest burst', () => {
    const events = [
      ev(10, 'g_run_start', { gid: 1, pid: 2, stolen: true }),
      ev(11, 'g_run_start', { gid: 2, pid: 2, stolen: true }),
      ev(12, 'g_run_start', { gid: 3, pid: 2, stolen: true }),
      ev(13, 'g_run_start', { gid: 4, pid: 1, stolen: true }),
    ]
    expect(stealBurst(events, 20, 100)).toEqual({ pid: 2, count: 3 })
  })

  it('ignores steals outside the look-back window and non-stolen starts', () => {
    const events = [
      ev(1, 'g_run_start', { gid: 1, pid: 2, stolen: true }), // too old
      ev(95, 'g_run_start', { gid: 2, pid: 2 }), // not stolen
    ]
    expect(stealBurst(events, 100, 50)).toBeNull()
  })
})

describe('stealMarks', () => {
  it('folds two stolen starts within the window on one P into a single mark', () => {
    const events = [
      ev(1000, 'g_run_start', { gid: 1, pid: 3, stolen: true }),
      ev(1000 + 500, 'g_run_start', { gid: 2, pid: 3, stolen: true }),
    ]
    expect(stealMarks(events, 1000)).toEqual([{ tNs: 1000, pid: 3, count: 2 }])
  })

  it('splits stolen starts beyond the window into separate marks', () => {
    const events = [
      ev(1000, 'g_run_start', { gid: 1, pid: 3, stolen: true }),
      ev(1000 + 3000, 'g_run_start', { gid: 2, pid: 3, stolen: true }),
    ]
    expect(stealMarks(events, 1000)).toEqual([
      { tNs: 1000, pid: 3, count: 1 },
      { tNs: 4000, pid: 3, count: 1 },
    ])
  })

  it('keeps bursts on different Ps independent and ignores non-stolen starts', () => {
    const events = [
      ev(1000, 'g_run_start', { gid: 1, pid: 0, stolen: true }),
      ev(1100, 'g_run_start', { gid: 2, pid: 1, stolen: true }),
      ev(1200, 'g_run_start', { gid: 3, pid: 0, stolen: true }),
      ev(1300, 'g_run_start', { gid: 4, pid: 0 }), // not stolen — ignored
    ]
    expect(stealMarks(events, 1000)).toEqual([
      { tNs: 1000, pid: 0, count: 2 },
      { tNs: 1100, pid: 1, count: 1 },
    ])
  })
})

describe('pluralGor', () => {
  it('declines горутина correctly', () => {
    expect(pluralGor(1)).toBe('горутину')
    expect(pluralGor(2)).toBe('горутины')
    expect(pluralGor(4)).toBe('горутины')
    expect(pluralGor(5)).toBe('горутин')
    expect(pluralGor(11)).toBe('горутин')
    expect(pluralGor(21)).toBe('горутину')
    expect(pluralGor(22)).toBe('горутины')
    expect(pluralGor(25)).toBe('горутин')
  })
})
