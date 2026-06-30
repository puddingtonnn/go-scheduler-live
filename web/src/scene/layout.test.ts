import { describe, it, expect } from 'vitest'
import { placeIso, zoneTotals, WAITING, SYSCALL, GLOBAL, CAPS } from './layout'
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

function runnables(n: number, pid: number): GoroutineView[] {
  return Array.from({ length: n }, (_, i) => ({ gid: i + 1, state: 'runnable' as const, pid, stolen: false }))
}

describe('placeIso', () => {
  it('stands a running goroutine on its station at full scale', () => {
    const st = stationPositions(4)[2]
    const p = placeIso(world([{ gid: 1, state: 'running', pid: 2, stolen: false }]), 4)
    expect(p.get(1)).toEqual({ x: st.x, y: st.y, scale: 1 })
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

  it('distributes many runnables across all P local queues (no single pile)', () => {
    // 8 runnables all reporting pid 0 must still spread across the 4 stations,
    // not pile under P0 — local-queue membership is reconstructed, so we balance.
    const p = placeIso(world(runnables(8, 0)), 4)
    const stationXs = new Set(stationPositions(4).map((s) => s.x))
    const usedColumns = new Set<number>()
    for (const gid of [1, 2, 3, 4, 5, 6, 7, 8]) {
      // each placement sits near a station x (local lane is offset a few px)
      const px = p.get(gid)!.x
      const nearest = [...stationXs].reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a))
      usedColumns.add(nearest)
    }
    expect(usedColumns.size).toBe(4) // all four Ps got a local queue
  })

  it('overflows runnables beyond local caps into the global queue', () => {
    const total = CAPS.local * 4 + 5
    const p = placeIso(world(runnables(total, NO_RESOURCE)), 4)
    const inGlobal = [...p.values()].filter((q) => inRect(q, GLOBAL))
    expect(inGlobal.length).toBeGreaterThan(0)
  })

  it('renders zone (waiting/syscall) gophers at reduced scale so they do not overlap', () => {
    const p = placeIso(
      world([
        { gid: 1, state: 'waiting', pid: NO_RESOURCE, stolen: false, reason: 'chan receive' },
        { gid: 2, state: 'syscall', pid: 1, stolen: false },
      ]),
      4,
    )
    expect(inRect(p.get(1)!, WAITING)).toBe(true)
    expect(inRect(p.get(2)!, SYSCALL)).toBe(true)
    expect(p.get(1)!.scale).toBeLessThan(1)
    expect(p.get(2)!.scale).toBeLessThan(1)
  })

  it('skips dead goroutines', () => {
    const p = placeIso(world([{ gid: 3, state: 'dead', pid: NO_RESOURCE, stolen: false }]), 4)
    expect(p.has(3)).toBe(false)
  })

  it('homes all runnables to P0 when numProcs=1, spilling past the cap to global', () => {
    const p = placeIso(world(runnables(CAPS.local + 3, NO_RESOURCE)), 1)
    const st = stationPositions(1)[0]
    const local = [...p.values()].filter((q) => Math.abs(q.x - st.x) < 16 && q.scale > 0.6)
    const inGlobal = [...p.values()].filter((q) => inRect(q, GLOBAL))
    expect(local.length).toBe(CAPS.local) // P0 lane fills to the cap
    expect(inGlobal.length).toBe(3) // the rest spill to the global queue
  })
})

describe('zoneTotals', () => {
  it('counts runnables across local queues consistently with placeIso balancing', () => {
    const tot = zoneTotals(world(runnables(8, 0)), 4)
    // balanced round-robin → 2 per P, nothing dumped on the global queue
    expect(tot.local.reduce((a, b) => a + b, 0)).toBe(8)
    expect(tot.global).toBe(0)
  })

  it('counts waiting and syscall', () => {
    const tot = zoneTotals(
      world([
        { gid: 1, state: 'waiting', pid: -1, stolen: false },
        { gid: 2, state: 'waiting', pid: -1, stolen: false },
        { gid: 3, state: 'syscall', pid: 0, stolen: false },
      ]),
      4,
    )
    expect(tot.waiting).toBe(2)
    expect(tot.syscall).toBe(1)
  })
})
