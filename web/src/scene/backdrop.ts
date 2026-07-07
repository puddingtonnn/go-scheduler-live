import { Container, Graphics, Text } from 'pixi.js'
import { PAL, shade } from './palette'
import { WORLD_W } from './iso'
import type { Rect } from './layout'
import { t as tr } from '../i18n'

// The factory static backdrop: a back wall with a neon "GO SCHEDULER" sign, the
// main() spawn gate + exit gate, a couple of posters, and per-zone signage (a
// departure board over the global queue that shows its live count, dorm bunks over
// the waiting zone, phone stalls over the syscall zone). Everything here is
// DECORATIVE staging drawn once with Pixi Graphics/Text — it frames the world but
// carries no scheduler state except the board's global-queue number (a real
// zoneTotals count). Disclosed in the assumptions panel.

export interface Backdrop {
  readonly container: Container
  /** update the departure board's live global-queue count. */
  setGlobalCount(n: number): void
}

const TEXT_RES = 3 // rasterize scene labels crisp; a fixed bucket is enough for statics

export function buildBackdrop(zones: { global: Rect; waiting: Rect; syscall: Rect }): Backdrop {
  const container = new Container()
  const g = new Graphics()
  container.addChild(g)

  drawWall(g)
  drawGateFrame(g, SPAWN_X)
  drawGateFrame(g, EXIT_X)
  drawBoard(g, zones.global)
  drawBunks(g, zones.waiting)
  drawPhoneStalls(g, zones.syscall)

  const S = tr()
  // neon sign
  container.addChild(label(S.factory.sign, WORLD_W / 2, 9, 9, PAL.teal, 'center', true))
  container.addChild(label(S.factory.signSub, WORLD_W / 2, 20, 6, PAL.txDim, 'center'))
  // gate labels
  container.addChild(label(S.factory.spawn, SPAWN_X, 15, 6, PAL.runnable, 'center'))
  container.addChild(label(S.factory.exit, EXIT_X, 15, 6, PAL.running, 'center'))
  // departure board: title + live count
  const bx = zones.global.x + 6
  const by = zones.global.y - 26
  container.addChild(label(S.factory.board, bx, by + 5, 7, PAL.teal, 'left'))
  const count = label('0', bx, by + 12, 10, PAL.runnable, 'left')
  container.addChild(count)

  return {
    container,
    setGlobalCount(n: number): void {
      const s = String(n)
      if (count.text !== s) count.text = s
    },
  }
}

const SPAWN_X = 44
const EXIT_X = WORLD_W - 44

// --- wall + posters ---
function drawWall(g: Graphics): void {
  const H = 30
  g.rect(0, 0, WORLD_W, H).fill(PAL.bg2)
  g.rect(0, 0, WORLD_W, 3).fill(shade(PAL.bg2, -6))
  for (let x = 0; x < WORLD_W; x += 48) {
    g.rect(x, 3, 1, H - 5).fill(shade(PAL.bg2, -12))
    g.rect(x + 2, 8, 1, 1).fill(PAL.platEdge)
    g.rect(x + 2, 22, 1, 1).fill(PAL.platEdge)
  }
  g.rect(0, H, WORLD_W, 2).fill(PAL.bg0)
  // a soft floor-shadow band under the wall
  g.rect(0, H + 2, WORLD_W, 10).fill({ color: PAL.bg0, alpha: 0.35 })
  // two small framed posters flanking the sign
  poster(g, WORLD_W / 2 - 70, 6, PAL.teal)
  poster(g, WORLD_W / 2 + 56, 6, PAL.runnable)
}

function poster(g: Graphics, x: number, y: number, c: string): void {
  g.rect(x, y, 13, 18).fill(shade(PAL.bg0, 8))
  g.rect(x, y, 13, 1).fill(PAL.platEdge)
  g.rect(x + 3, y + 3, 7, 6).fill({ color: c, alpha: 0.7 })
  g.rect(x + 3, y + 12, 6, 1).fill(PAL.txDim)
  g.rect(x + 3, y + 14, 4, 1).fill(PAL.txDim)
}

