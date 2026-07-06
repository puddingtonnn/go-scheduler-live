// Viewport math for the floor796-style zoom/pan: pure functions over a simple
// {scale, x, y} view so the gesture handling in scene.ts stays a thin shell.
// scale is absolute (world px -> screen px); zoom is expressed relative to the
// fit scale computed from the canvas size.

export interface View {
  scale: number
  x: number
  y: number
}

export interface ViewBounds {
  worldW: number
  worldH: number
  viewW: number
  viewH: number
  /** scale at which the whole world exactly fits (zoom == 1). */
  baseScale: number
  /** max zoom factor relative to baseScale. */
  maxZoom: number
}

export function fitView(b: ViewBounds): View {
  return clampView({ scale: b.baseScale, x: 0, y: 0 }, b)
}

// clampView keeps the world glued to the viewport: an axis that fits is
// centered (no panning it away); an axis that overflows may pan, but never
// past the world's edges.
export function clampView(v: View, b: ViewBounds): View {
  const s = Math.min(Math.max(v.scale, b.baseScale), b.baseScale * b.maxZoom)
  const clampAxis = (pos: number, world: number, view: number): number => {
    if (world <= view) return (view - world) / 2
    return Math.min(0, Math.max(view - world, pos))
  }
  return {
    scale: s,
    x: clampAxis(v.x, b.worldW * s, b.viewW),
    y: clampAxis(v.y, b.worldH * s, b.viewH),
  }
}

// zoomAt scales around the screen point (mx,my): the world point under the
// cursor stays under the cursor (the floor796 feel).
export function zoomAt(v: View, b: ViewBounds, mx: number, my: number, factor: number): View {
  const s = Math.min(Math.max(v.scale * factor, b.baseScale), b.baseScale * b.maxZoom)
  if (s === v.scale) return clampView(v, b)
  const wx = (mx - v.x) / v.scale
  const wy = (my - v.y) / v.scale
  return clampView({ scale: s, x: mx - wx * s, y: my - wy * s }, b)
}

export function panBy(v: View, b: ViewBounds, dx: number, dy: number): View {
  return clampView({ scale: v.scale, x: v.x + dx, y: v.y + dy }, b)
}
