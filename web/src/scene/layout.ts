import type { WorldState } from '../player/state'

export interface Point {
  x: number
  y: number
}
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

// A Lane is one processor P drawn as a self-contained card: the platform (where
// the running goroutine stands) at the top, its local run queue stacked below.
export interface Lane {
  pid: number
  rect: Rect
  platform: Point
  bodyTop: number // y where the local queue starts
}

export interface Geom {
  width: number
  height: number
  slot: number
  title: Point
  lanes: Lane[]
  global: Rect // runnable goroutines with no associated P
  waiting: Rect // blocked goroutines
  syscall: Rect
  legend: Rect
  hud: Rect // top-right strip: GC phase chip + heap bar
}

const CARD_HEADER = 30 // reserved header height inside side cards before packing
const CARD_PAD = 10

export function computeLayout(numProcs: number, width: number, height: number): Geom {
  const margin = 20
  const gap = 12
  const slot = 26
  const titleH = 40
  const legendH = 40

  const contentTop = titleH + margin
  const contentBottom = height - legendH - margin
  const contentH = Math.max(160, contentBottom - contentTop)

  const innerW = width - margin * 2
  const rightW = Math.min(340, Math.max(220, innerW * 0.26))
  const leftW = innerW - rightW - gap

  const n = Math.max(1, numProcs)
  const laneW = (leftW - gap * (n - 1)) / n
  const lanes: Lane[] = Array.from({ length: n }, (_, i) => {
    const x = margin + i * (laneW + gap)
    return {
      pid: i,
      rect: { x, y: contentTop, w: laneW, h: contentH },
      platform: { x: x + laneW / 2, y: contentTop + 34 },
      bodyTop: contentTop + 74,
    }
  })

  const rightX = margin + leftW + gap
  const cardH = (contentH - gap * 2) / 3
  const card = (k: number): Rect => ({ x: rightX, y: contentTop + (cardH + gap) * k, w: rightW, h: cardH })

  return {
    width,
    height,
    slot,
    title: { x: margin, y: 14 },
    lanes,
    global: card(0),
    waiting: card(1),
    syscall: card(2),
    legend: { x: margin, y: height - legendH, w: innerW, h: legendH },
    hud: { x: Math.max(360, width * 0.42), y: 6, w: width - margin - Math.max(360, width * 0.42), h: 30 },
  }
}

// packInRect places item i into a left-to-right, top-to-bottom grid inside r,
// below a reserved header.
function packInRect(r: Rect, i: number, slot: number): Point {
  const cols = Math.max(1, Math.floor((r.w - CARD_PAD * 2) / slot))
  const col = i % cols
  const row = Math.floor(i / cols)
  return {
    x: r.x + CARD_PAD + slot / 2 + col * slot,
    y: r.y + CARD_HEADER + slot / 2 + row * slot,
  }
}

// placeAll assigns a target position to every live goroutine, grouping by state
// into lanes (per-P) and side cards, packing each deterministically (sorted by
// gid). Pure, so the slotting is unit-tested. Dead goroutines get no placement.
export function placeAll(world: WorldState, g: Geom): Map<number, Point> {
  const out = new Map<number, Point>()
  const localCount = g.lanes.map(() => 0)
  let globalN = 0
  let waitN = 0
  let sysN = 0

  const laneFor = (pid: number): Lane | undefined =>
    pid >= 0 && pid < g.lanes.length ? g.lanes[pid] : undefined

  const gids = [...world.goroutines.keys()].sort((a, b) => a - b)
  for (const gid of gids) {
    const v = world.goroutines.get(gid)!
    switch (v.state) {
      case 'running': {
        const lane = laneFor(v.pid) ?? g.lanes[0]
        out.set(gid, { x: lane.platform.x, y: lane.platform.y })
        break
      }
      case 'runnable': {
        const lane = laneFor(v.pid)
        if (lane) {
          const i = localCount[lane.pid]++
          const cols = Math.max(1, Math.floor((lane.rect.w - CARD_PAD * 2) / g.slot))
          out.set(gid, {
            x: lane.rect.x + CARD_PAD + g.slot / 2 + (i % cols) * g.slot,
            y: lane.bodyTop + g.slot / 2 + Math.floor(i / cols) * g.slot,
          })
        } else {
          out.set(gid, packInRect(g.global, globalN++, g.slot))
        }
        break
      }
      case 'waiting':
        out.set(gid, packInRect(g.waiting, waitN++, g.slot))
        break
      case 'syscall':
        out.set(gid, packInRect(g.syscall, sysN++, g.slot))
        break
      case 'dead':
        break
    }
  }
  return out
}
