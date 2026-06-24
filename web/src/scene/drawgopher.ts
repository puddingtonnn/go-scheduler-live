import { PAL, stateColors, type SpriteState } from './palette'

// Procedural gopher renderer ported from the design handoff reference
// (drawGopher / gopherSpans). 24x28 classic Go mascot; body fur = state color,
// everything else constant; silhouette outlined by a 4-neighbour edge test.
// Framework-agnostic (Canvas2D); the scene bakes the result into a Pixi texture.

export interface GopherOpts {
  state?: SpriteState
  frozen?: boolean
  dead?: boolean
  flip?: boolean
  run?: boolean
  blink?: boolean
  look?: number
  zzz?: boolean
  sparkle?: boolean
  bang?: boolean
  dots?: boolean
  motion?: boolean
  ring?: number
  body?: string
  dark?: string
}

type Ctx = CanvasRenderingContext2D

function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

// gopher silhouette as [row, colStart, colEnd] spans on a 24-wide grid.
function gopherSpans(): [number, number, number][] {
  return [
    [1, 5, 7],
    [2, 4, 7],
    [3, 4, 7],
    [1, 16, 18],
    [2, 16, 19],
    [3, 16, 19],
    [2, 7, 16],
    [3, 5, 18],
    [4, 4, 19],
    [5, 3, 20],
    [6, 3, 20],
    [7, 2, 21],
    [8, 2, 21],
    [9, 2, 21],
    [10, 1, 22],
    [11, 1, 22],
    [12, 1, 22],
    [13, 1, 22],
    [14, 2, 21],
    [15, 2, 21],
    [16, 2, 21],
    [17, 2, 21],
    [18, 3, 20],
    [19, 3, 20],
    [20, 4, 19],
    [21, 5, 18],
    [22, 6, 17],
    [23, 7, 16],
  ]
}

function drawZ(ctx: Ctx, x: number, y: number, s: number, c: string): void {
  px(ctx, x, y, 3 * s, s, c)
  px(ctx, x + 1.5 * s, y + s, s, s, c)
  px(ctx, x, y + 2 * s, s, s, c)
  px(ctx, x, y + 2 * s, 3 * s, s, c)
}

function drawDiamondOutline(ctx: Ctx, cx: number, cy: number, r: number, c: string): void {
  const pts = [
    [0, -r],
    [r, 0],
    [0, r],
    [-r, 0],
  ]
  ctx.strokeStyle = c
  ctx.lineWidth = Math.max(1, r * 0.12)
  ctx.beginPath()
  pts.forEach((p, i) => {
    const X = cx + p[0]
    const Y = cy + p[1] * 0.62
    if (i) ctx.lineTo(X, Y)
    else ctx.moveTo(X, Y)
  })
  ctx.closePath()
  ctx.stroke()
}

