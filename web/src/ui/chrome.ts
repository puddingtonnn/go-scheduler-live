import type { WorldState } from '../player/state'
import type { TimelineEvent } from '../model/timeline'
import type { Scene } from '../scene/scene'
import { PAL } from '../scene/palette'
import { stationPositions, type Pt } from '../scene/iso'
import { GLOBAL, WAITING, SYSCALL, CAPS, zoneTotals } from '../scene/layout'
import { narrate } from '../player/narrate'
import { gcPhase, heapPct, waitingBreakdown } from './derive'

// Chrome is the DOM layer over the pixel canvas: header (title + GC indicator +
// heap bar), floating zone-label pills that track the iso clusters, a legend,
// the "what's happening" caption (narrate), the waiting-reasons breakdown, and
// the stop-the-world banner. The pixel world stays in WebGL; crisp Cyrillic text
// lives here in DOM. Pure derivations live in ./derive; this class is glue.

type ZoneKey = 'pstation' | 'local' | 'global' | 'waiting' | 'syscall'

const LEGEND: ReadonlyArray<readonly [string, string]> = [
  ['Выполняется', PAL.running],
  ['В очереди', PAL.runnable],
  ['Ожидание', PAL.waiting],
  ['Syscall', PAL.syscall],
  ['Кража', PAL.steal],
  ['STW', PAL.froT],
  ['Завершён', PAL.dead],
]

export class Chrome {
  readonly header: HTMLElement
  readonly legend: HTMLElement

  private scene: Scene | null = null
  private numProcs = 4
  private events: TimelineEvent[] = []

  private readonly gcDot: HTMLSpanElement
  private readonly gcLabel: HTMLSpanElement
  private readonly heapFill: HTMLDivElement
  private readonly heapPctEl: HTMLSpanElement
  private readonly caption: HTMLDivElement
  private readonly banner: HTMLDivElement
  private readonly waitSub: HTMLSpanElement
  private readonly pills: Record<ZoneKey, HTMLDivElement>
  private readonly over: Record<ZoneKey, HTMLSpanElement>
  private anchors: Record<ZoneKey, Pt>

  // last-rendered values, to skip per-frame DOM writes when nothing changed.
  private last = { gc: '', heap: -1, cap: '', wait: '', stw: false, over: '' }

  constructor(stage: HTMLElement) {
    // --- header ---
    const title = el('div', 'title')
    title.append('Планировщик Go ', el('span', 'accent', '· G·M·P'))
    this.gcDot = el('span', 'gc-dot')
    this.gcLabel = el('span', 'gc-label', 'GC: простой')
    const gc = el('div', 'gc')
    gc.append(this.gcDot, this.gcLabel)
    this.heapFill = el('div', 'heap-fill')
    const heapBar = el('div', 'heap-bar')
    heapBar.append(this.heapFill, el('div', 'heap-goal'))
    this.heapPctEl = el('span', 'heap-pct', '—')
    const heap = el('div', 'heap')
    heap.append(el('span', 'heap-cap', 'куча'), heapBar, this.heapPctEl)
    this.header = el('header', 'chrome-head')
    this.header.append(title, el('div', 'spacer'), gc, heap)

    // --- legend ---
    this.legend = el('div', 'chrome-legend')
    for (const [name, color] of LEGEND) {
      const dot = el('span', 'dot')
      dot.style.background = color
      dot.style.boxShadow = `0 0 5px ${color}88`
      const item = el('span', 'leg-item')
      item.append(dot, document.createTextNode(name))
      this.legend.append(item)
    }
    // honest footnote: what the trace gives vs what we reconstruct.
    this.legend.append(
      el(
        'div',
        'legend-note',
        'Локальные очереди и кража — реконструкция из трейса: простаивающий P крадёт ≈половину чужой локальной очереди; mark-assist отдельно не показан.',
      ),
    )

    // --- zone pills (positioned in layout() via the scene transform). Each pill
    // carries an "over" span for the "+N" count of goroutines beyond the render
    // cap, so a queue of 50 stays legible while still telling its true size. ---
    const over: Partial<Record<ZoneKey, HTMLSpanElement>> = {}
    const pill = (key: ZoneKey, text: string, color: string, center: boolean): HTMLDivElement => {
      const e = el('div', center ? 'zone-pill center' : 'zone-pill')
      e.style.color = color
      e.append(document.createTextNode(text))
      const ov = el('span', 'zone-over')
      e.append(ov)
      over[key] = ov
      stage.append(e)
      return e
    }
    const waiting = pill('waiting', 'Ожидание', PAL.waiting, true)
    this.waitSub = el('span', 'zone-sub')
    waiting.append(this.waitSub)
    this.pills = {
      pstation: pill('pstation', 'P-станции · выполнение', PAL.running, true),
      local: pill('local', 'локальная очередь', PAL.runnable, true),
      global: pill('global', 'Глобальная очередь', PAL.runnable, false),
      waiting,
      syscall: pill('syscall', 'Syscall', PAL.syscall, true),
    }
    this.over = over as Record<ZoneKey, HTMLSpanElement>

    // --- caption + STW banner (stage-relative, not world-tracked) ---
    this.caption = el('div', 'caption')
    this.caption.style.display = 'none'
    this.banner = el('div', 'stw-banner', '■ STOP-THE-WORLD · все горутины заморожены')
    this.banner.style.display = 'none'
    stage.append(this.caption, this.banner)

    this.anchors = this.computeAnchors()
  }

