import { Application, Container, Graphics, Texture, type FederatedPointerEvent } from 'pixi.js'
import type { GState, GoroutineView, WorldState } from '../player/state'
import type { Timeline, TimelineEvent } from '../model/timeline'
import { gcSummary, stwInWindow, isPlaybackStep, type GcSummary } from '../player/gc'
import { stealBurst, STEAL_LOOKBACK_NS } from '../player/steal'
import { PAL, stateColors } from './palette'
import { gopherCanvas, type GopherOpts } from './drawgopher'
import {
  drawGrid,
  drawStation,
  drawIdleMarker,
  drawStationGlow,
  drawZoneFloor,
  drawProps,
  stationPositions,
  WORLD_W,
  WORLD_H,
  type Pt,
} from './iso'
import { GLOBAL, WAITING, SYSCALL, placeIso } from './layout'
import { makeGopher, type Gopher } from './gopher'

const POOF_MS = 320
// STW is a real but sub-millisecond pause; we flash it as a brief blink (the world
// truly freezes, but only for an instant) — never a long held freeze, which would
// misrepresent modern Go's whole achievement. The honest duration lives in the
// caption ("84µs") and the to-scale GC strip; this is just a visible cue.
const STW_FLASH_MS = 320
const GLOW_MS = 600

const STATE_RU: Record<GState, string> = {
  running: 'бежит',
  runnable: 'готова',
  waiting: 'ждёт',
  syscall: 'syscall',
  dead: 'завершилась',
}

type AnimKind = GState

interface Rec {
  g: Gopher
  tx: number
  ty: number
  scale: number
  view?: GoroutineView
  kind: AnimKind
  phase: number // per-gopher animation phase offset (de-syncs the crowd)
  dying: number // dead-poof timer (ms remaining); 0 = alive
}

// bakeTextures bakes a small frame atlas per animated state once; the scene cycles
// the frames on a wall clock (see FPS) with a per-gopher phase offset.
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
    frozen: t({ frozen: true, bang: true }),
  }
}

const FPS: Record<AnimKind, number> = { running: 8, runnable: 0, waiting: 4, syscall: 3, dead: 0 }

// Scene renders the isometric pixel-art world: floor grid + cozy props + N
// P-stations (with idle-P markers), zone floor platters, and one gopher Sprite per
// goroutine placed+scaled by placeIso and depth-sorted by screen-y. A steal shows
// as an aggregate amber glow on the destination P (driven by the reconstructed
// steal bursts, never a per-goroutine flash); a stop-the-world shows as a brief
// red vignette blink whose real duration is reported by the chrome caption.
export class Scene {
  /** fired after every fit() (resize) so DOM chrome can re-anchor zone pills. */
  onLayout?: () => void

  private gophers = new Map<number, Rec>()
  private readonly world = new Container()
  private readonly grid = new Graphics()
  private readonly stationsG = new Graphics()
  private readonly zoneFloorG = new Graphics()
  private readonly fxG = new Graphics()
  private readonly gopherLayer = new Container()
  private readonly stwOverlay = new Graphics()
  private readonly tex = bakeTextures()
  private showIds = true
  private animT = 0
  private tooltip!: HTMLDivElement
  private scale = 1
  private offX = 0
  private offY = 0

  // event-cue state
  private events: TimelineEvent[] = []
  private gc: GcSummary = { cycles: 0, stw: [], mark: [], maxStwNs: 0 }
  private durationNs = 0
  private lastT = -1
  private stwFlash = 0
  private stations: Pt[] = []
  private occupied: boolean[] = []
  private stationGlow: number[] = []

  private constructor(
    private readonly app: Application,
    private numProcs: number,
  ) {
    this.gopherLayer.sortableChildren = true
    this.world.addChild(this.grid, this.zoneFloorG, this.stationsG, this.fxG, this.gopherLayer, this.stwOverlay)
    app.stage.addChild(this.world)
    drawGrid(this.grid)
    this.grid.alpha = 0.5
    drawProps(this.zoneFloorG)
    this.buildStatics()
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
    this.buildStatics()
  }

  // loadTimeline wires the per-run trace so the scene can fire the GC/steal cues
  // and reset its step-window tracking.
  loadTimeline(tl: Timeline): void {
    this.events = tl.events
    this.gc = gcSummary(tl)
    this.durationNs = tl.meta.durationNs
    this.lastT = -1
    this.stwFlash = 0
    this.stationGlow = this.stations.map(() => 0)
  }

  setWorld(world: WorldState): void {
    this.detectCues(world)
    this.place(world)
  }

  toggleIds(): boolean {
    this.showIds = !this.showIds
    for (const rec of this.gophers.values()) rec.g.showLabel(this.showIds)
    return this.showIds
  }

