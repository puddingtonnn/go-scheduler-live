import { Application, Container, Graphics, Text } from 'pixi.js'
import type { GState, WorldState } from '../player/state'
import { computeLayout, placeAll, type Geom, type Rect } from './layout'
import { makeGopher, type Gopher } from './gopher'

const BG = 0x0f172a
const CARD_FILL = 0x172033
const CARD_HEADER_FILL = 0x1e293b
const BORDER = 0x334155
const PLATFORM_FILL = 0x334155
const PLATFORM_BORDER = 0x64748b
const TXT_TITLE = 0xf8fafc
const TXT_LABEL = 0xcbd5e1
const TXT_MUTED = 0x64748b
const PULSE_MS = 1000

const STATE_COLOR: Record<GState, number> = {
  running: 0x4ade80,
  runnable: 0xfbbf24,
  waiting: 0x60a5fa,
  syscall: 0xc084fc,
  dead: 0x475569,
}

const LEGEND: ReadonlyArray<[number, string]> = [
  [STATE_COLOR.running, 'бежит'],
  [STATE_COLOR.runnable, 'готова'],
  [STATE_COLOR.waiting, 'ждёт'],
  [STATE_COLOR.syscall, 'syscall'],
  [0xef4444, 'кража (вспышка)'],
]

interface Rec {
  g: Gopher
  tx: number
  ty: number
  pulse: number
  wasSteal: boolean
}

// Scene renders the WorldState with PixiJS: a row of per-P lane cards on the
// left, global/waiting/syscall cards on the right, a color legend at the bottom.
// setWorld assigns each gopher a target; the ticker eases sprites toward targets
// and decays steal flashes. The canvas fills the window and re-lays-out on resize.
export class Scene {
  private gophers = new Map<number, Rec>()
  private readonly staticLayer = new Container()
  private readonly gopherLayer = new Container()
  private geom: Geom
  private lastWorld?: WorldState

  private constructor(
    private readonly app: Application,
    private numProcs: number,
  ) {
    app.stage.addChild(this.staticLayer, this.gopherLayer)
    this.geom = computeLayout(numProcs, app.screen.width, app.screen.height)
    this.drawStatic()
    app.ticker.add((t) => this.tick(t.deltaMS))
  }

  static async create(parent: HTMLElement, numProcs: number): Promise<Scene> {
    const app = new Application()
    await app.init({ resizeTo: parent, background: BG, antialias: true })
    parent.appendChild(app.canvas)

    const scene = new Scene(app, numProcs)
    window.addEventListener('resize', () => scene.relayout())
    return scene
  }

  // reset reconfigures the scene for a new run (possibly different GOMAXPROCS),
  // clearing all gophers and redrawing the layout.
  reset(numProcs: number): void {
    this.numProcs = numProcs
    for (const rec of this.gophers.values()) rec.g.container.destroy()
    this.gophers.clear()
    this.lastWorld = undefined
    this.relayout()
  }

  setWorld(world: WorldState): void {
    this.lastWorld = world
    this.place(world)
  }

  private relayout(): void {
    this.geom = computeLayout(this.numProcs, this.app.screen.width, this.app.screen.height)
    this.drawStatic()
    if (this.lastWorld) this.place(this.lastWorld)
  }

  private place(world: WorldState): void {
    const places = placeAll(world, this.geom)

    for (const [gid, p] of places) {
      let rec = this.gophers.get(gid)
      if (!rec) {
        const g = makeGopher()
        g.container.position.set(p.x, p.y)
        this.gopherLayer.addChild(g.container)
        rec = { g, tx: p.x, ty: p.y, pulse: 0, wasSteal: false }
        this.gophers.set(gid, rec)
      }
      rec.tx = p.x
      rec.ty = p.y

      const v = world.goroutines.get(gid)!
      rec.g.setColor(STATE_COLOR[v.state])

      const stealNow = v.state === 'running' && v.stolen
      if (stealNow && !rec.wasSteal) rec.pulse = 1
      rec.wasSteal = stealNow
    }

    for (const [gid, rec] of this.gophers) {
      if (!places.has(gid)) {
        rec.g.container.destroy()
        this.gophers.delete(gid)
      }
    }
  }

