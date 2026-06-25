import { Application, Container, Graphics, Texture, type FederatedPointerEvent } from 'pixi.js'
import type { GState, GoroutineView, WorldState } from '../player/state'
import { PAL, stateColors } from './palette'
import { gopherCanvas, type GopherOpts } from './drawgopher'
import { drawGrid, drawStation, stationPositions, WORLD_W, WORLD_H, type Pt } from './iso'
import { placeIso } from './layout'
import { makeGopher, type Gopher } from './gopher'

const STW_HOLD_MS = 700
const PULSE_MS = 900
const POOF_MS = 320

const STATE_RU: Record<GState, string> = {
  running: 'бежит',
  runnable: 'готова',
  waiting: 'ждёт',
  syscall: 'syscall',
  dead: 'завершилась',
}

type AnimKind = GState | 'frozen'

interface Rec {
  g: Gopher
  tx: number
  ty: number
  pulse: number
  wasSteal: boolean
  view?: GoroutineView
  kind: AnimKind // which frame set to cycle
  phase: number // per-gopher animation phase offset (de-syncs the crowd)
  dying: number // dead-poof timer (ms remaining); 0 = alive
}

// bakeTextures bakes a small frame atlas per animated state once; the scene
// cycles the frames on a wall clock (see FPS) with a per-gopher phase offset.
// Continuous motion that needs no new texture (bob/sway/breathe/steal arc) is
// applied as a sprite offset in tick().
function bakeTextures() {
  const t = (o: GopherOpts): Texture => {
    const tx = Texture.from(gopherCanvas(o))
    tx.source.scaleMode = 'nearest'
    return tx
  }
  const arr = (os: GopherOpts[]): Texture[] => os.map(t)
  return {
    running: arr([
      { state: 'running', work: true, armPhase: 1, laptop: true, screenLit: true },
      { state: 'running', work: true, armPhase: -1, laptop: true, screenLit: false },
    ]),
    runnable: arr([{ state: 'runnable' }]),
    waiting: arr([
      { state: 'waiting', zzz: true, zt: 0, blink: true },
      { state: 'waiting', zzz: true, zt: 0.34, blink: true },
      { state: 'waiting', zzz: true, zt: 0.68, blink: true },
    ]),
    syscall: arr([
      { state: 'syscall', flip: true, dots: 1 },
      { state: 'syscall', flip: true, dots: 2 },
      { state: 'syscall', flip: true, dots: 3 },
    ]),
    dead: arr([{ state: 'dead', dead: true }]),
    steal: arr([
      { state: 'steal', run: true, armPhase: 1, bang: true, ring: 8, ringA: 1, motion: true },
      { state: 'steal', run: true, armPhase: -1, bang: true, ring: 14, ringA: 0.7, motion: true },
      { state: 'steal', run: true, armPhase: 1, bang: true, ring: 20, ringA: 0.35, motion: true },
    ]),
    frozen: t({ frozen: true, bang: true }),
  }
}

// animation frames-per-second per state (0 = single frame, no cycling).
const FPS: Record<AnimKind, number> = { running: 8, runnable: 0, waiting: 4, syscall: 3, dead: 0, frozen: 0 }

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
  private showIds = true
  private stwHold = 0
  private wasStw = false
  private animT = 0
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
      rec.dying = 0
      rec.tx = p.x
      rec.ty = p.y
      const v = world.goroutines.get(gid)!
      const prevState = rec.view?.state
      rec.view = v
      if (v.state !== prevState) rec.g.setTagColor(stateColors(v.state)[0])
      rec.kind = frozen ? 'frozen' : v.state
      const stealNow = v.state === 'running' && v.stolen
      if (stealNow && !rec.wasSteal) rec.pulse = 1
      rec.wasSteal = stealNow
    }
    // gophers no longer placed: dead ones poof out (tick), the rest (capped /
    // gone) are removed immediately.
    for (const [gid, rec] of this.gophers) {
      if (places.has(gid) || rec.dying > 0) continue
      if (world.goroutines.get(gid)?.state === 'dead') {
        rec.dying = POOF_MS
        rec.kind = 'dead'
      } else {
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
    const rec: Rec = { g, tx: x, ty: y, pulse: 0, wasSteal: false, kind: 'runnable', phase: (gid % 17) * 0.37, dying: 0 }
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
    this.animT += dtMs / 1000
    if (this.stwHold > 0) this.stwHold = Math.max(0, this.stwHold - dtMs / STW_HOLD_MS)
    for (const [gid, rec] of this.gophers) {
      const c = rec.g.container

      // dead poof: fade + grow, then remove
      if (rec.dying > 0) {
        rec.dying -= dtMs
        const a = Math.max(0, rec.dying / POOF_MS)
        rec.g.setAlpha(a)
        c.scale.set(1 + (1 - a) * 0.5)
        rec.g.setTexture(this.tex.dead[0])
        if (rec.dying <= 0) {
          c.destroy()
          this.gophers.delete(gid)
        }
        continue
      }

      // ease toward target position; depth-sort by screen-y
      c.x += (rec.tx - c.x) * k
      c.y += (rec.ty - c.y) * k
      c.zIndex = c.y

      // steal pop: red frames, scale pop, arc lift along the in-flight ease
      if (rec.pulse > 0 && !(this.stwHold > 0)) {
        rec.pulse = Math.max(0, rec.pulse - dtMs / PULSE_MS)
        const prog = 1 - rec.pulse
        c.scale.set(1 + 0.35 * rec.pulse)
        rec.g.setOffset(0, -26 * Math.sin(Math.PI * prog))
        const f = Math.min(this.tex.steal.length - 1, Math.floor(prog * this.tex.steal.length))
        rec.g.setTexture(this.tex.steal[f])
        continue
      }

      if (c.scale.x !== 1) c.scale.set(1)
      this.applyMotion(rec)
      rec.g.setTexture(this.frameFor(rec))
    }
  }

  // frameFor picks the current atlas frame for a gopher's state on the wall clock.
  private frameFor(rec: Rec): Texture {
    if (rec.kind === 'frozen') return this.tex.frozen
    const frames = this.tex[rec.kind]
    const fps = FPS[rec.kind]
    if (fps <= 0 || frames.length <= 1) return frames[0]
    const i = Math.floor(this.animT * fps + rec.phase) % frames.length
    return frames[i]
  }

  // applyMotion sets the per-state continuous sprite offset (no new texture):
  // running bobs its head, runnable sways, waiting breathes.
  private applyMotion(rec: Rec): void {
    const tphase = this.animT + rec.phase
    if (rec.kind === 'frozen') {
      rec.g.setOffset(0, 0)
      return
    }
    switch (rec.kind) {
      case 'running':
        rec.g.setOffset(0, -Math.abs(Math.sin(tphase * 4.5)) * 1.6)
        break
      case 'runnable':
        rec.g.setOffset(Math.sin(tphase * 2.2) * 1.2, 0)
        break
      case 'waiting':
        rec.g.setOffset(0, Math.sin(tphase * 2) * 0.8)
        break
      default:
        rec.g.setOffset(0, 0)
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
  if (view.stolen && view.state === 'running') s += ' · украдена (реконстр.)'
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
