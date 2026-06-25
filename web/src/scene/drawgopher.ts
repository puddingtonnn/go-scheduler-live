import { PAL, stateColors, shade, type SpriteState } from './palette'

// Procedural gopher renderer ported from the v2 design handoff reference
// ("design_handoff_go_scheduler 2"/drawGopher). Canonical Renée French gopher:
// upright capsule body, big bulging googly eyes, tan muzzle + buck teeth, short
// tan paws and splayed tan feet, no cream belly. Body fur = state color; muzzle/
// paws/feet/eyes stay constant so identity reads the same as the state changes.
// Framework-agnostic Canvas2D; the scene bakes the result into a Pixi texture.

export interface GopherOpts {
  state?: SpriteState
  frozen?: boolean
  dead?: boolean
  flip?: boolean
  /** legacy "running" pose (raised arms); v2 uses `work` for the typing pose. */
  run?: boolean
  /** typing pose: tan paws tap up/down by armPhase. */
  work?: boolean
  /** -1/+1 phase for tapping paws / alternating feet. */
  armPhase?: number
  blink?: boolean
  /** pupil horizontal offset (look direction). */
  look?: number
  /** horizontal offset in px-units (sway); shadow stays put. */
  xoff?: number
  /** vertical offset in px-units (bob/breathe); shadow stays put. */
  yoff?: number
  zzz?: boolean
  /** zzz animation phase [0,1): controls the rising/fading of the three glyphs. */
  zt?: number
  bang?: boolean
  /** number of syscall dots to show (1..3), or null/undefined for none. */
  dots?: number | null
  motion?: boolean
  /** steal ring radius in px-units, or null/undefined for none. */
  ring?: number | null
  /** steal ring alpha [0,1]. */
  ringA?: number
  /** id chip baked above the head (sprite-sheet/demo only; live scene uses Text). */
  tag?: string
  body?: string
  dark?: string
}

type Ctx = CanvasRenderingContext2D
type Put = (c: number, r: number, w: number, h: number, col: string) => void

// Bake-cell geometry. The 24x~27 gopher body is drawn at (DRAW_OX, DRAW_OY) with
// room above for zzz/bang and on the sides for the steal ring / syscall dots.
export const CELL_W = 48
export const CELL_H = 52
const DRAW_OX = 12
const DRAW_OY = 16
/** feet contact point (cell coords) — the sprite anchor maps it to the origin. */
export const FEET_Y = DRAW_OY + 26
export const ANCHOR_X = (DRAW_OX + 12) / CELL_W // body center col 12 -> 0.5
export const ANCHOR_Y = FEET_Y / CELL_H
/** head-top y relative to the feet origin, for placing the id tag above it. */
export const HEAD_TOP_FROM_FEET = DRAW_OY - FEET_Y

function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

// gopher silhouette as [row, colStart, colEnd] spans on a 24-wide grid (v2).
function gopherSpans(): [number, number, number][] {
  return [
    [0, 5, 7],
    [0, 16, 18],
    [1, 5, 7],
    [1, 16, 18],
    [2, 5, 8],
    [2, 15, 18],
    [3, 7, 16],
    [4, 5, 18],
    [5, 4, 19],
    [6, 3, 20],
    [7, 3, 20],
    [8, 2, 21],
    [9, 2, 21],
    [10, 2, 21],
    [11, 2, 21],
    [12, 2, 21],
    [13, 2, 21],
    [14, 2, 21],
    [15, 2, 21],
    [16, 2, 21],
    [17, 2, 21],
    [18, 2, 21],
    [19, 2, 21],
    [20, 2, 21],
    [21, 3, 20],
    [22, 3, 20],
    [23, 4, 19],
    [24, 6, 17],
  ]
}

function drawZ(ctx: Ctx, x: number, y: number, s: number, c: string): void {
  px(ctx, x, y, 3 * s, s, c)
  px(ctx, x + 1.5 * s, y + s, s, s, c)
  px(ctx, x, y + 2 * s, s, s, c)
  px(ctx, x, y + 2 * s, 3 * s, s, c)
}

function drawDiamondOutline(ctx: Ctx, cx: number, cy: number, r: number, c: string, a: number): void {
  const pts = [
    [0, -r],
    [r, 0],
    [0, r],
    [-r, 0],
  ]
  ctx.globalAlpha = a
  ctx.strokeStyle = c
  ctx.lineWidth = Math.max(1, r * 0.14)
  ctx.beginPath()
  pts.forEach((p, i) => {
    const X = cx + p[0]
    const Y = cy + p[1] * 0.6
    if (i) ctx.lineTo(X, Y)
    else ctx.moveTo(X, Y)
  })
  ctx.closePath()
  ctx.stroke()
  ctx.globalAlpha = 1
}

