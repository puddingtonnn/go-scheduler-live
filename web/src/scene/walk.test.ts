import { describe, it, expect } from 'vitest'
import { walkKind, buildPath, walkAt, isHop, ease, type WalkConsts } from './walk'

const C: WalkConsts = { corridorY: 214, spawnGate: { x: 44, y: 44 }, exitGate: { x: 532, y: 44 } }

describe('walkKind', () => {
  it('classifies transitions and skips no-ops', () => {
    expect(walkKind(undefined, 'runnable')).toBe('spawn')
    expect(walkKind('running', 'waiting')).toBe('toWaiting')
    expect(walkKind('waiting', 'running')).toBe('toRunning')
    expect(walkKind('running', 'syscall')).toBe('toSyscall')
    expect(walkKind('running', 'dead')).toBe('toDead')
    expect(walkKind('waiting', 'dead')).toBe('toDead')
    expect(walkKind('running', 'running')).toBeNull()
  })
})

describe('buildPath', () => {
  it('routes station↔zone moves through the corridor y', () => {
    const path = buildPath({ x: 100, y: 58 }, { x: 260, y: 250 }, 'toWaiting', C)
    expect(path.pts).toHaveLength(4)
    expect(path.pts[1].y).toBe(C.corridorY) // detour waypoint sits on the corridor
    expect(path.pts[2].y).toBe(C.corridorY)
  })

  it('routes short/horizontal moves directly', () => {
    const path = buildPath({ x: 100, y: 60 }, { x: 140, y: 62 }, 'toRunnable', C)
    expect(path.pts).toHaveLength(2)
  })

  it('endpoints match from/to exactly at p=0 and p=1', () => {
    const from = { x: 100, y: 58 }
    const to = { x: 260, y: 250 }
    const path = buildPath(from, to, 'toWaiting', C)
    const a = walkAt(path, 0)
    const b = walkAt(path, 1)
    expect(a.x).toBeCloseTo(from.x)
    expect(a.y).toBeCloseTo(from.y)
    expect(b.x).toBeCloseTo(to.x)
    expect(b.y).toBeCloseTo(to.y)
  })
})

describe('walkAt', () => {
  it('advances monotonically along the path', () => {
    const path = buildPath({ x: 100, y: 58 }, { x: 260, y: 250 }, 'toWaiting', C)
    let prevD = -1
    let prev = walkAt(path, 0)
    for (let p = 0.1; p <= 1.0001; p += 0.1) {
      const s = walkAt(path, p)
      const d = Math.hypot(s.x - path.pts[0].x, s.y - path.pts[0].y) + p // strictly increasing proxy
      expect(d).toBeGreaterThan(prevD)
      prevD = d
      prev = s
    }
    expect(prev.x).toBeCloseTo(260)
  })

  it('reports facing (dx) that flips with travel direction', () => {
    const right = walkAt(buildPath({ x: 50, y: 60 }, { x: 150, y: 60 }, 'toRunnable', C), 0.5)
    const left = walkAt(buildPath({ x: 150, y: 60 }, { x: 50, y: 60 }, 'toRunnable', C), 0.5)
    expect(Math.sign(right.dx)).toBe(1)
    expect(Math.sign(left.dx)).toBe(-1)
  })
})

describe('ease', () => {
  it('is clamped and symmetric-ish', () => {
    expect(ease(0)).toBe(0)
    expect(ease(1)).toBe(1)
    expect(ease(-1)).toBe(0)
    expect(ease(2)).toBe(1)
    expect(ease(0.5)).toBeCloseTo(0.5)
  })
})

describe('isHop', () => {
  it('flags short paths and not long ones', () => {
    expect(isHop(buildPath({ x: 100, y: 60 }, { x: 120, y: 62 }, 'toRunnable', C))).toBe(true)
    expect(isHop(buildPath({ x: 100, y: 58 }, { x: 260, y: 250 }, 'toWaiting', C))).toBe(false)
  })
})
