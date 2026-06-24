import { Application, Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js'
import type { GState, GoroutineView, WorldState } from '../player/state'
import { reasonCategory, REASON_CATEGORIES, type ReasonCategory } from '../player/reason'
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
const GC_MARK = 0xfbbf24
const GC_STW = 0xef4444
const PULSE_MS = 1000
const STW_HOLD_MS = 700 // hold the (sub-frame) stop-the-world banner this long

const STATE_COLOR: Record<GState, number> = {
  running: 0x4ade80,
  runnable: 0xfbbf24,
  waiting: 0x60a5fa,
  syscall: 0xc084fc,
  dead: 0x475569,
}

const STATE_RU: Record<GState, string> = {
  running: 'бежит',
  runnable: 'готова',
  waiting: 'ждёт',
  syscall: 'syscall',
  dead: 'завершилась',
}

const LEGEND: ReadonlyArray<[number, string]> = [
  [STATE_COLOR.running, 'бежит'],
  [STATE_COLOR.runnable, 'готова'],
  [STATE_COLOR.waiting, 'ждёт'],
  [STATE_COLOR.syscall, 'syscall'],
  [GC_STW, 'кража (вспышка)'],
]

interface Rec {
  g: Gopher
  tx: number
  ty: number
  pulse: number
  wasSteal: boolean
  view?: GoroutineView
}

// Scene renders the WorldState with PixiJS: per-P lane cards, global/waiting/
// syscall panels, a color legend, a top HUD (GC phase + heap) and a narration
// caption. Hovering a gopher shows a tooltip; an id toggle labels goroutines.
export class Scene {
  private gophers = new Map<number, Rec>()
  private readonly staticLayer = new Container()
  private readonly gopherLayer = new Container()
  private readonly stwOverlay = new Graphics()
  private readonly hudLayer = new Container()
  private readonly gcChip = new Graphics()
  private readonly heapGfx = new Graphics()
  private readonly gcLabel: Text
  private readonly heapLabel: Text
  private readonly captionLabel: Text
  private readonly waitingLabel: Text
  private geom: Geom
  private lastWorld?: WorldState
  private showIds = false
  private stwHold = 0
  private wasStw = false
  private tooltip!: HTMLDivElement

  private constructor(
    private readonly app: Application,
    private numProcs: number,
  ) {
    this.gcLabel = new Text({ text: 'GC: —', style: { fill: TXT_LABEL, fontSize: 13, fontFamily: 'monospace' } })
    this.heapLabel = new Text({ text: 'куча —', style: { fill: TXT_MUTED, fontSize: 12, fontFamily: 'monospace' } })
    this.captionLabel = new Text({ text: '', style: { fill: 0x93c5fd, fontSize: 14, fontFamily: 'monospace' } })
    this.captionLabel.anchor.set(0.5, 0)
    this.waitingLabel = new Text({ text: 'Ожидание', style: { fill: TXT_LABEL, fontSize: 12, fontFamily: 'monospace' } })

    this.stwOverlay.visible = false
    this.hudLayer.addChild(this.gcChip, this.gcLabel, this.heapGfx, this.heapLabel, this.captionLabel, this.waitingLabel)
    app.stage.addChild(this.staticLayer, this.gopherLayer, this.stwOverlay, this.hudLayer)

    this.geom = computeLayout(numProcs, app.screen.width, app.screen.height)
    this.drawStatic()
    app.ticker.add((t) => this.tick(t.deltaMS))
  }

  static async create(parent: HTMLElement, numProcs: number): Promise<Scene> {
    const app = new Application()
    await app.init({ resizeTo: parent, background: BG, antialias: true })
    parent.appendChild(app.canvas)

    const scene = new Scene(app, numProcs)
    scene.tooltip = makeTooltip(parent)
    window.addEventListener('resize', () => scene.relayout())
    return scene
  }

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
    this.updateHud(world)
    this.updateWaitingHeader(world)
  }

  // setCaption is driven by main (which has the timeline) via narrate().
  setCaption(text: string): void {
    this.captionLabel.text = text
    this.captionLabel.x = this.geom.width / 2
  }

  toggleIds(): boolean {
    this.showIds = !this.showIds
    for (const rec of this.gophers.values()) rec.g.showLabel(this.showIds)
    return this.showIds
  }

  private relayout(): void {
    this.geom = computeLayout(this.numProcs, this.app.screen.width, this.app.screen.height)
    this.drawStatic()
    this.stwOverlay.clear()
    this.stwOverlay.rect(0, 0, this.geom.width, this.geom.height).fill({ color: GC_STW, alpha: 0.12 })
    this.captionLabel.x = this.geom.width / 2
    this.captionLabel.y = 38
    this.waitingLabel.x = this.geom.waiting.x + 10
    this.waitingLabel.y = this.geom.waiting.y + 7
    if (this.lastWorld) {
      this.place(this.lastWorld)
      this.updateHud(this.lastWorld)
      this.updateWaitingHeader(this.lastWorld)
    }
  }

  private place(world: WorldState): void {
    const places = placeAll(world, this.geom)

    for (const [gid, p] of places) {
      let rec = this.gophers.get(gid)
      if (!rec) {
        rec = this.spawn(gid, p.x, p.y)
      }
      rec.tx = p.x
      rec.ty = p.y

      const v = world.goroutines.get(gid)!
      rec.view = v
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

  private spawn(gid: number, x: number, y: number): Rec {
    const g = makeGopher()
    g.container.position.set(x, y)
    g.setLabel(`G${gid}`)
    g.showLabel(this.showIds)

    const c = g.container
    c.eventMode = 'static'
    c.cursor = 'pointer'
    c.on('pointerover', (e: FederatedPointerEvent) => this.showTip(gid, e))
    c.on('pointermove', (e: FederatedPointerEvent) => this.positionTip(e))
    c.on('pointerout', () => this.hideTip())

    this.gopherLayer.addChild(c)
    const rec: Rec = { g, tx: x, ty: y, pulse: 0, wasSteal: false }
    this.gophers.set(gid, rec)
    return rec
  }

  private showTip(gid: number, e: FederatedPointerEvent): void {
    const view = this.gophers.get(gid)?.view
    if (!view) return
    this.tooltip.textContent = formatTip(gid, view)
    this.tooltip.style.display = 'block'
    this.positionTip(e)
  }

  private positionTip(e: FederatedPointerEvent): void {
    const ne = e.nativeEvent as PointerEvent
    this.tooltip.style.left = `${ne.clientX + 12}px`
    this.tooltip.style.top = `${ne.clientY + 12}px`
  }

  private hideTip(): void {
    this.tooltip.style.display = 'none'
  }

  private updateHud(world: WorldState): void {
    const stwNow = world.gcActive.some((n) => n.includes('stop-the-world'))
    const mark = world.gcActive.some((n) => n.includes('mark phase'))
    if (stwNow && !this.wasStw) this.stwHold = 1
    this.wasStw = stwNow
    const stw = stwNow || this.stwHold > 0

    this.stwOverlay.visible = stw
    const hud = this.geom.hud
    this.gcLabel.x = hud.x + 10
    this.gcLabel.y = hud.y + 6
    this.gcChip.clear()
    if (stw || mark) {
      const color = stw ? GC_STW : GC_MARK
      this.gcLabel.text = stw ? 'GC: STOP-THE-WORLD' : 'GC: concurrent mark'
      this.gcLabel.style.fill = color
      this.gcChip
        .roundRect(hud.x, hud.y, this.gcLabel.width + 20, 28, 6)
        .fill({ color, alpha: 0.18 })
        .stroke({ width: 1, color })
    } else {
      this.gcLabel.text = 'GC: —'
      this.gcLabel.style.fill = TXT_MUTED
    }

    this.drawHeapBar(world.heapLive, world.heapGoal)
  }

  private updateWaitingHeader(world: WorldState): void {
    const counts = new Map<ReasonCategory, number>()
    for (const v of world.goroutines.values()) {
      if (v.state !== 'waiting') continue
      const c = reasonCategory(v.reason)
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    const parts = REASON_CATEGORIES.filter((c) => counts.has(c)).map((c) => `${c} ${counts.get(c)}`)
    this.waitingLabel.text = parts.length ? `Ожидание · ${parts.join(' · ')}` : 'Ожидание (заблокированы)'
  }

  private drawHeapBar(live: number | undefined, goal: number | undefined): void {
    const hud = this.geom.hud
    const x = hud.x + 250
    const y = hud.y + 7
    const w = Math.max(80, Math.min(180, hud.w - 360))
    const h = 14
    this.heapGfx.clear()
    this.heapGfx.roundRect(x, y, w, h, 4).fill(0x1e293b).stroke({ width: 1, color: BORDER })
    if (live != null && goal != null && goal > 0) {
      const frac = Math.min(1, live / goal)
      this.heapGfx.roundRect(x, y, Math.max(2, w * frac), h, 4).fill(0x4ade80)
      this.heapLabel.text = `куча ${mb(live)} / ${mb(goal)} МБ`
    } else {
      this.heapLabel.text = 'куча —'
    }
    this.heapLabel.x = x + w + 8
    this.heapLabel.y = y - 1
  }

  private tick(dtMs: number): void {
    const k = 1 - Math.pow(0.0015, dtMs / 1000)
    if (this.stwHold > 0) this.stwHold = Math.max(0, this.stwHold - dtMs / STW_HOLD_MS)
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
    // The waiting header is dynamic (reason breakdown); global/syscall are static.
    this.staticLayer.addChild(label('Глобальная очередь', g.global.x + 10, g.global.y + 7, 'left', 12, TXT_LABEL))
    this.staticLayer.addChild(label('Syscall', g.syscall.x + 10, g.syscall.y + 7, 'left', 12, TXT_LABEL))

    this.drawLegend(g.legend)
  }

  private drawLegend(r: Rect): void {
    const gfx = new Graphics()
    this.staticLayer.addChild(gfx)
    const y = r.y + r.h / 2
    let x = r.x + 4
    for (const [color, text] of LEGEND) {
      if (color === GC_STW) gfx.circle(x + 7, y, 6).stroke({ width: 2, color })
      else gfx.circle(x + 7, y, 6).fill(color)
      const t = label(text, x + 20, y - 7, 'left', 12, TXT_LABEL)
      this.staticLayer.addChild(t)
      x += 20 + t.width + 24
    }
  }
}

function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1)
}

function formatTip(gid: number, view: GoroutineView): string {
  let s = `G${gid} • ${STATE_RU[view.state]}`
  if (view.state === 'waiting' && view.reason) s += `: ${view.reason}`
  else if ((view.state === 'running' || view.state === 'syscall') && view.pid >= 0) s += ` (P${view.pid})`
  return s
}

function makeTooltip(parent: HTMLElement): HTMLDivElement {
  const t = document.createElement('div')
  t.style.cssText =
    'position:fixed;display:none;pointer-events:none;z-index:10;' +
    'background:#1e293b;color:#e2e8f0;border:1px solid #475569;border-radius:6px;' +
    'padding:4px 8px;font:12px ui-monospace,monospace;white-space:nowrap'
  parent.appendChild(t)
  return t
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