// drawEye renders one bulging googly eye: an outlined white blob with a 3x3 dark
// pupil offset by `look`. Drawn via the shared `put` so it respects flip/alpha.
function drawEye(put: Put, bx: number, by: number, look: number): void {
  const m: [number, number, number][] = [
    [0, 1, 3],
    [1, 0, 4],
    [2, 0, 4],
    [3, 0, 4],
    [4, 0, 4],
    [5, 1, 3],
  ]
  const halo = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
  for (const [r, a, b] of m) for (let c = a; c <= b; c++) for (const d of halo) put(bx + c + d[1], by + r + d[0], 1, 1, PAL.out)
  for (const [r, a, b] of m) for (let c = a; c <= b; c++) put(bx + c, by + r, 1, 1, PAL.eye)
  const pcx = bx + 1 + look
  const pcy = by + 1
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) put(pcx + c, pcy + r, 1, 1, PAL.nose)
  put(pcx, pcy, 1, 1, PAL.eye)
}

// drawTag bakes an "G##" id chip above the head (state-colored). The live scene
// uses a DOM/Pixi child Text instead; this exists for the standalone sprite-sheet
// reference and demo parity.
function drawTag(ctx: Ctx, cx: number, topY: number, u: number, text: string, color: string): void {
  const fs = Math.max(5, Math.round(5.5 * u))
  ctx.save()
  ctx.font = `600 ${fs}px "Pixelify Sans","JetBrains Mono",monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const w = Math.ceil(ctx.measureText(text).width) + 4
  const h = fs + 3
  const x = Math.round(cx - w / 2)
  const y = Math.round(topY - h - 2 * u)
  ctx.fillStyle = 'rgba(8,9,15,.9)'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = color
  ctx.fillRect(x, y, 2, h)
  ctx.fillStyle = color
  ctx.fillText(text, cx + 1, y + h / 2 + 0.5)
  ctx.restore()
}

export function drawGopher(ctx: Ctx, ox0: number, oy0: number, u: number, o: GopherOpts = {}): void {
  const P = PAL
  const GW = 24
  const ox = ox0 + (o.xoff ?? 0) * u
  const oy = oy0 + (o.yoff ?? 0) * u

  let body: string
  let dark: string
  if (o.frozen) {
    body = P.froT
    dark = P.froD
  } else {
    const c = stateColors(o.state ?? 'running')
    body = o.body ?? c[0]
    dark = o.dark ?? c[1]
  }
  const lite = shade(body, 20)
  const tan = o.frozen ? '#cfd8e8' : P.cream
  const tanD = o.frozen ? '#9aa6bd' : P.creamD
  const alpha = o.dead ? 0.45 : 1

  const put: Put = (c, r, w, h, col) => {
    const cc = o.flip ? GW - (c + w) : c
    ctx.globalAlpha = alpha
    px(ctx, ox + cc * u, oy + r * u, w * u, h * u, col)
    ctx.globalAlpha = 1
  }

  // ground shadow (stays put — undo xoff/yoff)
  ctx.globalAlpha = 0.26
  px(ctx, ox + (5 - (o.xoff ?? 0)) * u, oy - (o.yoff ?? 0) * u + 26 * u, 15 * u, 1.6 * u, '#000')
  ctx.globalAlpha = 1

  const ap = o.armPhase ?? 0
  const ff = o.run ? (ap > 0 ? 1 : -1) : 0

  // feet (tan, splayed) behind body
  const foot = (a: number): void => {
    put(a + 1, 23, 4, 1, tanD)
    put(a, 24, 6, 2, tan)
    put(a, 23, 1, 3, P.out)
    put(a + 5, 23, 1, 3, P.out)
    put(a, 26, 6, 1, P.out)
  }
  foot(3 + ff)
  foot(15 - ff)

  // body silhouette + auto outline (edge if any 4-neighbour is outside the set)
  const set = new Set<number>()
  for (const [r, a, b] of gopherSpans()) for (let c = a; c <= b; c++) set.add(r * 100 + c)
  const has = (r: number, c: number): boolean => set.has(r * 100 + c)
  for (const k of set) {
    const r = Math.floor(k / 100)
    const c = k % 100
    const edge = !has(r - 1, c) || !has(r + 1, c) || !has(r, c - 1) || !has(r, c + 1)
    put(c, r, 1, 1, edge ? P.out : body)
  }

  // form shading: light on the left, shade on the right
  for (let r = 8; r <= 21; r++) {
    put(3, r, 1, 1, lite)
    put(20, r, 1, 1, dark)
  }
  put(4, 9, 1, 9, lite)
  put(19, 10, 1, 10, dark)

  // arms / paws (tan hands). work = typing pose (paws tap), else relaxed at sides.
  if (o.work) {
    put(2, 15, 3, 3, body)
    put(19, 15, 3, 3, body)
    put(6, 18 + (ap > 0 ? 0 : 1), 3, 2, tan)
    put(15, 18 + (ap > 0 ? 1 : 0), 3, 2, tan)
  } else {
    put(0, 15, 3, 4, body)
    put(0, 15, 1, 4, P.out)
    put(1, 18, 3, 1, tan)
    put(21, 15, 3, 4, body)
    put(23, 15, 1, 4, P.out)
    put(20, 18, 3, 1, tan)
  }

  // eyes (bulging googly), or closed line when blinking
  if (o.blink) {
    put(5, 6, 5, 1, P.out)
    put(14, 6, 5, 1, P.out)
  } else {
    drawEye(put, 5, 3, o.look ?? 0)
    drawEye(put, 14, 3, o.look ?? 0)
  }

  // muzzle (tan patch between/below the eyes)
  const mz: [number, number, number][] = [
    [11, 9, 14],
    [12, 9, 14],
    [13, 9, 14],
    [14, 10, 13],
    [15, 10, 13],
  ]
  for (const [r, a, b] of mz) for (let c = a; c <= b; c++) put(c, r, 1, 1, tan)
  put(9, 13, 1, 2, tanD)
  put(14, 13, 1, 2, tanD)

  // nose
  put(10, 11, 4, 1, P.nose)
  put(11, 12, 2, 1, P.nose)

  // buck teeth
  put(10, 13, 2, 3, P.eye)
  put(13, 13, 2, 3, P.eye)
  put(12, 13, 1, 3, P.out)
  put(9, 13, 1, 3, P.out)
  put(15, 13, 1, 3, P.out)
  put(10, 16, 5, 1, P.out)

  // overlays (toggled by the scene per state / per animation frame)
  if (o.zzz) {
    const zt = o.zt ?? 0
    for (let i = 0; i < 3; i++) {
      const p = (zt + i * 0.34) % 1
      const zx = ox + (19 + p * 7) * u
      const zy = oy + (2 - p * 15) * u
      const zs = u * (1.1 + p * 1.7)
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - p) * 1.5))
      drawZ(ctx, zx, zy, zs, P.waiting)
      ctx.globalAlpha = 1
    }
  }
  if (o.dots != null) {
    const dy = oy + 1 * u
    for (let i = 0; i < o.dots; i++) px(ctx, ox + (o.flip ? -3 - i * 3 : 24 + i * 3) * u, dy, 1.6 * u, 1.6 * u, P.syscall)
  }
  if (o.bang) {
    const bx = ox + (o.flip ? 2 : 18) * u
    const by = oy - 9 * u
    px(ctx, bx, by, 1.8 * u, 5 * u, P.steal)
    px(ctx, bx, by + 6 * u, 1.8 * u, 1.8 * u, P.steal)
  }
  if (o.motion) {
    const mx = ox + (o.flip ? 22 : -6) * u
    for (let i = 0; i < 3; i++) px(ctx, mx + (o.flip ? i * 2 : -i * 2) * u, oy + (9 + i * 4) * u, 4 * u, 1 * u, 'rgba(255,255,255,.5)')
  }
  if (o.ring != null) {
    drawDiamondOutline(ctx, ox + 12 * u, oy + 14 * u, o.ring * u, P.eye, o.ringA ?? 1)
  }
  // id tag (sprite-sheet/demo only — the live scene uses a child Text)
  if (o.tag) {
    drawTag(ctx, ox + 12 * u, oy, u, o.tag, o.frozen ? P.froT : stateColors(o.state ?? 'running')[0])
  }
}

// gopherCanvas bakes one gopher into a CELL_W x CELL_H cell. The scene turns this
// into a nearest-filtered Pixi texture; the sprite anchor (ANCHOR_X, ANCHOR_Y)
// places the gopher's feet at its container origin.
export function gopherCanvas(opts: GopherOpts = {}): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = CELL_W
  c.height = CELL_H
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  drawGopher(ctx, DRAW_OX, DRAW_OY, 1, opts)
  return c
}
