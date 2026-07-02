import { describe, it, expect } from 'vitest'
import { nearestRun } from './api'

const runs = [
  { scenario: 'workstealing', gomaxprocs: 1, goroutines: 50, file: 'a' },
  { scenario: 'workstealing', gomaxprocs: 4, goroutines: 50, file: 'b' },
  { scenario: 'workstealing', gomaxprocs: 8, goroutines: 50, file: 'c' },
  { scenario: 'mutex', gomaxprocs: 4, goroutines: 12, file: 'd' },
]

describe('nearestRun (static demo)', () => {
  it('returns the exact match when present', () => {
    expect(nearestRun(runs, { scenario: 'workstealing', gomaxprocs: 4, goroutines: 50 })?.file).toBe('b')
  })

  it('snaps to the nearest gomaxprocs', () => {
    expect(nearestRun(runs, { scenario: 'workstealing', gomaxprocs: 7, goroutines: 50 })?.file).toBe('c')
    expect(nearestRun(runs, { scenario: 'workstealing', gomaxprocs: 2, goroutines: 50 })?.file).toBe('a')
  })

  it('gomaxprocs dominates goroutines distance', () => {
    expect(nearestRun(runs, { scenario: 'workstealing', gomaxprocs: 1, goroutines: 500 })?.file).toBe('a')
  })

  it('omitted params match anything; unknown scenario matches nothing', () => {
    expect(nearestRun(runs, { scenario: 'mutex' })?.file).toBe('d')
    expect(nearestRun(runs, { scenario: 'nope' })).toBeUndefined()
  })
})
