import { Graphics } from 'pixi.js'
import { PAL } from './palette'

// Isometric world geometry, ported from the v2 design handoff reference
// (tile / pStation / floor grid, drawScene composition coords). Everything is
// laid out in a fixed "base" world (576x330); the scene scales this container to
// fit the canvas, so these numbers match the reference 1:1. The smaller gopher
// relative to this larger world leaves room for id tags above heads and lets the
// zones grid-pack many goroutines.

export const TILE_W = 26
export const TILE_H = 13
export const WORLD_W = 576
export const WORLD_H = 330
export const FLOOR_OX = WORLD_W / 2
export const FLOOR_OY = 8

export interface Pt {
  x: number
  y: number
}

// iso projects a grid cell (gx, gy) to world coords on the floor plane.
export function iso(gx: number, gy: number): Pt {
  return { x: FLOOR_OX + ((gx - gy) * TILE_W) / 2, y: FLOOR_OY + ((gx + gy) * TILE_H) / 2 }
}

function tile(g: Graphics, cx: number, cy: number, tw: number, th: number, ht: number, cT: string, cL: string, cR: string): void {
  if (ht > 0) {
    g.poly([cx - tw / 2, cy, cx, cy + th / 2, cx, cy + th / 2 + ht, cx - tw / 2, cy + ht]).fill(cL)
    g.poly([cx + tw / 2, cy, cx, cy + th / 2, cx, cy + th / 2 + ht, cx + tw / 2, cy + ht]).fill(cR)
  }
  g.poly([cx, cy - th / 2, cx + tw / 2, cy, cx, cy + th / 2, cx - tw / 2, cy]).fill(cT)
}

// drawGrid strokes the faint full-world iso floor grid (caller sets alpha).
export function drawGrid(g: Graphics): void {
  for (let gy = -2; gy < 30; gy++) {
    for (let gx = -8; gx < 26; gx++) {
      const sx = FLOOR_OX + ((gx - gy) * TILE_W) / 2
      const sy = FLOOR_OY + ((gx + gy) * TILE_H) / 2
      if (sx < -TILE_W || sx > WORLD_W + TILE_W || sy < -TILE_H || sy > WORLD_H + TILE_H) continue
      g.poly([sx, sy - TILE_H / 2, sx + TILE_W / 2, sy, sx, sy + TILE_H / 2, sx - TILE_W / 2, sy]).stroke({
        width: 1,
        color: PAL.grid,
      })
    }
  }
}

// stationPositions returns the screen-space centers of the N P-stations, spread
// across the top with a slight zig-zag in y.
export function stationPositions(numProcs: number): Pt[] {
  const margin = 64
  const span = WORLD_W - margin * 2
  const dx = numProcs > 1 ? span / (numProcs - 1) : 0
  const py = 58
  return Array.from({ length: numProcs }, (_, i) => ({
    x: Math.round(margin + (numProcs > 1 ? i * dx : span / 2)),
    y: py + (i % 2) * 5,
  }))
}

// drawStation draws one raised P platform with its CPU tower + status lamp at the
// back-left. The running gopher (with its laptop baked in) is a sprite placed on
// top by the scene, so it depth-sorts correctly against the local queue.
export function drawStation(g: Graphics, sx: number, sy: number): void {
  const tw = 46
  const th = 23
  const ht = 9
  tile(g, sx, sy, tw, th, ht, PAL.platT, PAL.platL, PAL.platR)
  g.moveTo(sx - tw / 2, sy)
    .lineTo(sx, sy - th / 2)
    .lineTo(sx + tw / 2, sy)
    .stroke({ width: 1, color: PAL.platEdge })
  // CPU tower at back-left with status lamp
  g.rect(sx - tw / 2 + 4, sy - th / 2 - 13, 9, 13).fill(PAL.cpu)
  g.rect(sx - tw / 2 + 4, sy - th / 2 - 13, 9, 1).fill(PAL.cpuHi)
  g.rect(sx - tw / 2 + 6, sy - th / 2 - 10, 2, 2).fill(PAL.running)
  g.rect(sx - tw / 2 + 6, sy - th / 2 - 6, 2, 2).fill(PAL.lampW)
}
