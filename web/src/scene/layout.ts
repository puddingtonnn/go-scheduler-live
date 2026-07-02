import type { WorldState } from '../player/state'
import type { TimelineEvent } from '../model/timeline'
import { stationPositions, type Pt } from './iso'

// placeIso maps each live goroutine to a position+scale in the base (576x330)
// world, following the handoff composition: running gophers stand on their P
// station (full scale), runnable ones queue in a P's local lane, waiting/syscall
// cluster in their bottom zones (rendered smaller so a crowd stays legible). Pure
// → unit-tested.
//
// Local run-queue membership is NOT in the trace (the runnable's `pid` is just the
// last P that touched it, which clusters everything on the spawn-P), so we
// reconstruct a stable, balanced layout: a goroutine's home P is `gid % numProcs`.
// Once a P's local lane is full (CAPS.local) the surplus spills into the global
// queue — which mirrors the real runtime overflowing a full local runq to the
// global one. Anything past CAPS.global is counted and shown as a "+N" pill. This
// reconstruction is labeled as such in the chrome legend.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Placement extends Pt {
  /** sprite render scale: 1 on a platform, <1 for queue/zone crowds. */
  scale: number
}

// Bottom-zone rectangles, a clean left-to-right row [global | waiting | syscall].
export const GLOBAL: Rect = { x: 20, y: 232, w: 150, h: 90 }
export const WAITING: Rect = { x: 196, y: 232, w: 156, h: 90 }
export const SYSCALL: Rect = { x: 402, y: 232, w: 150, h: 90 }

// Per-zone render caps. Surplus goroutines are counted, not placed (see zoneTotals).
export const CAPS = { local: 6, global: 18, waiting: 18, syscall: 14 } as const

// Sprite scales by role. Crowded zones shrink so neighbours don't overlap into a
// blob (the sprite footprint is ~48x52; zone spacing below is sized to the scaled
// footprint).
const RUN_SCALE = 1
const LOCAL_SCALE = 0.82
const ZONE_SCALE = 0.55

const PACK_DX = 20
const PACK_DY = 22

// packStagger lays index i into a staggered grid filling the rect by columns,
// wrapping into half-offset rows. Sized for ZONE_SCALE sprites.
function packStagger(r: Rect, i: number): Pt {
  const cols = Math.max(1, Math.floor((r.w - 8) / PACK_DX))
  const row = Math.floor(i / cols)
  const col = i % cols
  return {
    x: r.x + 12 + col * PACK_DX + (row % 2) * (PACK_DX / 2),
    y: r.y + 14 + row * PACK_DY,
  }
}

// localPos stacks a P's local run-queue toward the viewer (below the platform),
// two abreast with a half-step stagger per row.
function localPos(st: Pt, i: number): Pt {
  const col = i % 2
  const row = Math.floor(i / 2)
  return { x: st.x - 7 + col * 14 + (row % 2) * 7, y: st.y + 38 + row * 12 }
}

export interface ZoneTotals {
  /** runnables homed to each P local queue (index = pid), uncapped. */
  local: number[]
  /** runnables spilled to the global queue (local lanes full). */
  global: number
  waiting: number
  syscall: number
}

// homeP is the reconstructed local-queue owner of a runnable goroutine: a stable,
// balanced assignment independent of the unreliable last-touched `pid`.
function homeP(gid: number, numProcs: number): number {
  return ((gid % numProcs) + numProcs) % numProcs
}

// zoneTotals counts goroutines per zone the same way placeIso buckets them, so the
// chrome can show how many are hidden beyond the render caps. Pure.
export function zoneTotals(world: WorldState, numProcs: number): ZoneTotals {
  const homed = Array.from({ length: numProcs }, () => 0)
  let waiting = 0
  let syscall = 0
  for (const v of world.goroutines.values()) {
    if (v.state === 'waiting') waiting++
    else if (v.state === 'syscall') syscall++
    else if (v.state === 'runnable') homed[homeP(v.gid, numProcs)]++
  }
  // Drawn in each P's lane is capped; the surplus spills to the global queue.
  const local = homed.map((n) => Math.min(n, CAPS.local))
  const global = homed.reduce((s, n) => s + Math.max(0, n - CAPS.local), 0)
  return { local, global, waiting, syscall }
}

