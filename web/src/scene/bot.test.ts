import { describe, it, expect } from 'vitest'
import { botTarget, SWEEP_BOUNDS } from './bot'

const heap = { x: 288, y: 172 }
const dock = { x: 340, y: 190 }

describe('botTarget', () => {
  it('parks at the dock when no mark is active', () => {
    expect(botTarget(false, 0, heap, dock)).toEqual({ x: 340, y: 190, sweeping: false })
    expect(botTarget(false, 99, heap, dock)).toEqual({ x: 340, y: 190, sweeping: false })
  })

  it('sweeps within the heap bounds when a mark is active', () => {
    for (let animT = 0; animT < 4; animT += 0.3) {
      const s = botTarget(true, animT, heap, dock)
      expect(s.sweeping).toBe(true)
      expect(Math.abs(s.x - heap.x)).toBeLessThanOrEqual(SWEEP_BOUNDS.dx)
      expect(Math.abs(s.y - heap.y)).toBeLessThanOrEqual(SWEEP_BOUNDS.dy)
    }
  })

  it('cycles through distinct sweep spots as animT advances', () => {
    const a = botTarget(true, 0, heap, dock)
    const b = botTarget(true, 1 / 1.5 + 0.01, heap, dock) // next spot (~1.5 spots/sec)
    expect(a).not.toEqual(b)
  })
})
