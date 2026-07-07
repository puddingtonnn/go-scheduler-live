import { Graphics } from 'pixi.js'
import { PAL, shade } from './palette'
import type { Pt } from './iso'
import { heapTileOrder } from './heap'
import type { BotState } from './bot'

// Animated factory structures drawn with Pixi Graphics. Static shells (booth glass +
// roof) are baked once into the stations layer; the moving parts (fan, steam, belt
// chevrons, heap tiles, cleaning robot, siren) are redrawn each frame into the fx
// layer from real state (P occupancy, heap %, GC mark phase, STW flash) + a wall
// clock for the idle motion. Everything here is DECORATIVE staging of REAL data.

// Central GC yard: the heap pile, the robot dock beside it, the siren pole.
export const HEAP_CENTER: Pt = { x: 288, y: 174 }
export const BOT_DOCK: Pt = { x: 330, y: 192 }
export const SIREN_POS: Pt = { x: 238, y: 176 }

// isoTile draws one iso block (rhombus top + two side faces), like iso.ts's private
// tile() — replicated here so factory drawing is self-contained.
function isoTile(g: Graphics, cx: number, cy: number, tw: number, th: number, ht: number, cT: string, cL: string, cR: string): void {
  if (ht > 0) {
    g.poly([cx - tw / 2, cy, cx, cy + th / 2, cx, cy + th / 2 + ht, cx - tw / 2, cy + ht]).fill(cL)
    g.poly([cx + tw / 2, cy, cx, cy + th / 2, cx, cy + th / 2 + ht, cx + tw / 2, cy + ht]).fill(cR)
  }
  g.poly([cx, cy - th / 2, cx + tw / 2, cy, cx, cy + th / 2, cx - tw / 2, cy]).fill(cT)
}

// --- static booth shell (glass back + roof), drawn once behind the P platform ---
export function drawBoothShell(g: Graphics, sx: number, sy: number): void {
  // glass back panel rising behind the running gopher
  g.rect(sx - 22, sy - 50, 44, 38).fill({ color: PAL.bg2, alpha: 0.5 })
  g.rect(sx - 22, sy - 50, 44, 1).fill(PAL.platEdge)
  g.rect(sx - 22, sy - 50, 1, 38).fill(PAL.platEdge)
  g.rect(sx + 21, sy - 50, 1, 38).fill(shade(PAL.bg2, -10))
  g.rect(sx - 17, sy - 48, 6, 33).fill({ color: PAL.screen, alpha: 0.05 }) // faint glass sheen
  // roof slab
  g.rect(sx - 25, sy - 57, 50, 7).fill(shade(PAL.bg2, -12))
  g.rect(sx - 25, sy - 57, 50, 2).fill(PAL.platEdge)
}

// --- per-frame booth parts: roof fan + steam when occupied ---
export function drawBoothFx(g: Graphics, sx: number, sy: number, occupied: boolean, animT: number): void {
  const fx = sx
  const fy = sy - 54
  g.rect(fx - 3, fy - 2, 7, 5).fill(shade(PAL.bg1, -2)) // housing
  const spin = Math.floor(animT * (occupied ? 12 : 3)) % 2
  if (spin) {
    g.rect(fx - 2, fy, 5, 1).fill(PAL.txDim)
    g.rect(fx, fy - 2, 1, 5).fill(PAL.txDim)
  } else {
    g.rect(fx - 2, fy - 1, 2, 1).fill(PAL.txDim)
    g.rect(fx + 1, fy + 1, 2, 1).fill(PAL.txDim)
    g.rect(fx - 1, fy + 1, 1, 1).fill(PAL.txDim)
    g.rect(fx + 1, fy - 1, 1, 1).fill(PAL.txDim)
  }
  if (occupied) {
    for (let k = 0; k < 3; k++) {
      const p = (animT * 0.4 + k / 3) % 1
      const px = sx + 14 + Math.sin(animT * 3 + k * 2) * 2 * p
      const py = sy - 58 - p * 14
      g.rect(px, py, 2 - p, 2 - p).fill({ color: PAL.txMid, alpha: (1 - p) * 0.3 })
    }
  }
}

// --- per-frame conveyor belt under a booth (the local run queue's bed) ---
export function drawBelt(g: Graphics, sx: number, sy: number, animT: number): void {
  const w = 16
  const top = sy + 24
  const h = 64
  g.rect(sx - w / 2, top, w, h).fill(PAL.cpu)
  g.rect(sx - w / 2, top, 2, h).fill(PAL.cpuHi)
  g.rect(sx + w / 2 - 2, top, 2, h).fill(shade(PAL.cpu, -6))
  const off = (animT * 22) % 10
  for (let y = top - 10; y < top + h; y += 10) {
    const yy = y + off
    if (yy < top + 2 || yy > top + h - 4) continue
    g.moveTo(sx - w / 2 + 2, yy)
      .lineTo(sx, yy + 3)
      .lineTo(sx + w / 2 - 2, yy)
      .stroke({ width: 1, color: PAL.line2 })
  }
}

