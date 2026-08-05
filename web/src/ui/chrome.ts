import type { WorldState } from '../player/state'
import type { ScenarioInfo, Timeline } from '../model/timeline'
import type { Scene } from '../scene/scene'
import { PAL } from '../scene/palette'
import { stationPositions, type Pt } from '../scene/iso'
import { GLOBAL, WAITING, SYSCALL, CAPS, zoneTotals, midAliases } from '../scene/layout'
import { narrate, captionWindowNs } from '../player/narrate'
import { gcSummary, stwInWindow, isPlaybackStep, STW_FLASH_MS, type GcSummary } from '../player/gc'
import { gcPhase, heapPct, waitingBreakdown } from './derive'
import { t as tr, getLang, setLang, scenarioDesc } from '../i18n'
import { isStaticDemo } from '../api'

// Chrome is the DOM layer over the pixel canvas: header (title + scenario subtitle
// + GC indicator + heap bar + GC-cycle readout), a to-scale GC strip that shows
// the real (sub-frame) stop-the-world pauses and concurrent-mark bands, floating
// zone-label pills that track the iso clusters, a legend, the "what's happening"
// caption (narrate), the waiting-reasons breakdown, and a brief stop-the-world
// banner that reports the real pause duration. Pure derivations live in ./derive.

type ZoneKey = 'pstation' | 'local' | 'global' | 'waiting' | 'syscall'

// Legend colors, zipped with the localized [name, tip] pairs from the i18n dict
// (same order); each entry carries a hover tip so the jargon is teachable in place.
const LEGEND_COLORS: readonly string[] = [
  PAL.running,
  PAL.runnable,
  PAL.waiting,
  PAL.syscall,
  PAL.thread,
  PAL.teal,
  PAL.gcStw,
  PAL.dead,
]

