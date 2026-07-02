import type { WorldState } from '../player/state'
import type { ScenarioInfo, Timeline } from '../model/timeline'
import type { Scene } from '../scene/scene'
import { PAL } from '../scene/palette'
import { stationPositions, type Pt } from '../scene/iso'
import { GLOBAL, WAITING, SYSCALL, CAPS, zoneTotals, midAliases } from '../scene/layout'
import { narrate, captionWindowNs } from '../player/narrate'
import { gcSummary, stwInWindow, isPlaybackStep, STW_FLASH_MS, type GcSummary } from '../player/gc'
import { gcPhase, heapPct, waitingBreakdown } from './derive'

// Chrome is the DOM layer over the pixel canvas: header (title + scenario subtitle
// + GC indicator + heap bar + GC-cycle readout), a to-scale GC strip that shows
// the real (sub-frame) stop-the-world pauses and concurrent-mark bands, floating
// zone-label pills that track the iso clusters, a legend, the "what's happening"
// caption (narrate), the waiting-reasons breakdown, and a brief stop-the-world
// banner that reports the real pause duration. Pure derivations live in ./derive.

type ZoneKey = 'pstation' | 'local' | 'global' | 'waiting' | 'syscall'

// Each legend entry carries a hover tip so the jargon (runnable/syscall/mark/STW)
// is teachable in place, for a viewer who has never seen the scheduler.
const LEGEND: ReadonlyArray<readonly [string, string, string]> = [
  ['Выполняется', PAL.running, 'Горутина бежит на P — прямо сейчас занимает слот выполнения'],
  ['В очереди', PAL.runnable, 'Готова бежать, ждёт свободный P (runnable)'],
  ['Ожидание', PAL.waiting, 'Заблокирована: канал, sync, сон, GC-ассист — P не занимает'],
  ['Syscall', PAL.syscall, 'Вызов ОС; на время syscall P отвязывается и может уйти другому потоку (M)'],
  ['M — OS-поток', PAL.thread, 'OS-поток: тележка с номером у P-станции и под горутиной в syscall. Id настоящие, из трейса; блокирующий syscall уводит M вместе с горутиной, P достаётся другому M'],
  ['GC mark', PAL.teal, 'Конкурентная разметка: GC работает ОДНОВРЕМЕННО с горутинами (это не пауза)'],
  ['STW', PAL.gcStw, 'Stop-the-world: рантайм замирает на десятки мкс, чтобы завершить фазу GC'],
  ['Завершён', PAL.dead, 'Горутина отработала и исчезает'],
]