export function drawGopher(ctx: Ctx, ox: number, oy: number, u: number, o: GopherOpts = {}): void {
  const P = PAL
  const GW = 24
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
  const alpha = o.dead ? 0.5 : 1
  const put = (c: number, r: number, w: number, h: number, col: string): void => {
    const cc = o.flip ? GW - (c + w) : c
    ctx.globalAlpha = alpha
    px(ctx, ox + cc * u, oy + r * u, w * u, h * u, col)
    ctx.globalAlpha = 1
  }

  // ground shadow
  ctx.globalAlpha = 0.28
  px(ctx, ox + 5 * u, oy + 25.5 * u, 15 * u, 1.6 * u, '#000')
  ctx.globalAlpha = 1

  // silhouette + outline (edge if any 4-neighbour is outside the set)
  const set = new Set<number>()
  for (const [r, a, b] of gopherSpans()) for (let c = a; c <= b; c++) set.add(r * 100 + c)
  const has = (r: number, c: number) => set.has(r * 100 + c)
  for (const k of set) {
    const r = Math.floor(k / 100)
    const c = k % 100
    const edge = !has(r - 1, c) || !has(r + 1, c) || !has(r, c - 1) || !has(r, c + 1)
    put(c, r, 1, 1, edge ? P.out : body)
  }

  // belly
  for (let r = 12; r <= 22; r++) {
    let a = 8
    let b = 15
    if (r <= 12) {
      a = 9
      b = 14
    }
    if (r >= 21) {
      a = 9
      b = 14
    }
    if (r >= 22) {
      a = 10
      b = 13
    }
    for (let c = a; c <= b; c++) put(c, r, 1, 1, P.cream)
  }
  put(9, 13, 1, 9, P.creamD)
  put(14, 13, 1, 9, P.creamD)
  put(5, 2, 2, 1, dark)
  put(17, 2, 2, 1, dark)
  put(1, 11, 1, 2, dark)
  put(22, 11, 1, 2, dark)

  // eyes
  if (o.blink) {
    put(5, 9, 6, 1, P.out)
    put(13, 9, 6, 1, P.out)
  } else {
    put(5, 6, 6, 6, P.eye)
    put(13, 6, 6, 6, P.eye)
    const pdx = o.look ?? 0
    put(7 + pdx, 8, 3, 3, P.nose)
    put(14 + pdx, 8, 3, 3, P.nose)
    put(8 + pdx, 8, 1, 1, P.eye)
    put(15 + pdx, 8, 1, 1, P.eye)
    put(4, 6, 1, 6, P.out)
    put(19, 6, 1, 6, P.out)
  }

  // nose + teeth
  put(11, 11, 2, 2, P.nose)
  put(10, 13, 2, 3, P.tooth)
  put(13, 13, 2, 3, P.tooth)
  put(12, 13, 1, 3, P.out)
  put(9, 13, 1, 3, P.out)
  put(15, 13, 1, 3, P.out)
  put(10, 16, 4, 1, P.out)

  // feet
  const fl = o.run ? -1 : 0
  const fr = o.run ? 1 : 0
  put(6, 24, 5, 3, dark)
  put(7, 24, 3, 1, dark)
  put(13, 24, 5, 3, dark)

  // run pose: raise arms, shift feet
  if (o.run) {
    put(0, 7, 3, 3, body)
    put(0, 7, 1, 3, P.out)
    put(21, 7, 3, 3, body)
    put(23, 7, 1, 3, P.out)
    put(6 + fl, 25, 4, 2, dark)
    put(14 + fr, 25, 4, 2, dark)
  }

  // overlays (used by the scene as needed)
  if (o.zzz) {
    drawZ(ctx, ox + 22 * u, oy - 2 * u, u * 1.4, P.waiting)
    drawZ(ctx, ox + 24.5 * u, oy - 6 * u, u * 1.9, P.waiting)
    drawZ(ctx, ox + 27.5 * u, oy - 11 * u, u * 2.5, P.waiting)
  }
  if (o.sparkle) {
    const sx = ox + 18 * u
    const sy = oy + 1 * u
    px(ctx, sx, sy - 2 * u, u, 5 * u, P.teal)
    px(ctx, sx - 2 * u, sy, 5 * u, u, P.teal)
  }
  if (o.bang) {
    const bx = ox + (o.flip ? 2 : 18) * u
    const by = oy - 9 * u
    px(ctx, bx, by, 1.6 * u, 5 * u, P.steal)
    px(ctx, bx, by + 6 * u, 1.6 * u, 1.6 * u, P.steal)
  }
  if (o.dots) {
    const dy = oy + 2 * u
    for (let i = 0; i < 3; i++) px(ctx, ox + (o.flip ? -3 - i * 2.5 : 24 + i * 2.5) * u, dy, 1.4 * u, 1.4 * u, P.syscall)
  }
  if (o.motion) {
    const mx = ox + (o.flip ? 22 : -6) * u
    for (let i = 0; i < 3; i++) px(ctx, mx + (o.flip ? i * 2 : -i * 2) * u, oy + (8 + i * 4) * u, 4 * u, 1 * u, 'rgba(255,255,255,.5)')
  }
  if (o.ring) {
    drawDiamondOutline(ctx, ox + 12 * u, oy + 13 * u, o.ring * u, '#ffffff')
  }
}

// gopherCanvas bakes one gopher into a 44x44 cell (body drawn at offset 10,12)
// with room for the flying overlays (zzz/dots/bang/ring). The scene turns this
// into a nearest-filtered Pixi texture. Feet sit at ~y 39 -> sprite anchor
// (0.5, 0.886) places the gopher's feet at its container origin.
export function gopherCanvas(opts: GopherOpts = {}): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 44
  c.height = 44
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  drawGopher(ctx, 10, 12, 1, opts)
  return c
}
