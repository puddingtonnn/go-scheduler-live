// Procedural pixel-art for the OS-thread (M) sprite: a small steel carrier
// ("dolly") that sits by a P station under its running gopher and travels with
// a goroutine into the syscall zone. Same canvas-2D style as drawgopher.ts,
// same palette; the scene bakes it into NEAREST textures once.

import { PAL, shade } from './palette'

type Ctx = CanvasRenderingContext2D

export const T_CELL_W = 28
export const T_CELL_H = 20

// Chassis geometry inside the cell (u = 1px units).
const LEFT = 4
const RIGHT = 23 // inclusive
const TOP = 5
const BASE = 17 // ground contact line -> anchor row

export const T_ANCHOR_X = 0.5
export const T_ANCHOR_Y = BASE / T_CELL_H
/** chassis-top y relative to the base origin, for placing the id tag above. */
export const T_TOP_FROM_BASE = TOP - BASE

export interface ThreadOpts {
  /** STW recolor, matches the gophers' frozen look. */
  frozen?: boolean
  /** status lamp on (2-frame idle blink). */
  lit?: boolean
}

function px(ctx: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  ctx.fillStyle = c
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

export function drawThread(ctx: Ctx, o: ThreadOpts = {}): void {
  const body = o.frozen ? PAL.froT : PAL.thread
  const dark = o.frozen ? PAL.froD : PAL.threadD
  const lite = shade(body, 22)
  const w = RIGHT - LEFT + 1

  // outline
  px(ctx, LEFT - 1, TOP - 1, w + 2, BASE - TOP - 2, PAL.out)
  // top face
  px(ctx, LEFT, TOP, w, 3, lite)
  // front face
  px(ctx, LEFT, TOP + 3, w, BASE - TOP - 6, body)
  // right side shading
  px(ctx, RIGHT - 3, TOP + 3, 4, BASE - TOP - 6, dark)
  // vents on the front
  px(ctx, LEFT + 3, TOP + 5, 5, 1, dark)
  px(ctx, LEFT + 3, TOP + 7, 5, 1, dark)
  // bottom edge
  px(ctx, LEFT, BASE - 3, w, 1, PAL.out)
  // treads
  px(ctx, LEFT + 2, BASE - 2, 6, 2, PAL.out)
  px(ctx, LEFT + 3, BASE - 2, 4, 1, dark)
  px(ctx, RIGHT - 7, BASE - 2, 6, 2, PAL.out)
  px(ctx, RIGHT - 6, BASE - 2, 4, 1, dark)
  // status lamp, top-right
  px(ctx, RIGHT - 4, TOP - 3, 3, 3, PAL.out)
  px(ctx, RIGHT - 3, TOP - 2, 2, 2, o.lit && !o.frozen ? PAL.lampW : dark)
}

export function threadCanvas(o: ThreadOpts = {}): HTMLCanvasElement {
  const cv = document.createElement('canvas')
  cv.width = T_CELL_W
  cv.height = T_CELL_H
  const ctx = cv.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  drawThread(ctx, o)
  return cv
}
