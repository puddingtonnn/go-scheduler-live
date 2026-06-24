import { describe, it, expect } from 'vitest'
import { placeIso, WAITING, SYSCALL } from './layout'
import { stationPositions } from './iso'
import { NO_RESOURCE } from '../model/timeline'
import type { GoroutineView, WorldState } from '../player/state'

function world(views: GoroutineView[]): WorldState {
  const goroutines = new Map<number, GoroutineView>()
  for (const v of views) goroutines.set(v.gid, v)
  return { t: 0, procs: [], goroutines, gcActive: [] }
}

function inRect(p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
}

describe('placeIso', () => {
  it('stands a running goroutine on its station', () => {
    const st = stationPositions(4)[2]
    const p = placeIso(world([{ gid: 1, state: 'running', pid: 2, stolen: false }]), 4)
    expect(p.get(1)).toEqual({ x: st.x, y: st.y })
  })

  it('stacks two runnables of the same P at distinct spots below it', () => {
    const p = placeIso(
      world([
        { gid: 1, state: 'runnable', pid: 0, stolen: false },
        { gid: 2, state: 'runnable', pid: 0, stolen: false },
      ]),
      4,
    )
    const st = stationPositions(4)[0]
    expect(p.get(1)).not.toEqual(p.get(2))
    expect(p.get(1)!.y).toBeGreaterThan(st.y) // toward the viewer
  })

  it('places waiting and syscall in their zones, skips dead', () => {
    const p = placeIso(
      world([
        { gid: 1, state: 'waiting', pid: NO_RESOURCE, stolen: false, reason: 'chan receive' },
        { gid: 2, state: 'syscall', pid: 1, stolen: false },
        { gid: 3, state: 'dead', pid: NO_RESOURCE, stolen: false },
      ]),
      4,
    )
    expect(inRect(p.get(1)!, WAITING)).toBe(true)
    expect(inRect(p.get(2)!, SYSCALL)).toBe(true)
    expect(p.has(3)).toBe(false)
  })
})