// fmtNs renders a real nanosecond duration in the most legible unit.
function fmtNs(ns: number): string {
  const u = tr().units
  if (ns <= 0) return '0'
  if (ns < 1_000) return `${Math.round(ns)} ${u.ns}`
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(ns < 10_000 ? 1 : 0)} ${u.us}`
  return `${(ns / 1_000_000).toFixed(2)} ${u.ms}`
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
  private readonly caption: HTMLDivElement
  private readonly banner: HTMLDivElement
  private readonly waitSub: HTMLSpanElement
  private readonly pills: Record<ZoneKey, HTMLDivElement>
  private readonly over: Record<ZoneKey, HTMLSpanElement>
  private anchors: Record<ZoneKey, Pt>
  private readonly assumeBody: HTMLDivElement
  private customGroupAdded = false

  private last = { gc: '', heap: -1, wait: '', cap: '', readout: '', over: '' }

  constructor(stage: HTMLElement) {
    // --- header top row: title + scenario subtitle + GC indicator + heap bar ---
    const S = tr()
    const title = el('div', 'title')
    title.append(S.chrome.titleMain, el('span', 'accent', S.chrome.titleAccent))
    this.subtitle = el('span', 'subtitle', S.chrome.subtitleDefault)
    const titleWrap = el('div', 'title-wrap')
    titleWrap.append(title, this.subtitle)

    // language switcher: strings are baked at construction time all over the
    // chrome/controls, so switching simply persists the choice and reloads.
    const langBtn = el('button', 'lang-btn', S.chrome.langBtn)
    langBtn.title = S.chrome.langTip
    langBtn.addEventListener('click', () => {
      setLang(getLang() === 'ru' ? 'en' : 'ru')
      location.reload()
    })

    this.gcDot = el('span', 'gc-dot')
    this.gcLabel = el('span', 'gc-label', S.gcPhase.idle)
    this.gcReadout = el('span', 'gc-readout', '')
    const gc = el('div', 'gc')
    gc.title = S.chrome.gcTip
    gc.append(this.gcDot, this.gcLabel, this.gcReadout)

    this.heapFill = el('div', 'heap-fill')
    const heapBar = el('div', 'heap-bar')
    heapBar.append(this.heapFill, el('div', 'heap-goal'))
    this.heapPctEl = el('span', 'heap-pct', '—')
    const heap = el('div', 'heap')
    heap.title = S.chrome.heapTip
    heap.append(el('span', 'heap-cap', S.chrome.heapCap), heapBar, this.heapPctEl)

    const topRow = el('div', 'chrome-head')
    topRow.append(titleWrap, el('div', 'spacer'), gc, heap, langBtn)

    // The to-scale GC channel (mark bands + STW ticks + playhead) now lives in the
    // unified control-panel timeline (ui/timeline.ts); the header keeps only the GC
    // phase indicator + heap bar + cycle readout.
    this.header = el('header', 'chrome-header')
    this.header.append(topRow)

    // --- legend ---
    this.legend = el('div', 'chrome-legend')
    for (const [i, [name, tip]] of S.legend.entries()) {
      const color = LEGEND_COLORS[i]
      const dot = el('span', 'dot')
      dot.style.background = color
      dot.style.boxShadow = `0 0 5px ${color}88`
      const item = el('span', 'leg-item')
      item.title = tip
      item.append(dot, document.createTextNode(name))
      this.legend.append(item)
    }
    this.legend.append(el('span', 'leg-hint', S.legendHint))
    const { details: assumptionsBox, body: assumeBody } = buildAssumptions()
    this.assumeBody = assumeBody
    this.legend.append(assumptionsBox)

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
    const waiting = pill('waiting', S.pills.waiting[0], PAL.waiting, true, S.pills.waiting[1])
    this.waitSub = el('span', 'zone-sub')
    waiting.append(this.waitSub)
    this.pills = {
      pstation: pill('pstation', S.pills.pstation[0], PAL.running, true, S.pills.pstation[1]),
      local: pill('local', S.pills.local[0], PAL.runnable, true, S.pills.local[1]),
      global: pill('global', S.pills.global[0], PAL.runnable, true, S.pills.global[1]),
      waiting,
      syscall: pill('syscall', S.pills.syscall[0], PAL.syscall, true, S.pills.syscall[1]),
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
  // Pass undefined for an uploaded trace (see setCustomTitle below).
  setScenario(info: ScenarioInfo | undefined): void {
    this.subtitle.textContent = info ? scenarioDesc(info) : ''
  }

  // setCustomTitle replaces the subtitle with the uploaded file's name plus the
  // handful of real facts about it (duration/events/P/G counts) instead of a
  // scenario's "what this teaches" blurb.
  setCustomTitle(fileName: string, facts: { durationNs: number; events: number; numProcs: number; numGoroutines: number }): void {
    const u = tr().chrome
    this.subtitle.textContent = `${fileName} — ${fmtNs(facts.durationNs)}, ${u.customFacts(facts.events, facts.numProcs, facts.numGoroutines)}`
  }

  // addCustomAssumptionGroup adds the "your trace" disclosure group to the
  // assumptions panel the first time a custom trace is loaded (idempotent —
  // uploading a second file doesn't duplicate it).
  addCustomAssumptionGroup(): void {
    if (this.customGroupAdded) return
    this.customGroupAdded = true
    const S = tr().custom
    const g = el('div', 'assume-group')
    g.append(el('b', undefined, S.assumeTitle))
    const ul = document.createElement('ul')
    for (const item of S.assumeItems) ul.append(el('li', undefined, item))
    g.append(ul)
    this.assumeBody.append(g)
  }

  // setMode hides the legend items + hint in Learn mode (the assumptions
  // <details> below them stays visible either way — CSS in index.html scopes
  // the hiding to .leg-item/.leg-hint under .chrome-legend.mode-learn).
  setMode(mode: 'learn' | 'full'): void {
    this.legend.classList.toggle('mode-learn', mode === 'learn')
  }

  // setTimeline wires the per-run trace: builds the GC summary (for the cycle
  // readout + STW banner detection) and resets step tracking. The to-scale GC
  // bands themselves are drawn by the timeline canvas.
  setTimeline(tl: Timeline): void {
    this.timeline = tl
    this.midAlias = midAliases(tl.events) // caption M names match the carrier tags
    this.gc = gcSummary(tl)
    this.lastT = -1
    this.stwBannerMs = 0
    this.lastNowMs = 0
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
      this.gc.cycles > 0 ? tr().chrome.readout(this.gc.cycles, fmtNs(this.gc.maxStwNs)) : tr().chrome.readoutNone
    if (readout !== this.last.readout) {
      this.last.readout = readout
      this.gcReadout.textContent = readout
    }

    const dur = this.timeline?.meta.durationNs ?? 0

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
        ? tr().chrome.banner(fmtNs(stwNs))
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
      .map((g) => `${tr().reasonCat[g.category]} ${g.count}`)
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

// buildAssumptions renders the honesty disclosure under the legend: an
// always-visible summary line that expands into the full list of what this world
// reconstructs, compresses or omits versus the real runtime — and what is a hard
// trace fact. The trace records only goroutine state transitions, so queue
// membership, steals and M lifecycle are simply not in the data; this panel is
// where the site says so out loud instead of hiding it in tooltips.
function buildAssumptions(): { details: HTMLDetailsElement; body: HTMLDivElement } {
  const A = tr().assumptions
  const box = document.createElement('details')
  box.className = 'assumptions'
  const sum = document.createElement('summary')
  sum.textContent = A.summary
  box.append(sum)
  const body = el('div', 'assume-body')
  const groups = [...A.groups]
  // The static build has no backend, which changes what the controls can mean.
  // That belongs in the honesty panel rather than only in a tooltip.
  if (isStaticDemo()) groups.unshift([tr().demo.group, tr().demo.items])
  for (const [gtitle, items] of groups) {
    const g = el('div', 'assume-group')
    g.append(el('b', undefined, gtitle))
    const ul = document.createElement('ul')
    for (const it of items) ul.append(el('li', undefined, it))
    g.append(ul)
    body.append(g)
  }
  body.append(el('div', 'assume-real', A.real))
  box.append(body)
  return { details: box, body }
}