  attachScene(scene: Scene): void {
    this.scene = scene
    this.layout()
  }

  setProcs(n: number): void {
    this.numProcs = n
    this.anchors = this.computeAnchors()
    this.layout()
  }

  setEvents(events: TimelineEvent[]): void {
    this.events = events
  }

  // layout re-anchors the zone pills to their iso clusters in stage px; called on
  // canvas resize (scene.onLayout) and when the station count changes.
  layout(): void {
    const scene = this.scene
    if (!scene) return
    for (const key of Object.keys(this.pills) as ZoneKey[]) {
      const p = scene.worldToScreen(this.anchors[key])
      const e = this.pills[key]
      e.style.left = `${p.x}px`
      e.style.top = `${p.y}px`
    }
  }

  // update reflects the world state into the chrome each tick (memoized writes).
  update(world: WorldState): void {
    const gc = gcPhase(world)
    if (gc.label !== this.last.gc) {
      this.last.gc = gc.label
      this.gcLabel.textContent = gc.label
      this.gcDot.style.background = gc.color
      this.gcDot.style.boxShadow = `0 0 6px ${gc.color}`
      this.heapFill.style.background = gc.color
    }

    const hp = heapPct(world)
    const pct = hp === null ? -1 : Math.round(hp * 100)
    if (pct !== this.last.heap) {
      this.last.heap = pct
      this.heapFill.style.width = hp === null ? '0%' : `${pct}%`
      this.heapPctEl.textContent = hp === null ? '—' : `${pct}%`
    }

    const wait = waitingBreakdown(world)
      .map((g) => `${g.category} ${g.count}`)
      .join(' · ')
    if (wait !== this.last.wait) {
      this.last.wait = wait
      this.waitSub.textContent = wait
      this.waitSub.style.display = wait ? 'block' : 'none'
    }

    const cap = narrate(this.events, world.t)
    if (cap !== this.last.cap) {
      this.last.cap = cap
      this.caption.textContent = cap
      this.caption.style.display = cap ? 'block' : 'none'
    }

    const stw = gc.kind === 'stw'
    if (stw !== this.last.stw) {
      this.last.stw = stw
      this.banner.style.display = stw ? 'block' : 'none'
    }

    // "+N" badges: goroutines in a zone beyond its render cap (local summed over Ps).
    const tot = zoneTotals(world, this.numProcs)
    const localOver = tot.local.reduce((s, n) => s + Math.max(0, n - CAPS.local), 0)
    const globalOver = Math.max(0, tot.global - CAPS.global)
    const waitOver = Math.max(0, tot.waiting - CAPS.waiting)
    const sysOver = Math.max(0, tot.syscall - CAPS.syscall)
    const overKey = `${localOver}|${globalOver}|${waitOver}|${sysOver}`
    if (overKey !== this.last.over) {
      this.last.over = overKey
      const set = (k: ZoneKey, n: number): void => {
        this.over[k].textContent = n > 0 ? `+${n}` : ''
      }
      set('local', localOver)
      set('global', globalOver)
      set('waiting', waitOver)
      set('syscall', sysOver)
    }
  }

  // computeAnchors places each zone label in base-world coords derived from the
  // same geometry placeIso uses, so a pill floats above its cluster of gophers.
  private computeAnchors(): Record<ZoneKey, Pt> {
    const st = stationPositions(this.numProcs)
    const cx = st.reduce((s, p) => s + p.x, 0) / st.length
    const topY = Math.min(...st.map((p) => p.y))
    return {
      pstation: { x: cx, y: topY - 48 },
      // local-queue label sits in the local-lane band centered under the platform
      // row: clear of the global pile (far left) and the waiting zone (below).
      local: { x: cx, y: topY + 44 },
      global: { x: GLOBAL.x, y: GLOBAL.y - 12 },
      waiting: { x: WAITING.x + WAITING.w / 2, y: WAITING.y - 16 },
      syscall: { x: SYSCALL.x + SYSCALL.w / 2, y: SYSCALL.y - 16 },
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
