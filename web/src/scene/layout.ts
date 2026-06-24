import type { WorldState } from '../player/state'
import { stationPositions, type Pt } from './iso'

// placeIso maps each live goroutine to a position in the base (460x248) world,
// following the handoff composition: running gophers stand on their P station,
// runnable ones pile in the local queue under that P (or the global queue at
// left), waiting/syscall cluster in their bottom zones. Pure → unit-tested.
// Gophers overlap (spacing < sprite width) on purpose — the cozy floor796 pile,
// resolved by depth-sort in the scene.

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const WAITING: Rect = { x: 150, y: 186, w: 152, h: 58 }
export const SYSCALL: Rect = { x: 330, y: 186, w: 120, h: 58 }
export const GLOBAL: Rect = { x: 14, y: 150, w: 44, h: 92 }
const PACK = 13

function packGrid(r: Rect, i: number, spacing: number): Pt {
  const cols = Math.max(1, Math.floor(r.w / spacing))
  return {
    x: r.x + spacing / 2 + (i % cols) * spacing,
    y: r.y + spacing / 2 + Math.floor(i / cols) * spacing,
  }
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
        out.set(gid, packGrid(SYSCALL, sysN++, PACK))
        break
      case 'waiting':
        out.set(gid, packGrid(WAITING, waitN++, PACK))
        break
      case 'runnable': {
        if (onP) {
          const i = localN[v.pid]++
          const st = stations[v.pid]
          // stack down-left toward the viewer, wrapping into left columns
          out.set(gid, { x: st.x - 4 - Math.floor(i / 5) * 11, y: st.y + 28 + (i % 5) * 11 })
        } else {
          const i = globalN++
          out.set(gid, { x: GLOBAL.x + 8 + Math.floor(i / 7) * 14, y: GLOBAL.y + 6 + (i % 7) * 12 })
        }
        break
      }
      case 'dead':
        break
    }
  }
  return out
}