// --- per-frame heap pile: tiles = heap fill; pulse/brighten during concurrent mark
// (and where the robot is sweeping); frozen recolor during STW ---
export function drawHeapPile(
  g: Graphics,
  center: Pt,
  count: number,
  marking: boolean,
  frozen: boolean,
  animT: number,
  bot: BotState | null,
): void {
  const cells = heapTileOrder()
    .slice(0, count)
    .slice()
    .sort((a, b) => a[0] + a[1] - (b[0] + b[1]))
  for (const [gx, gy] of cells) {
    const tx = center.x + (gx - gy) * 13
    const ty = center.y + (gx + gy) * 6.5
    let top = shade(PAL.teal, -6)
    let l = shade(PAL.tealD, -20)
    let r = shade(PAL.tealD, -8)
    if (frozen) {
      top = PAL.froD
      l = shade(PAL.froD, -30)
      r = shade(PAL.froD, -16)
    } else if (marking) {
      const near = bot?.sweeping && Math.abs(tx - bot.x) < 22 && Math.abs(ty - bot.y) < 16
      top = near ? shade(PAL.teal, 30) : shade(PAL.teal, Math.round(Math.sin(animT * 6 + gx * 2 + gy * 3) * 12))
    }
    isoTile(g, tx, ty, 24, 12, 8, top, l, r)
  }
  // dock pad under the robot's home
  g.rect(BOT_DOCK.x - 9, BOT_DOCK.y - 2, 18, 4).fill(shade(PAL.bg2, 4))
  g.rect(BOT_DOCK.x - 9, BOT_DOCK.y - 2, 18, 1).fill(PAL.platEdge)
}

// --- per-frame cleaning robot ---
export function drawRobot(g: Graphics, x: number, y: number, sweeping: boolean, alarm: boolean, animT: number): void {
  // wheels
  g.rect(x - 6, y - 3, 3, 3).fill(shade(PAL.bg1, -2))
  g.rect(x + 3, y - 3, 3, 3).fill(shade(PAL.bg1, -2))
  // body
  g.rect(x - 7, y - 13, 14, 10).fill(PAL.txMid)
  g.rect(x - 7, y - 13, 14, 2).fill(shade(PAL.txMid, 20))
  g.rect(x - 7, y - 5, 14, 2).fill(PAL.txDim)
  // face
  g.rect(x - 5, y - 10, 4, 3).fill(shade(PAL.bg1, -2))
  const eye = alarm ? (Math.floor(animT * 8) % 2 ? PAL.gcStw : shade(PAL.gcStw, -60)) : PAL.screen
  g.rect(x - 4, y - 9, 2, 1).fill(eye)
  // dome + antenna
  g.rect(x - 4, y - 17, 8, 4).fill(alarm ? PAL.gcStw : PAL.platEdge)
  g.rect(x, y - 20, 1, 3).fill(PAL.txDim)
  const tip = alarm ? (Math.floor(animT * 10) % 2 ? PAL.gcStw : shade(PAL.gcStw, -60)) : Math.floor(animT * 2) % 2 ? PAL.running : PAL.runningD
  g.rect(x - 1, y - 21, 3, 2).fill(tip)
  // broom while sweeping
  if (sweeping) {
    const sw = Math.sin(animT * 10) * 4
    g.rect(x + 7, y - 11, 2, 8).fill(shade(PAL.cream, -60))
    g.rect(x + 7 + sw, y, 6, 3).fill(PAL.lampW)
    g.rect(x + 7 + sw, y + 2, 6, 1).fill(shade(PAL.lampW, -40))
    for (let i = 0; i < 3; i++) {
      g.rect(x + 9 + sw + Math.sin(animT * 9 + i * 2) * 3, y + 2 - i, 1, 1).fill({ color: PAL.txMid, alpha: 0.5 })
    }
  }
}

// --- per-frame siren pole: dark until STW, then a flashing red beacon ---
export function drawSiren(g: Graphics, x: number, y: number, level: number, animT: number): void {
  g.rect(x - 1, y - 26, 3, 26).fill(shade(PAL.bg2, 8))
  g.rect(x - 1, y - 26, 1, 26).fill(PAL.platEdge)
  g.rect(x - 4, y - 33, 9, 7).fill(shade(PAL.bg0, 4))
  const on = level > 0
  const lamp = on ? (Math.floor(animT * 10) % 2 ? PAL.gcStw : shade(PAL.gcStw, -70)) : shade(PAL.gcStw, -80)
  g.rect(x - 3, y - 32, 7, 5).fill(lamp)
  if (on) {
    // sweeping beams
    const ang = animT * 5
    for (const d of [0, Math.PI]) {
      g.poly([
        x,
        y - 30,
        x + Math.cos(ang + d) * 48,
        y - 30 + Math.sin(ang + d) * 18,
        x + Math.cos(ang + d + 0.5) * 48,
        y - 30 + Math.sin(ang + d + 0.5) * 18,
      ]).fill({ color: PAL.gcStw, alpha: 0.22 * level })
    }
  }
}
