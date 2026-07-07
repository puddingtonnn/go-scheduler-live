import type { GState } from '../player/state'
import type { Pt } from './iso'

// Pure path math for the data-driven walk system (opt-in via ?walk). When a real
// goroutine transition happens on a playback step, the scene routes the gopher along
// a corridor from its old spot to the new zone anchor instead of cutting a straight
// diagonal through the props. The transition is REAL; the walk tween is cosmetic
// (wall-clock paced, capped), disclosed as animation. Everything here is pure so the
// routing/easing/facing is unit-tested; the Pixi glue lives in scene.ts.

export type WalkKind = 'toRunning' | 'toRunnable' | 'toWaiting' | 'toSyscall' | 'toDead' | 'spawn'

export interface WalkConsts {
  /** the horizontal corridor y between the P stations (top) and the zones (bottom). */
  corridorY: number
  spawnGate: Pt
  exitGate: Pt
}

export interface WalkPath {
  pts: Pt[]
  segs: number[]
  len: number
}

export interface WalkSample {
  x: number
  y: number
  /** x-direction of the current segment, for facing (sign only). */
  dx: number
}

// walkKind classifies a (prev → next) state transition, or null if it doesn't
// warrant a routed walk (unchanged state, or a state we don't route to).
export function walkKind(prev: GState | undefined, next: GState): WalkKind | null {
  if (next === 'dead') return 'toDead'
  if (prev === undefined) return 'spawn'
  if (prev === next) return null
  switch (next) {
    case 'running':
      return 'toRunning'
    case 'runnable':
      return 'toRunnable'
    case 'waiting':
      return 'toWaiting'
    case 'syscall':
      return 'toSyscall'
    default:
      return null
  }
}

function makePath(pts: Pt[]): WalkPath {
  const segs: number[] = []
  let len = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y)
    segs.push(d)
    len += d
  }
  return { pts, segs, len }
}

// SHORT_DY: a move whose vertical span is under this is treated as (roughly)
// horizontal and routed directly, so short shuffles don't detour to the corridor.
const SHORT_DY = 44

// buildPath routes from→to for a walk kind. Station↔zone moves detour through the
// corridor so the gopher doesn't clip the heap/props; short moves go direct.
export function buildPath(from: Pt, to: Pt, kind: WalkKind, c: WalkConsts): WalkPath {
  if (kind === 'toDead') {
    return makePath([from, { x: from.x, y: c.corridorY }, { x: c.exitGate.x, y: c.corridorY }, c.exitGate])
  }
  if (kind === 'spawn') {
    return makePath([c.spawnGate, { x: to.x, y: c.corridorY }, to])
  }
  if (Math.abs(to.y - from.y) < SHORT_DY) return makePath([from, to])
  return makePath([from, { x: from.x, y: c.corridorY }, { x: to.x, y: c.corridorY }, to])
}

// ease is the mockup's ease-in-out (accelerate, then settle) so walks start and
// land softly instead of snapping.
export function ease(k: number): number {
  const x = Math.max(0, Math.min(1, k))
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

// walkAt samples the eased position along the path at linear progress p∈[0,1].
export function walkAt(path: WalkPath, p: number): WalkSample {
  const pts = path.pts
  if (pts.length === 0) return { x: 0, y: 0, dx: 0 }
  if (path.len <= 0) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, dx: 0 }
  let dist = ease(p) * path.len
  let i = 0
  while (i < path.segs.length - 1 && dist > path.segs[i]) {
    dist -= path.segs[i]
    i++
  }
  const a = pts[i]
  const b = pts[i + 1]
  const f = path.segs[i] > 0 ? dist / path.segs[i] : 0
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: b.x - a.x }
}

const HOP_LEN = 46

// isHop marks a short walk that reads better as a little hop-arc than a stroll.
export function isHop(path: WalkPath): boolean {
  return path.len > 0 && path.len < HOP_LEN
}