// fmtNs renders a real nanosecond duration in the most legible unit.
function fmtNs(ns: number): string {
  if (ns <= 0) return '0'
  if (ns < 1_000) return `${Math.round(ns)} нс`
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(ns < 10_000 ? 1 : 0)} мкс`
  return `${(ns / 1_000_000).toFixed(2)} мс`
}

export class Chrome {
  readonly header: HTMLElement
  readonly legend: HTMLElement

  private scene: Scene | null = null
  private numProcs = 4
  private timeline: Timeline | null = null
  private midAlias = new Map<number, number>()
  private gc: GcSummary = { cycles: 0, stw: [], mark: [], maxStwNs: 0 }
  private lastT = -1
  private stwBannerMs = 0 // wall-clock ms remaining to hold the STW banner after a sub-frame pause
  private lastNowMs = 0 // performance.now() at the previous update, for framerate-independent decay

  private readonly subtitle: HTMLSpanElement
  private readonly gcDot: HTMLSpanElement
  private readonly gcLabel: HTMLSpanElement
  private readonly gcReadout: HTMLSpanElement
  private readonly heapFill: HTMLDivElement
  private readonly heapPctEl: HTMLSpanElement
  private readonly stripTrack: HTMLDivElement
  private readonly stripHead: HTMLDivElement
  private readonly caption: HTMLDivElement
  private readonly banner: HTMLDivElement
  private readonly waitSub: HTMLSpanElement
  private readonly pills: Record<ZoneKey, HTMLDivElement>
  private readonly over: Record<ZoneKey, HTMLSpanElement>
  private anchors: Record<ZoneKey, Pt>

  private last = { gc: '', heap: -1, wait: '', cap: '', readout: '', over: '' }

  constructor(stage: HTMLElement) {
    // --- header top row: title + scenario subtitle + GC indicator + heap bar ---
    const title = el('div', 'title')
    title.append('Планировщик Go ', el('span', 'accent', '· G·M·P'))
    this.subtitle = el('span', 'subtitle', 'выберите сценарий ниже')
    const titleWrap = el('div', 'title-wrap')
    titleWrap.append(title, this.subtitle)

    this.gcDot = el('span', 'gc-dot')
    this.gcLabel = el('span', 'gc-label', 'GC: простой')
    this.gcReadout = el('span', 'gc-readout', '')
    const gc = el('div', 'gc')
    gc.title = 'Фаза сборщика мусора: простой · конкурентная разметка (идёт вместе с горутинами) · stop-the-world (короткая пауза всего рантайма)'
    gc.append(this.gcDot, this.gcLabel, this.gcReadout)

    this.heapFill = el('div', 'heap-fill')
    const heapBar = el('div', 'heap-bar')
    heapBar.append(this.heapFill, el('div', 'heap-goal'))
    this.heapPctEl = el('span', 'heap-pct', '—')
    const heap = el('div', 'heap')
    heap.title = 'Куча: живой размер как доля от цели GC (100% = цель). Цвет = фаза GC: серый — простой, бирюза — разметка, красный — STW'
    heap.append(el('span', 'heap-cap', 'куча'), heapBar, this.heapPctEl)

    const topRow = el('div', 'chrome-head')
    topRow.append(titleWrap, el('div', 'spacer'), gc, heap)

    // --- GC strip: a to-scale lane of the real GC ranges (mark bands + STW ticks)
    // with a playhead. This is the honest channel: STW reads as the sliver it is. ---
    this.stripTrack = el('div', 'gc-strip-track')
    this.stripHead = el('div', 'gc-strip-head')
    this.stripTrack.append(this.stripHead)
    const strip = el('div', 'gc-strip')
    strip.title = 'Хронология всего прогона: бирюзовые полосы — конкурентная разметка, красные тики — STW-паузы, белая линия — текущая позиция'
    strip.append(el('span', 'gc-strip-cap', 'GC'), this.stripTrack)

    this.header = el('header', 'chrome-header')
    this.header.append(topRow, strip)

    // --- legend ---
    this.legend = el('div', 'chrome-legend')
    for (const [name, color, tip] of LEGEND) {
      const dot = el('span', 'dot')
      dot.style.background = color
      dot.style.boxShadow = `0 0 5px ${color}88`
      const item = el('span', 'leg-item')
      item.title = tip
      item.append(dot, document.createTextNode(name))
      this.legend.append(item)
    }
    this.legend.append(
      el(
        'div',
        'legend-note',
        'Локальные очереди и кража работы — реконструкция из трейса (рантайм их не пишет): горутины раскладываем ' +
          'по P (в лейне видны первые 6 — у реального P ёмкость 256, остальные уходят в глобальную очередь), ' +
          'простаивающий P подсвечивается при краже. GC-фазы, STW и куча — настоящие данные трейса: куча ' +
          'даунсэмплится (≥2 мс) и показана как доля от цели (цель мягкая — куча может её слегка превышать); ' +
          'фазы sweep и mark-assist опущены, а конкурентная разметка ещё забирает ~25% CPU у фоновых GC-воркеров. ' +
          'M (OS-потоки) — настоящие потоки из событий трейса (на бирке — порядковый номер, реальный id в тултипе); ' +
          'спящие (запаркованные) M трейс не показывает — тележка исчезает и появляется снова.',
      ),
    )

    // --- zone pills ---
    const over: Partial<Record<ZoneKey, HTMLSpanElement>> = {}
    const pill = (key: ZoneKey, text: string, color: string, center: boolean, tip: string): HTMLDivElement => {
      const e = el('div', center ? 'zone-pill center' : 'zone-pill')
      e.style.color = color
      e.title = tip
      e.append(document.createTextNode(text))
      const ov = el('span', 'zone-over')
      e.append(ov)
      over[key] = ov
      stage.append(e)
      return e
    }
    const waiting = pill('waiting', 'Ожидание', PAL.waiting, true, 'Заблокированные горутины: канал, sync, сон, GC-ассист — P не занимают')
    this.waitSub = el('span', 'zone-sub')
    waiting.append(this.waitSub)
    this.pills = {
      pstation: pill('pstation', 'P-станции · выполнение', PAL.running, true, 'Слоты выполнения (=GOMAXPROCS); на каждом не больше одной бегущей горутины'),
      local: pill('local', 'локальные очереди', PAL.runnable, true, 'Горутины, приписанные к своему P — реконструкция (рантайм очереди не пишет)'),
      global: pill('global', 'Глобальная очередь', PAL.runnable, true, 'Горутины без своего P или перелившиеся из полной локальной очереди'),
      waiting,
      syscall: pill('syscall', 'Syscall', PAL.syscall, true, 'Горутины в системном вызове ОС; M уходит вместе с горутиной, а P достаётся другому M'),
    }
    this.over = over as Record<ZoneKey, HTMLSpanElement>

    // --- caption + STW banner ---
    this.caption = el('div', 'caption')
    this.caption.style.display = 'none'
    this.banner = el('div', 'stw-banner', '■ STOP-THE-WORLD')
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

  // setScenario shows the "what this teaches" subtitle for the active scenario.
  setScenario(info: ScenarioInfo | undefined): void {
    this.subtitle.textContent = info?.description ?? ''
  }

  // setTimeline wires the per-run trace: builds the GC summary, renders the static
  // GC-strip bands, and resets step tracking.
  setTimeline(tl: Timeline): void {
    this.timeline = tl
    this.midAlias = midAliases(tl.events) // caption M names match the carrier tags
    this.gc = gcSummary(tl)
    this.lastT = -1
    this.stwBannerMs = 0
    this.lastNowMs = 0
    this.renderStrip()
  }

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

  // renderStrip draws the to-scale GC bands once per run: a teal band per
  // concurrent-mark phase and a red tick per real stop-the-world pause.
  private renderStrip(): void {
    const dur = this.timeline?.meta.durationNs ?? 0
    // clear previous bands (keep the playhead child)
    for (const c of [...this.stripTrack.children]) if (c !== this.stripHead) c.remove()
    if (dur <= 0) return
    const pctOf = (ns: number): number => Math.max(0, Math.min(100, (ns / dur) * 100))
    for (const m of this.gc.mark) {
      const band = el('div', 'gc-band mark')
      band.style.left = `${pctOf(m.startNs)}%`
      band.style.width = `${Math.max(0.4, pctOf(m.endNs) - pctOf(m.startNs))}%`
      this.stripTrack.append(band)
    }
    for (const s of this.gc.stw) {
      const tick = el('div', 'gc-band stw')
      tick.style.left = `${pctOf(s.startNs)}%`
      this.stripTrack.append(tick)
    }
  }

  update(world: WorldState): void {
    const gc = gcPhase(world)
    const hp = heapPct(world)

    // heap fill: width + colour every frame, so the bar reads its GC phase as it
    // grows toward the goal (idle grey / mark teal / STW red).
    const pct = hp === null ? -1 : Math.round(hp * 100)
    if (pct !== this.last.heap || gc.label !== this.last.gc) {
      this.last.heap = pct
      this.heapFill.style.width = hp === null ? '0%' : `${pct}%`
      this.heapFill.style.background = hp === null ? PAL.txDim : gc.color
      this.heapPctEl.textContent = hp === null ? '—' : `${pct}%`
    }
    if (gc.label !== this.last.gc) {
      this.last.gc = gc.label
      this.gcLabel.textContent = gc.label
      this.gcDot.style.background = gc.color
      this.gcDot.style.boxShadow = `0 0 6px ${gc.color}`
    }

    // GC-cycle readout from the real ranges (honest even when the scene shows idle).
    const readout =
      this.gc.cycles > 0 ? `${this.gc.cycles} цикл. · STW до ${fmtNs(this.gc.maxStwNs)}` : 'циклов нет'
    if (readout !== this.last.readout) {
      this.last.readout = readout
      this.gcReadout.textContent = readout
    }

    // GC-strip playhead.
    const dur = this.timeline?.meta.durationNs ?? 0
    if (dur > 0) this.stripHead.style.left = `${Math.max(0, Math.min(100, (world.t / dur) * 100))}%`

    // detect a stop-the-world crossed in this playback step → flash the banner with
    // its REAL duration (the scene flashes the vignette from the same data). The
    // hold decays on wall-clock ms (not per-frame), so its duration is the same on
    // 60Hz and 120Hz displays and stays in step with the scene's vignette.
    const t = world.t
    const nowMs = performance.now()
    const deltaMs = this.lastNowMs ? nowMs - this.lastNowMs : 0
    this.lastNowMs = nowMs
    let stwNs = 0
    if (isPlaybackStep(this.lastT, t, dur)) {
      const stw = stwInWindow(this.gc, this.lastT, t)
      if (stw) {
        stwNs = stw.ns
        this.stwBannerMs = STW_FLASH_MS
      }
    }
    this.lastT = t
    if (this.stwBannerMs > 0) this.stwBannerMs = Math.max(0, this.stwBannerMs - deltaMs)

    // caption: a fresh STW gets the spotlight with its real µs; otherwise narrate,
    // with a look-back window scaled to this run's length (short traces would
    // otherwise leave the caption stale for seconds of wall time).
    const cap =
      stwNs > 0
        ? `Stop-the-world: мир замер на ${fmtNs(stwNs)}`
        : narrate(this.timeline?.events ?? [], t, world.gcActive, captionWindowNs(dur), this.midAlias)
    if (cap !== this.last.cap) {
      this.last.cap = cap
      this.caption.textContent = cap
      this.caption.style.display = cap ? 'block' : 'none'
    }
    const showBanner = this.stwBannerMs > 0
    if (showBanner !== (this.banner.style.display === 'block')) {
      this.banner.style.display = showBanner ? 'block' : 'none'
    }

    // waiting-reasons breakdown.
    const wait = waitingBreakdown(world)
      .map((g) => `${g.category} ${g.count}`)
      .join(' · ')
    if (wait !== this.last.wait) {
      this.last.wait = wait
      this.waitSub.textContent = wait
      this.waitSub.style.display = wait ? 'block' : 'none'
    }

    // "+N" badges beyond the render caps. Local queues never carry a "+N": once a
    // P's lane is full the surplus spills into the global queue (zoneTotals.global),
    // which mirrors the real runtime overflowing a full local runq.
    const tot = zoneTotals(world, this.numProcs)
    const globalOver = Math.max(0, tot.global - CAPS.global)
    const waitOver = Math.max(0, tot.waiting - CAPS.waiting)
    const sysOver = Math.max(0, tot.syscall - CAPS.syscall)
    const overKey = `${globalOver}|${waitOver}|${sysOver}`
    if (overKey !== this.last.over) {
      this.last.over = overKey
      const set = (k: ZoneKey, n: number): void => {
        this.over[k].textContent = n > 0 ? `+${n}` : ''
      }
      set('global', globalOver)
      set('waiting', waitOver)
      set('syscall', sysOver)
    }
  }

  private computeAnchors(): Record<ZoneKey, Pt> {
    const st = stationPositions(this.numProcs)
    const cx = st.reduce((s, p) => s + p.x, 0) / st.length
    const topY = Math.min(...st.map((p) => p.y))
    return {
      pstation: { x: cx, y: topY - 46 },
      local: { x: cx, y: topY + 40 },
      global: { x: GLOBAL.x + GLOBAL.w / 2, y: GLOBAL.y - 14 },
      waiting: { x: WAITING.x + WAITING.w / 2, y: WAITING.y - 14 },
      syscall: { x: SYSCALL.x + SYSCALL.w / 2, y: SYSCALL.y - 14 },
    }
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
