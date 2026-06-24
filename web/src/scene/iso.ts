import { Graphics } from 'pixi.js'
import { PAL } from './palette'

// Isometric world geometry, ported from the design handoff reference
// (tile / pStation / floor grid, drawScene composition coords). Everything is
// laid out in a fixed "base" world (460x248); the scene scales this container to
// fit the canvas, so these numbers match the reference 1:1.

export const TILE_W = 24
export const TILE_H = 12
export const WORLD_W = 460
export const WORLD_H = 248
export const FLOOR_OX = WORLD_W / 2
export const FLOOR_OY = 10

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
  for (let gy = -2; gy < 26; gy++) {
    for (let gx = -6; gx < 22; gx++) {
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

// stationPositions returns the screen-space centers of the N P-stations.
export function stationPositions(numProcs: number): Pt[] {
  const px0 = 78
  const dx = Math.min(118, (WORLD_W - 150) / Math.max(numProcs, 1))
  const py = 70
  return Array.from({ length: numProcs }, (_, i) => ({ x: px0 + i * dx, y: py + (i % 2) * 6 }))
}

// drawStation draws one raised P platform with its CPU tower + status lamp.
export function drawStation(g: Graphics, sx: number, sy: number): void {
  const tw = 44
  const th = 22
  const ht = 8
  tile(g, sx, sy, tw, th, ht, PAL.platT, PAL.platL, PAL.platR)
  g.moveTo(sx - tw / 2, sy)
    .lineTo(sx, sy - th / 2)
    .lineTo(sx + tw / 2, sy)
    .stroke({ width: 1, color: PAL.platEdge })
  g.rect(sx - 4, sy - th / 2 - 12, 9, 12).fill(PAL.cpu)
  g.rect(sx - 4, sy - th / 2 - 12, 9, 1).fill(PAL.cpuHi)
  g.rect(sx - 2, sy - th / 2 - 9, 2, 2).fill(PAL.running)
  g.rect(sx + 1, sy - th / 2 - 6, 2, 2).fill(PAL.lampW)
}