  private tick(dtMs: number): void {
    const k = 1 - Math.pow(0.0015, dtMs / 1000)
    for (const rec of this.gophers.values()) {
      const c = rec.g.container
      c.x += (rec.tx - c.x) * k
      c.y += (rec.ty - c.y) * k

      if (rec.pulse > 0) {
        rec.pulse = Math.max(0, rec.pulse - dtMs / PULSE_MS)
        rec.g.setPulse(rec.pulse)
        c.scale.set(1 + 0.85 * rec.pulse)
      } else if (c.scale.x !== 1) {
        c.scale.set(1)
        rec.g.setPulse(0)
      }
    }
  }

  private drawStatic(): void {
    for (const child of this.staticLayer.removeChildren()) child.destroy()
    const g = this.geom
    const gfx = new Graphics()

    for (const lane of g.lanes) {
      card(gfx, lane.rect)
      gfx.rect(lane.rect.x + 10, lane.rect.y + 58, lane.rect.w - 20, 1).fill(BORDER)
      const p = lane.platform
      const w = 72
      const h = 30
      gfx
        .poly([p.x, p.y - h / 2, p.x + w / 2, p.y, p.x, p.y + h / 2, p.x - w / 2, p.y])
        .fill(PLATFORM_FILL)
        .stroke({ width: 2, color: PLATFORM_BORDER })
    }
    for (const z of [g.global, g.waiting, g.syscall]) {
      card(gfx, z)
      gfx.rect(z.x + 10, z.y + 26, z.w - 20, 1).fill(BORDER)
    }
    this.staticLayer.addChild(gfx)

    this.staticLayer.addChild(label('Планировщик Go — G · M · P', g.title.x, g.title.y, 'left', 16, TXT_TITLE))
    for (const lane of g.lanes) {
      this.staticLayer.addChild(label(`P${lane.pid}`, lane.platform.x, lane.rect.y + 8, 'center', 13, TXT_LABEL))
      this.staticLayer.addChild(label('локальная очередь', lane.rect.x + 10, lane.bodyTop - 20, 'left', 10, TXT_MUTED))
    }
    this.staticLayer.addChild(label('Глобальная очередь', g.global.x + 10, g.global.y + 7, 'left', 12, TXT_LABEL))
    this.staticLayer.addChild(label('Ожидание (заблокированы)', g.waiting.x + 10, g.waiting.y + 7, 'left', 12, TXT_LABEL))
    this.staticLayer.addChild(label('Syscall', g.syscall.x + 10, g.syscall.y + 7, 'left', 12, TXT_LABEL))

    this.drawLegend(g.legend)
  }

  private drawLegend(r: Rect): void {
    const gfx = new Graphics()
    this.staticLayer.addChild(gfx)
    const y = r.y + r.h / 2
    let x = r.x + 4
    for (const [color, text] of LEGEND) {
      if (color === 0xef4444) gfx.circle(x + 7, y, 6).stroke({ width: 2, color })
      else gfx.circle(x + 7, y, 6).fill(color)
      const t = label(text, x + 20, y - 7, 'left', 12, TXT_LABEL)
      this.staticLayer.addChild(t)
      x += 20 + t.width + 24
    }
  }
}

function card(gfx: Graphics, r: Rect): void {
  gfx.roundRect(r.x, r.y, r.w, r.h, 10).fill(CARD_FILL).stroke({ width: 1, color: BORDER })
  gfx.roundRect(r.x, r.y, r.w, 26, 10).fill(CARD_HEADER_FILL)
}

function label(text: string, x: number, y: number, align: 'center' | 'left', size: number, color: number): Text {
  const t = new Text({ text, style: { fill: color, fontSize: size, fontFamily: 'monospace' } })
  t.x = align === 'center' ? x - t.width / 2 : x
  t.y = y
  return t
}
