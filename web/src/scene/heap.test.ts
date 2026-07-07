import { describe, it, expect } from 'vitest'
import { heapTileCount, heapTileOrder } from './heap'

describe('heapTileCount', () => {
  it('maps empty→2 and full→9', () => {
    expect(heapTileCount(0)).toBe(2)
    expect(heapTileCount(1)).toBe(9)
  })
  it('clamps out-of-range fractions', () => {
    expect(heapTileCount(-0.5)).toBe(2)
    expect(heapTileCount(2)).toBe(9)
  })
  it('is monotonic non-decreasing across the range', () => {
    let prev = -1
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const n = heapTileCount(p)
      expect(n).toBeGreaterThanOrEqual(prev)
      prev = n
    }
  })
})

describe('heapTileOrder', () => {
  it('lists 9 unique cells', () => {
    const cells = heapTileOrder()
    expect(cells).toHaveLength(9)
    const keys = new Set(cells.map(([x, y]) => `${x},${y}`))
    expect(keys.size).toBe(9)
  })
})
