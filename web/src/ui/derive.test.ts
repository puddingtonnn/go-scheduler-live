import { describe, it, expect } from 'vitest'
import { gcPhase, heapPct, waitingBreakdown } from './derive'
import type { GoroutineView, WorldState } from '../player/state'
import { PAL } from '../scene/palette'

function world(partial: Partial<WorldState>): WorldState {
  return { t: 0, procs: [], goroutines: new Map(), gcActive: [], ...partial }
}

// waiters builds a world with one waiting goroutine per reason, plus a running
// one (gid 900) that the breakdown must ignore.
function waiters(reasons: (string | undefined)[]): WorldState {
  const goroutines = new Map<number, GoroutineView>()
  reasons.forEach((reason, i) => goroutines.set(i, { gid: i, state: 'waiting', pid: -1, stolen: false, reason }))
  goroutines.set(900, { gid: 900, state: 'running', pid: 0, stolen: false })
  return world({ goroutines })
}

describe('gcPhase', () => {
  it('is idle when no GC ranges are active', () => {
    const p = gcPhase(world({ gcActive: [] }))
    expect(p.kind).toBe('idle')
    expect(p.label).toBe('GC: простой')
    expect(p.color).toBe(PAL.gcIdle)
  })

  it('is mark when a mark phase is active', () => {
    const p = gcPhase(world({ gcActive: ['mark phase'] }))
    expect(p.kind).toBe('mark')
    expect(p.label).toBe('GC: парал. маркировка')
    expect(p.color).toBe(PAL.teal)
  })

  it('is stw when stop-the-world is active (priority over mark)', () => {
    const p = gcPhase(world({ gcActive: ['mark phase', 'stop-the-world'] }))
    expect(p.kind).toBe('stw')
    expect(p.label).toBe('GC: stop-the-world')
    expect(p.color).toBe(PAL.gcStw)
  })
})

describe('heapPct', () => {
  it('is null without heap data', () => {
    expect(heapPct(world({}))).toBeNull()
    expect(heapPct(world({ heapLive: 100 }))).toBeNull() // goal missing
    expect(heapPct(world({ heapGoal: 100 }))).toBeNull() // live missing
  })

  it('is the live/goal ratio', () => {
    expect(heapPct(world({ heapLive: 40, heapGoal: 100 }))).toBeCloseTo(0.4)
  })

  it('clamps to [0,1]', () => {
    expect(heapPct(world({ heapLive: 250, heapGoal: 100 }))).toBe(1)
    expect(heapPct(world({ heapLive: -5, heapGoal: 100 }))).toBe(0)
  })

  it('is null when goal is zero (no divide-by-zero)', () => {
    expect(heapPct(world({ heapLive: 10, heapGoal: 0 }))).toBeNull()
  })
})

describe('waitingBreakdown', () => {
  it('is empty when nobody is waiting', () => {
    expect(waitingBreakdown(world({}))).toEqual([])
  })

  it('groups waiters by reason category, nonzero only, in canonical order', () => {
    const w = waiters(['chan receive', 'sleep', 'chan send', 'sync.Mutex.Lock'])
    expect(waitingBreakdown(w)).toEqual([
      { category: 'канал', count: 2 },
      { category: 'сон', count: 1 },
      { category: 'sync', count: 1 },
    ])
  })

  it('ignores non-waiting goroutines', () => {
    expect(waitingBreakdown(waiters(['chan receive']))).toEqual([{ category: 'канал', count: 1 }])
  })
})
