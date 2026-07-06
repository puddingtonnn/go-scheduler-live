import { describe, it, expect } from 'vitest'
import { fitView, clampView, zoomAt, panBy, type ViewBounds } from './viewport'

// A canvas twice the world's aspect: width fits with slack, height is exact.
const B: ViewBounds = { worldW: 100, worldH: 50, viewW: 300, viewH: 100, baseScale: 2, maxZoom: 6 }

describe('viewport math', () => {
  it('fitView centers the world at the base scale', () => {
    expect(fitView(B)).toEqual({ scale: 2, x: 50, y: 0 })
  })

  it('never zooms below fit or above maxZoom', () => {
    expect(zoomAt(fitView(B), B, 0, 0, 0.5).scale).toBe(2)
    const v = zoomAt(fitView(B), B, 0, 0, 1e9)
    expect(v.scale).toBe(12) // baseScale * maxZoom
  })

  it('keeps the world point under the cursor while zooming', () => {
    const v0 = fitView(B)
    const mx = 150
    const my = 60
    const before = { wx: (mx - v0.x) / v0.scale, wy: (my - v0.y) / v0.scale }
    const v1 = zoomAt(v0, B, mx, my, 2)
    expect((mx - v1.x) / v1.scale).toBeCloseTo(before.wx)
    expect((my - v1.y) / v1.scale).toBeCloseTo(before.wy)
  })

  it('clamps panning to the world edges when zoomed in', () => {
    const v = zoomAt(fitView(B), B, 150, 50, 3) // scale 6, world 600x300 vs view 300x100
    expect(panBy(v, B, 1e6, 1e6)).toMatchObject({ x: 0, y: 0 })
    expect(panBy(v, B, -1e6, -1e6)).toMatchObject({ x: 300 - 600, y: 100 - 300 })
  })

  it('re-centers an axis that fits after clamping', () => {
    // At fit, width has slack: x must stay centered no matter the pan.
    expect(panBy(fitView(B), B, 500, 0).x).toBe(50)
  })

  it('clampView also snaps a too-small scale back to fit', () => {
    expect(clampView({ scale: 0.1, x: -50, y: -50 }, B)).toEqual({ scale: 2, x: 50, y: 0 })
  })
})