// midAliases maps every real thread id in the trace to a small display ordinal
// (1, 2, 3… in first-seen order). Real ThreadIDs on darwin are huge mach ids
// (e.g. 6103904256) that would never fit a sprite tag; the ordinal is a stable
// per-run alias, and the tooltip still reports the real id. Pure.
export function midAliases(events: TimelineEvent[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const e of events) {
    if (e.mid >= 0 && !out.has(e.mid)) out.set(e.mid, out.size + 1)
  }
  return out
}

// M (OS thread) placement offsets relative to its anchor.
export const THREAD_ST_DX = 13 // front-right of the P platform, clear of the gopher
export const THREAD_ST_DY = 7
export const THREAD_SYS_DY = 6 // just below a syscall gopher's feet

// placeThreads maps each *visible* M to a position: with the syscall gopher it
// is blocked under (same spot, so they travel together), or docked at the P
// station it owns. Parked Ms have no trace events and are honestly absent.
// Takes the already-computed placeIso result so a syscall M lands exactly on
// its gopher. During the brief _Psyscall gap one M can be both "in syscall"
// and still own the P — the syscall side wins (one M, one sprite). Pure.
export function placeThreads(
  world: WorldState,
  numProcs: number,
  gophers: Map<number, Placement>,
): Map<number, Placement> {
  const out = new Map<number, Placement>()
  const stations = stationPositions(numProcs)

  const gids = [...world.goroutines.keys()].sort((a, b) => a - b)
  for (const gid of gids) {
    const v = world.goroutines.get(gid)!
    if (v.state !== 'syscall' || v.mid < 0) continue
    const g = gophers.get(gid)
    if (!g) continue // gopher beyond CAPS.syscall — the "+N" badge covers its M too
    out.set(v.mid, { x: g.x, y: g.y + THREAD_SYS_DY * g.scale, scale: g.scale })
  }

  for (const p of world.procs) {
    if (p.mid < 0 || out.has(p.mid)) continue
    const st = stations[p.pid]
    if (!st) continue
    // Docked whether or not a G is running: "an M parked on its P looking for
    // work" is real, and it makes the syscall handoff readable.
    out.set(p.mid, { x: st.x + THREAD_ST_DX, y: st.y + THREAD_ST_DY, scale: 1 })
  }
  return out
}

export function placeIso(world: WorldState, numProcs: number): Map<number, Placement> {
  const out = new Map<number, Placement>()
  const stations = stationPositions(numProcs)
  const localN = stations.map(() => 0)
  let globalN = 0
  let waitN = 0
  let sysN = 0

  const gids = [...world.goroutines.keys()].sort((a, b) => a - b)
  for (const gid of gids) {
    const v = world.goroutines.get(gid)!
    switch (v.state) {
      case 'running': {
        const onP = v.pid >= 0 && v.pid < stations.length
        const st = onP ? stations[v.pid] : stations[0]
        out.set(gid, { x: st.x, y: st.y, scale: RUN_SCALE })
        break
      }
      case 'syscall':
        if (sysN < CAPS.syscall) out.set(gid, { ...packStagger(SYSCALL, sysN), scale: ZONE_SCALE })
        sysN++
        break
      case 'waiting':
        if (waitN < CAPS.waiting) out.set(gid, { ...packStagger(WAITING, waitN), scale: ZONE_SCALE })
        waitN++
        break
      case 'runnable': {
        const p = homeP(gid, stations.length)
        if (localN[p] < CAPS.local) {
          out.set(gid, { ...localPos(stations[p], localN[p]), scale: LOCAL_SCALE })
          localN[p]++
        } else if (globalN < CAPS.global) {
          // local runq full → spill to the global queue (real runtime behaviour).
          out.set(gid, { ...packStagger(GLOBAL, globalN), scale: ZONE_SCALE })
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
