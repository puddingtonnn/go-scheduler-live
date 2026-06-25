import type { WorldState } from '../player/state'
import { stationPositions, type Pt } from './iso'

// placeIso maps each live goroutine to a position in the base (576x330) world,
// following the v2 handoff composition: running gophers sit on their P station,
// runnable ones grid-pack in the local queue under that P (or the global queue at
// left), waiting/syscall cluster in their bottom zones. Pure → unit-tested.
//
// Each zone renders at most CAP gophers in a clean staggered grid; the surplus is
// counted (see zoneTotals) and surfaced as a "+N" pill by the chrome, so a queue
// of 50 stays legible instead of overflowing the world. This matters because all
// goroutines spawned by one goroutine land on the same P's local runq (the real
// runtime's behavior) until work-stealing drains them.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// Bottom-zone rectangles, a clean left-to-right row [global | waiting | syscall]
// (staggered grids pack within these; chrome anchors its labels to them). The
// global run queue lives here rather than at the far left so it never collides
// with P0's local queue (where one goroutine's whole spawn lands). Sized for the
// 576x330 base world.
export const GLOBAL: Rect = { x: 20, y: 230, w: 158, h: 92 }
export const WAITING: Rect = { x: 198, y: 230, w: 150, h: 92 }
export const SYSCALL: Rect = { x: 392, y: 230, w: 150, h: 92 }

// Per-zone render caps. Surplus goroutines are counted, not placed (see zoneTotals).
export const CAPS = { local: 10, global: 16, waiting: 18, syscall: 14 } as const

const PACK_DX = 18
const PACK_DY = 15

// packStagger lays index i into a staggered grid filling the rect by columns,
// wrapping into half-offset rows.
function packStagger(r: Rect, i: number): Pt {
  const cols = Math.max(1, Math.floor((r.w - 9) / PACK_DX))
  const row = Math.floor(i / cols)
  const col = i % cols
  return {
    x: r.x + 8 + col * PACK_DX + (row % 2) * (PACK_DX / 2),
    y: r.y + 10 + row * PACK_DY,
  }
}

// localPos stacks a P's local run-queue toward the viewer (below the platform),
// two abreast with a half-step stagger per row.
function localPos(st: Pt, i: number): Pt {
  const col = i % 2
  const row = Math.floor(i / 2)
  return { x: st.x - 7 + col * 14 + (row % 2) * 7, y: st.y + 40 + row * 13 }
}

export interface ZoneTotals {
  /** runnable count per P local queue (index = pid). */
  local: number[]
  global: number
  waiting: number
  syscall: number
}

// zoneTotals counts goroutines per zone (uncapped) so the chrome can show how
// many are hidden beyond the render caps. Pure; mirrors placeIso's bucketing.
export function zoneTotals(world: WorldState, numProcs: number): ZoneTotals {
  const local = Array.from({ length: numProcs }, () => 0)
  let global = 0
  let waiting = 0
  let syscall = 0
  for (const v of world.goroutines.values()) {
    const onP = v.pid >= 0 && v.pid < numProcs
    if (v.state === 'waiting') waiting++
    else if (v.state === 'syscall') syscall++
    else if (v.state === 'runnable') {
      if (onP) local[v.pid]++
      else global++
    }
  }
  return { local, global, waiting, syscall }
}

export function placeIso(world: WorldState, numProcs: number): Map<number, Pt> {
  const out = new Map<number, Pt>()
  const stations = stationPositions(numProcs)
  const localN = stations.map(() => 0)
  let globalN = 0
  let waitN = 0
  let sysN = 0

  const gids = [...world.goroutines.keys()].sort((a, b) => a - b)
  for (const gid of gids) {
    const v = world.goroutines.get(gid)!
    const onP = v.pid >= 0 && v.pid < stations.length
    switch (v.state) {
      case 'running': {
        const st = onP ? stations[v.pid] : stations[0]
        out.set(gid, { x: st.x, y: st.y })
        break
      }
      case 'syscall':
        if (sysN < CAPS.syscall) out.set(gid, packStagger(SYSCALL, sysN))
        sysN++
        break
      case 'waiting':
        if (waitN < CAPS.waiting) out.set(gid, packStagger(WAITING, waitN))
        waitN++
        break
      case 'runnable': {
        if (onP) {
          const i = localN[v.pid]++
          if (i < CAPS.local) out.set(gid, localPos(stations[v.pid], i))
        } else {
          if (globalN < CAPS.global) out.set(gid, packStagger(GLOBAL, globalN))
          globalN++
        }
        break
      }
      case 'dead':
        break
    }
  }
  return out
}
