import { describe, it, expect } from 'vitest'
import { bucketOfTime, bucketCounts, eventDensity, timeOfFrac } from './histogram'
import { NO_RESOURCE, type TimelineEvent } from '../model/timeline'

function ev(t: number, type: TimelineEvent['type'] = 'g_run_start'): TimelineEvent {
  return { t, type, gid: NO_RESOURCE, pid: NO_RESOURCE, mid: NO_RESOURCE }
}

describe('bucketOfTime', () => {
  it('maps boundary times to the right bucket', () => {
    expect(bucketOfTime(0, 4, 100)).toBe(0)
    expect(bucketOfTime(24.999, 4, 100)).toBe(0)
    expect(bucketOfTime(25, 4, 100)).toBe(1)
    expect(bucketOfTime(99, 4, 100)).toBe(3)
    expect(bucketOfTime(100, 4, 100)).toBe(3) // clamped, not out of range
  })
  it('is safe for degenerate inputs', () => {
    expect(bucketOfTime(50, 0, 100)).toBe(0)
    expect(bucketOfTime(50, 4, 0)).toBe(0)
  })
})

describe('bucketCounts', () => {
  it('sums to the number of non-metric events', () => {
    const events = [ev(5), ev(30), ev(30, 'g_block'), ev(80), ev(90, 'metric')]
    const counts = bucketCounts(events, 4, 100)
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4) // the metric is excluded
    expect(counts).toEqual([1, 2, 0, 1])
  })
  it('returns a zeroed array for an empty/zero-duration timeline', () => {
    expect(bucketCounts([], 4, 100)).toEqual([0, 0, 0, 0])
    expect(bucketCounts([ev(5)], 4, 0)).toEqual([0, 0, 0, 0])
  })
})

describe('eventDensity', () => {
  it('normalizes to [0,1] with the busiest bucket at 1', () => {
    const d = eventDensity([ev(5), ev(30), ev(30), ev(80)], 4, 100)
    expect(Math.max(...d)).toBe(1)
    expect(d.every((v) => v >= 0 && v <= 1)).toBe(true)
    expect(d).toEqual([0.5, 1, 0, 0.5])
  })
  it('is all-zero when there are no non-metric events', () => {
    expect(eventDensity([ev(5, 'metric')], 4, 100)).toEqual([0, 0, 0, 0])
  })
})

describe('timeOfFrac', () => {
  it('maps a fraction to a clamped trace time', () => {
    expect(timeOfFrac(0, 100)).toBe(0)
    expect(timeOfFrac(0.6, 100)).toBe(60)
    expect(timeOfFrac(1, 100)).toBe(100)
    expect(timeOfFrac(1.5, 100)).toBe(100)
    expect(timeOfFrac(-0.2, 100)).toBe(0)
  })
})
