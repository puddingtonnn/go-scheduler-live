import { Application, Container, Graphics, Texture, type FederatedPointerEvent } from 'pixi.js'
import type { GState, GoroutineView, WorldState } from '../player/state'
import { PAL } from './palette'
import { gopherCanvas, type GopherOpts } from './drawgopher'
import { drawGrid, drawStation, stationPositions, WORLD_W, WORLD_H, type Pt } from './iso'
import { placeIso } from './layout'
import { makeGopher, type Gopher } from './gopher'

const STW_HOLD_MS = 700
const PULSE_MS = 900

const STATE_RU: Record<GState, string> = {
  running: 'бежит',
  runnable: 'готова',
  waiting: 'ждёт',
  syscall: 'syscall',
  dead: 'завершилась',
}

interface Rec {
  g: Gopher
  tx: number
  ty: number
  pulse: number
  wasSteal: boolean
  view?: GoroutineView
  base: Texture // current per-state (or frozen) body texture
}

function bakeTextures() {
  const t = (o: GopherOpts): Texture => {
    const tx = Texture.from(gopherCanvas(o))
    tx.source.scaleMode = 'nearest'
    return tx
  }
  return {
    running: t({ state: 'running', run: true }),
    runnable: t({ state: 'runnable' }),
    waiting: t({ state: 'waiting', zzz: true, blink: true }),
    syscall: t({ state: 'syscall', flip: true, dots: true }),
    dead: t({ state: 'dead' }),
    steal: t({ state: 'steal', run: true, bang: true, ring: 18 }),
    frozen: t({ frozen: true }),
  }
}

// Scene renders the isometric pixel-art world: a faint floor grid + N P-stations
// in a base-sized world container scaled to fit, with one gopher Sprite per
// goroutine placed by placeIso and depth-sorted by screen-y. Hovering shows a
// tooltip; the id toggle labels goroutines. Chrome (GC/heap/legend/caption) is
// DOM, added in a later slice.
export class Scene {
  /** fired after every fit() (resize) so DOM chrome can re-anchor zone pills. */
  onLayout?: () => void

  private gophers = new Map<number, Rec>()
  private readonly world = new Container()
  private readonly grid = new Graphics()
  private readonly stationsG = new Graphics()
  private readonly gopherLayer = new Container()
  private readonly stwOverlay = new Graphics()
  private readonly tex = bakeTextures()
  private showIds = false
  private stwHold = 0
  private wasStw = false
  private tooltip!: HTMLDivElement
  // current world→canvas transform (set by fit()); canvas fills the stage at 0,0
  // so these map a base-world point straight to stage px for DOM overlays.
  private scale = 1
  private offX = 0
  private offY = 0

  private constructor(
    private readonly app: Application,
    private numProcs: number,
  ) {
    this.gopherLayer.sortableChildren = true
    this.world.addChild(this.grid, this.stationsG, this.gopherLayer, this.stwOverlay)
    app.stage.addChild(this.world)
    drawGrid(this.grid)
    this.grid.alpha = 0.5
    this.buildStations()
    this.fit()
    app.ticker.add((tk) => this.tick(tk.deltaMS))
  }

  static async create(parent: HTMLElement, numProcs: number): Promise<Scene> {
    const app = new Application()
    await app.init({ resizeTo: parent, background: PAL.bg0, antialias: false })
    parent.appendChild(app.canvas)

    const scene = new Scene(app, numProcs)
    scene.tooltip = makeTooltip(parent)
    window.addEventListener('resize', () => scene.fit())
    return scene
  }

  reset(numProcs: number): void {
    this.numProcs = numProcs
    for (const rec of this.gophers.values()) rec.g.container.destroy()
    this.gophers.clear()
    this.buildStations()
  }

  setWorld(world: WorldState): void {
    this.updateStw(world)
    this.place(world)
  }

  toggleIds(): boolean {
    this.showIds = !this.showIds
    for (const rec of this.gophers.values()) rec.g.showLabel(this.showIds)
    return this.showIds
  }