// --- gates ---
function drawGateFrame(g: Graphics, x: number): void {
  g.rect(x - 11, 6, 22, 26).fill(PAL.bg0)
  g.rect(x - 9, 8, 18, 22).fill(shade(PAL.bg1, -2))
  g.rect(x - 11, 6, 22, 2).fill(PAL.platEdge)
  g.rect(x - 11, 6, 2, 26).fill(shade(PAL.bg2, -8))
  g.rect(x + 9, 6, 2, 26).fill(shade(PAL.bg2, -8))
}

// --- departure board over the global queue ---
function drawBoard(g: Graphics, r: Rect): void {
  const x = r.x
  const y = r.y - 26
  const w = 98
  const h = 22
  g.rect(x, y, w, h).fill(PAL.bg0)
  g.rect(x + 2, y + 2, w - 4, h - 4).fill(shade(PAL.bg1, -2))
  g.rect(x + 2, y + 2, w - 4, 1).fill(PAL.platEdge)
  // a strip of "flip" indicator cells to the right of the number
  for (let i = 0; i < 6; i++) g.rect(x + 54 + i * 7, y + 13, 5, 5).fill(shade(PAL.bg2, 6))
}

// --- dorm bunks over the waiting zone (back edge, above the sleeping crowd) ---
function drawBunks(g: Graphics, r: Rect): void {
  bunk(g, r.x + 26, r.y - 6)
  bunk(g, r.x + r.w - 26, r.y - 6)
}

function bunk(g: Graphics, x: number, y: number): void {
  const post = PAL.platEdge
  const bar = shade(PAL.waitingD, -10)
  g.rect(x - 15, y - 11, 2, 14).fill(post)
  g.rect(x + 13, y - 11, 2, 14).fill(post)
  g.rect(x - 15, y - 10, 30, 2).fill(bar) // upper bunk frame
  g.rect(x - 15, y + 1, 30, 2).fill(bar) // lower bunk frame
  g.rect(x - 13, y - 12, 8, 1).fill({ color: PAL.waiting, alpha: 0.5 }) // pillow hint
  g.rect(x - 13, y - 1, 8, 1).fill({ color: PAL.waiting, alpha: 0.5 })
}

// --- phone stalls over the syscall zone (back edge) ---
function drawPhoneStalls(g: Graphics, r: Rect): void {
  phoneStall(g, r.x + 24, r.y - 4)
  phoneStall(g, r.x + r.w - 24, r.y - 4)
}

function phoneStall(g: Graphics, x: number, y: number): void {
  const body = shade(PAL.syscallD, -30)
  g.rect(x - 8, y - 22, 16, 22).fill(body)
  g.rect(x - 8, y - 22, 16, 2).fill(shade(PAL.syscall, -20))
  g.rect(x - 8, y - 22, 2, 22).fill(shade(PAL.syscallD, -18))
  g.rect(x - 5, y - 18, 10, 12).fill(shade(PAL.bg0, 4)) // dark glass
  g.rect(x - 2, y - 24, 4, 2).fill({ color: PAL.syscall, alpha: 0.7 }) // top light
}

// label builds a small pixel-style Text. Monospace (like the id tags) so it renders
// regardless of the web font's load timing; teal glow for the neon sign.
function label(
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  align: 'left' | 'center',
  neon = false,
): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: 'ui-monospace, monospace',
      fontSize: size,
      fill: color,
      align,
      ...(neon ? { dropShadow: { color: PAL.teal, blur: 4, distance: 0, alpha: 0.9 } } : {}),
    },
    resolution: TEXT_RES,
  })
  t.anchor.set(align === 'center' ? 0.5 : 0, 0.5)
  t.position.set(x, y)
  return t
}