  private buildStatics(): void {
    this.stations = stationPositions(this.numProcs)
    this.occupied = this.stations.map(() => false)
    this.stationGlow = this.stations.map(() => 0)
    this.stationsG.clear()
    for (const st of this.stations) drawStation(this.stationsG, st.x, st.y)
    this.zoneFloorG.clear()
    drawProps(this.zoneFloorG)
    drawZoneFloor(this.zoneFloorG, GLOBAL.x, GLOBAL.y, GLOBAL.w, GLOBAL.h, PAL.runnable)
    drawZoneFloor(this.zoneFloorG, WAITING.x, WAITING.y, WAITING.w, WAITING.h, PAL.waiting)
    drawZoneFloor(this.zoneFloorG, SYSCALL.x, SYSCALL.y, SYSCALL.w, SYSCALL.h, PAL.syscall)
  }

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
    // red edge vignette: a thick stroke on the world bounds (half clipped outside)
    // reads as the screen edges flashing, not a full-screen freeze tint.
    this.stwOverlay.rect(0, 0, WORLD_W, WORLD_H).stroke({ width: 30, color: PAL.gcStw, alpha: 1 })
    this.onLayout?.()
  }

  // detectCues looks at the playback step (lastT, t] for a stop-the-world pause and
  // for reconstructed steal bursts, firing the brief vignette / station glow. Big
  // jumps (scrubbing) are ignored so a seek doesn't spuriously flash.
  private detectCues(world: WorldState): void {
    const t = world.t
    this.occupied = this.stations.map((_, pid) => (world.procs[pid]?.gid ?? -1) >= 0)
    if (isPlaybackStep(this.lastT, t, this.durationNs)) {
      if (stwInWindow(this.gc, this.lastT, t)) this.stwFlash = 1
      const burst = stealBurst(this.events, t, STEAL_LOOKBACK_NS)
      if (burst && burst.pid < this.stationGlow.length) this.stationGlow[burst.pid] = 1
    }
    this.lastT = t
  }

  private place(world: WorldState): void {
    const places = placeIso(world, this.numProcs)
    for (const [gid, p] of places) {
      let rec = this.gophers.get(gid)
      if (!rec) rec = this.spawn(gid, p.x, p.y)
      rec.dying = 0
      rec.tx = p.x
      rec.ty = p.y
      if (rec.scale !== p.scale) {
        rec.scale = p.scale
        rec.g.setScale(p.scale)
      }
      const v = world.goroutines.get(gid)!
      const prevState = rec.view?.state
      rec.view = v
      if (v.state !== prevState) rec.g.setTagColor(stateColors(v.state)[0])
      rec.kind = v.state
    }
    // gophers no longer placed: dead ones poof out (tick), the rest removed.
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
    const rec: Rec = { g, tx: x, ty: y, scale: 1, kind: 'runnable', phase: (gid % 17) * 0.37, dying: 0 }
    this.gophers.set(gid, rec)
    return rec
  }

  private tick(dtMs: number): void {
    const k = 1 - Math.pow(0.0015, dtMs / 1000)
    this.animT += dtMs / 1000
    if (this.stwFlash > 0) this.stwFlash = Math.max(0, this.stwFlash - dtMs / STW_FLASH_MS)
    this.stwOverlay.alpha = this.stwFlash * 0.45
    this.stwOverlay.visible = this.stwFlash > 0

    // fx layer: idle-P markers + fading steal glows
    let glowing = false
    this.fxG.clear()
    for (let pid = 0; pid < this.stations.length; pid++) {
      const st = this.stations[pid]
      if (!this.occupied[pid]) drawIdleMarker(this.fxG, st.x, st.y)
      if (this.stationGlow[pid] > 0) {
        this.stationGlow[pid] = Math.max(0, this.stationGlow[pid] - dtMs / GLOW_MS)
        drawStationGlow(this.fxG, st.x, st.y, this.stationGlow[pid])
        glowing = glowing || this.stationGlow[pid] > 0
      }
    }

    const frozen = this.stwFlash > 0
    for (const [gid, rec] of this.gophers) {
      const c = rec.g.container

      if (rec.dying > 0) {
        rec.dying -= dtMs
        const a = Math.max(0, rec.dying / POOF_MS)
        rec.g.setAlpha(a)
        // poof grows the CONTAINER (sprite keeps its own setScale, so zone gophers
        // at 0.55 still poof from their reduced size — the two scales compose).
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

      this.applyMotion(rec, frozen)
      rec.g.setTexture(frozen ? this.tex.frozen : this.frameFor(rec))
    }
  }

  private frameFor(rec: Rec): Texture {
    const frames = this.tex[rec.kind]
    const fps = FPS[rec.kind]
    if (fps <= 0 || frames.length <= 1) return frames[0]
    const i = Math.floor(this.animT * fps + rec.phase) % frames.length
    return frames[i]
  }

  private applyMotion(rec: Rec, frozen: boolean): void {
    if (frozen) {
      rec.g.setOffset(0, 0)
      return
    }
    const tphase = this.animT + rec.phase
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