  private buildStations(): void {
    this.stationsG.clear()
    for (const st of stationPositions(this.numProcs)) drawStation(this.stationsG, st.x, st.y)
  }

  // worldToScreen maps a base-world point (460x248 space) to stage px, so DOM
  // zone pills track the iso clusters as the canvas scales and recenters.
  worldToScreen(p: Pt): Pt {
    return { x: this.offX + p.x * this.scale, y: this.offY + p.y * this.scale }
  }

  private fit(): void {
    const s = Math.min(this.app.screen.width / WORLD_W, this.app.screen.height / WORLD_H)
    this.scale = s
    this.offX = (this.app.screen.width - WORLD_W * s) / 2
    this.offY = (this.app.screen.height - WORLD_H * s) / 2
    this.world.scale.set(s)
    this.world.x = this.offX
    this.world.y = this.offY
    this.stwOverlay.clear()
    this.stwOverlay
      .rect(0, 0, WORLD_W, WORLD_H)
      .fill({ color: PAL.gcStw, alpha: 0.1 })
      .stroke({ width: 2 / s, color: PAL.gcStw, alpha: 0.5 })
    this.stwOverlay.visible = this.stwHold > 0
    this.onLayout?.()
  }

  private place(world: WorldState): void {
    const places = placeIso(world, this.numProcs)
    const frozen = this.stwHold > 0
    for (const [gid, p] of places) {
      let rec = this.gophers.get(gid)
      if (!rec) rec = this.spawn(gid, p.x, p.y)
      rec.tx = p.x
      rec.ty = p.y
      const v = world.goroutines.get(gid)!
      rec.view = v
      rec.base = frozen ? this.tex.frozen : this.tex[v.state]
      rec.g.setTexture(rec.pulse > 0 ? this.tex.steal : rec.base)
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
    g.container.zIndex = y
    g.setLabel(`G${gid}`)
    g.showLabel(this.showIds)

    const c = g.container
    c.eventMode = 'static'
    c.cursor = 'pointer'
    c.on('pointerover', (e: FederatedPointerEvent) => this.showTip(gid, e))
    c.on('pointermove', (e: FederatedPointerEvent) => this.positionTip(e))
    c.on('pointerout', () => this.hideTip())

    this.gopherLayer.addChild(c)
    const rec: Rec = { g, tx: x, ty: y, pulse: 0, wasSteal: false, base: this.tex.runnable }
    this.gophers.set(gid, rec)
    return rec
  }

  private updateStw(world: WorldState): void {
    const stwNow = world.gcActive.some((n) => n.includes('stop-the-world'))
    if (stwNow && !this.wasStw) this.stwHold = 1
    this.wasStw = stwNow
    this.stwOverlay.visible = stwNow || this.stwHold > 0
  }

  private tick(dtMs: number): void {
    const k = 1 - Math.pow(0.0015, dtMs / 1000)
    if (this.stwHold > 0) this.stwHold = Math.max(0, this.stwHold - dtMs / STW_HOLD_MS)
    for (const rec of this.gophers.values()) {
      const c = rec.g.container
      c.x += (rec.tx - c.x) * k
      c.y += (rec.ty - c.y) * k
      c.zIndex = c.y
      if (rec.pulse > 0) {
        rec.pulse = Math.max(0, rec.pulse - dtMs / PULSE_MS)
        c.scale.set(1 + 0.4 * rec.pulse)
        rec.g.setTexture(this.tex.steal) // red steal sprite during the pop
      } else {
        if (c.scale.x !== 1) c.scale.set(1)
        rec.g.setTexture(rec.base)
      }
    }
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
    'background:#181b29;color:#e7eafb;border:1px solid #2f344e;border-radius:3px;' +
    'padding:4px 8px;font:12px ui-monospace,monospace;white-space:nowrap'
  parent.appendChild(t)
  return t
}
