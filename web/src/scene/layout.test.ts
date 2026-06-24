import { describe, it, expect } from 'vitest'
import { computeLayout, placeAll, type Rect } from './layout'
import { NO_RESOURCE } from '../model/timeline'
import type { GoroutineView, WorldState } from '../player/state'

function world(views: GoroutineView[]): WorldState {
  const goroutines = new Map<number, GoroutineView>()
  for (const v of views) goroutines.set(v.gid, v)
  return { t: 0, procs: [], goroutines, gcActive: [] }
}

function inRect(x: number, y: number, r: Rect): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

const geom = computeLayout(4, 1400, 800)

describe('placeAll', () => {
  it('stands a running goroutine on its lane platform', () => {
    const p = placeAll(world([{ gid: 1, state: 'running', pid: 2, stolen: false }]), geom)
    expect(p.get(1)!.x).toBeCloseTo(geom.lanes[2].platform.x)
    expect(p.get(1)!.y).toBeCloseTo(geom.lanes[2].platform.y)
  })

  it('gives two runnables on the same P distinct positions inside its lane', () => {
    const p = placeAll(
      world([
        { gid: 1, state: 'runnable', pid: 0, stolen: false },
        { gid: 2, state: 'runnable', pid: 0, stolen: false },
      ]),
      geom,
    )
    expect(p.get(1)).not.toEqual(p.get(2))
    expect(inRect(p.get(1)!.x, p.get(1)!.y, geom.lanes[0].rect)).toBe(true)
  })

  it('puts a runnable with no P in the global card', () => {
    const p = placeAll(world([{ gid: 9, state: 'runnable', pid: NO_RESOURCE, stolen: false }]), geom)
    expect(inRect(p.get(9)!.x, p.get(9)!.y, geom.global)).toBe(true)
  })

  it('places waiting and syscall in their cards and skips dead', () => {
    const p = placeAll(
      world([
        { gid: 1, state: 'waiting', pid: NO_RESOURCE, stolen: false, reason: 'chan receive' },
        { gid: 2, state: 'syscall', pid: 1, stolen: false },
        { gid: 3, state: 'dead', pid: NO_RESOURCE, stolen: false },
      ]),
      geom,
    )
    expect(inRect(p.get(1)!.x, p.get(1)!.y, geom.waiting)).toBe(true)
    expect(inRect(p.get(2)!.x, p.get(2)!.y, geom.syscall)).toBe(true)
    expect(p.has(3)).toBe(false)
  })
})
