import type { ScenarioInfo } from './model/timeline'
import type { RunParams } from './api'
import type { Player } from './player/player'
import { t, scenarioTitle } from './i18n'

const SPEEDS = [0.25, 0.5, 1, 2, 4]

// Controls builds the DOM control bar (play/pause/step, scrub, speed, and the
// run config: scenario + GOMAXPROCS + goroutines) and drives the current Player.
// It owns no timeline state; re-running is delegated to onRun.
export class Controls {
  private player: Player | null = null
  private currentSpeed = 1

  private readonly playBtn: HTMLButtonElement
  private readonly scrub: HTMLInputElement
  private readonly time: HTMLSpanElement
  private readonly speedBtns: HTMLButtonElement[] = []
  private readonly scenarioSel: HTMLSelectElement
  private readonly scenarioChips: HTMLButtonElement[] = []
  private readonly procsInput: HTMLInputElement
  private readonly procsVal: HTMLSpanElement
  private readonly goroutinesInput: HTMLInputElement
  private readonly runBtn: HTMLButtonElement

  constructor(
    container: HTMLElement,
    private readonly scenarios: ScenarioInfo[],
    private readonly onRun: (p: RunParams) => void,
    private readonly onToggleIds?: () => boolean,
    private readonly onToggleThreads?: () => boolean,
    private readonly onToggleLog?: () => boolean,
    private readonly onScenarioChange?: (info: ScenarioInfo) => void,
  ) {
    const S = t()
    const bar = document.createElement('div')
    bar.className = 'controls'
    bar.setAttribute('role', 'group')
    bar.setAttribute('aria-label', S.controls.ariaBar)

    // toggle then sync the label, because pausing stops the tick loop that would
    // otherwise refresh it (the button would stay reading "Пауза" after a pause).
    this.playBtn = button(S.controls.play, () => {
      this.player?.toggle()
      this.syncPlayBtn()
    })
    const stepBtn = button(S.controls.step, () => this.player?.step())

    const idBtn = button('id', () => {
      const on = this.onToggleIds?.() ?? false
      idBtn.classList.toggle('active', on)
      idBtn.setAttribute('aria-pressed', String(on))
    })
    idBtn.title = S.controls.idTip
    // ids are shown by default in the scene, so the toggle starts active.
    idBtn.classList.add('active')
    idBtn.setAttribute('aria-pressed', 'true')

    const mBtn = button('M', () => {
      const on = this.onToggleThreads?.() ?? false
      mBtn.classList.toggle('active', on)
      mBtn.setAttribute('aria-pressed', String(on))
    })
    mBtn.title = S.controls.mTip
    // M carriers are shown by default in the scene, so the toggle starts active.
    mBtn.classList.add('active')
    mBtn.setAttribute('aria-pressed', 'true')

    const logBtn = button(S.controls.logLabel, () => {
      const on = this.onToggleLog?.() ?? false
      logBtn.classList.toggle('active', on)
      logBtn.setAttribute('aria-pressed', String(on))
    })
    logBtn.title = S.controls.logTip
    // the event log is visible by default, so the toggle starts active.
    logBtn.classList.add('active')
    logBtn.setAttribute('aria-pressed', 'true')

    const speeds = document.createElement('div')
    speeds.className = 'speeds'
    for (const s of SPEEDS) {
      const b = button(`${s}×`, () => {
        this.currentSpeed = s
        this.player?.setSpeed(s)
        this.setSpeedActive(s)
      })
      this.speedBtns.push(b)
      speeds.append(b)
    }

    // The visible scrubber is now the unified timeline canvas (ui/timeline.ts); the
    // native range stays in the DOM, visually hidden, as the keyboard seek control
    // (and the seek path the control-verify harness drives).
    this.scrub = document.createElement('input')
    this.scrub.type = 'range'
    this.scrub.className = 'sr-only'
    this.scrub.min = '0'
    this.scrub.max = '1000'
    this.scrub.value = '0'
    this.scrub.setAttribute('aria-label', S.controls.ariaScrub)
    this.scrub.addEventListener('input', () => {
      if (!this.player) return
      this.player.pause()
      this.player.seek((this.player.duration * Number(this.scrub.value)) / 1000)
      this.syncPlayBtn()
    })

    this.time = document.createElement('span')
    this.time.className = 'time'
    this.time.textContent = `0.00 / 0.00 ${S.controls.ms}`

    // The native <select> stays in the DOM (keyboard-operable, and the control
    // harness drives it programmatically) but is visually hidden; the scenario
    // CHIPS below are the visible affordance and drive it.
    this.scenarioSel = document.createElement('select')
    this.scenarioSel.className = 'sr-only'
    this.scenarioSel.setAttribute('aria-label', S.controls.scenario)
    for (const sc of this.scenarios) {
      const opt = document.createElement('option')
      opt.value = sc.id
      opt.textContent = scenarioTitle(sc)
      this.scenarioSel.append(opt)
    }
    this.scenarioSel.addEventListener('change', () => {
      this.applyScenarioParams()
      this.syncScenarioChips()
      const info = this.scenarios.find((s) => s.id === this.scenarioSel.value)
      if (info) this.onScenarioChange?.(info)
      // Picking a scenario runs it immediately: otherwise the world keeps playing
      // the OLD scenario while the header already names the new one — misleading.
      // "Запустить" stays for re-runs and for applying the numeric params.
      this.triggerRun()
    })

    // Scenario chips: one click, all scenarios visible. A chip sets the hidden
    // <select> + dispatches change, so the single auto-run path above stays the
    // source of truth.
    const scenChips = document.createElement('div')
    scenChips.className = 'scenario-chips'
    scenChips.setAttribute('role', 'group')
    scenChips.setAttribute('aria-label', S.controls.scenario)
    const scenCap = document.createElement('span')
    scenCap.className = 'chips-cap'
    scenCap.textContent = S.controls.scenarioCap
    scenChips.append(scenCap)
    for (const sc of this.scenarios) {
      const chip = button(scenarioTitle(sc), () => {
        this.scenarioSel.value = sc.id
        this.scenarioSel.dispatchEvent(new Event('change'))
      })
      chip.className = 'chip'
      chip.dataset.id = sc.id
      this.scenarioChips.push(chip)
      scenChips.append(chip)
    }

    // GOMAXPROCS: a ± stepper over a visually-hidden native number input (kept as
    // the FIRST .controls input[type=number] the harness reads).
    this.procsInput = numberInput(1, 8, 4)
    this.procsInput.className = 'sr-only'
    this.procsInput.setAttribute('aria-label', 'GOMAXPROCS')
    this.procsInput.title = S.controls.procsTip
    this.goroutinesInput = numberInput(1, 200, 50)
    this.goroutinesInput.title = S.controls.gorTip
    this.procsInput.addEventListener('input', () => {
      this.syncProcsVal()
      this.markDirty()
    })
    this.goroutinesInput.addEventListener('input', () => this.markDirty())

    this.procsVal = document.createElement('span')
    this.procsVal.className = 'step-val'
    this.procsVal.textContent = this.procsInput.value
    const procsCap = document.createElement('span')
    procsCap.className = 'step-cap'
    procsCap.textContent = 'GOMAXPROCS'
    const procsDec = button('−', () => this.stepProcs(-1))
    procsDec.className = 'step-btn'
    procsDec.setAttribute('aria-label', 'GOMAXPROCS −')
    const procsInc = button('+', () => this.stepProcs(1))
    procsInc.className = 'step-btn'
    procsInc.setAttribute('aria-label', 'GOMAXPROCS +')
    const stepper = document.createElement('div')
    stepper.className = 'stepper'
    stepper.append(procsCap, procsDec, this.procsVal, procsInc)

    this.runBtn = button(S.controls.run, () => this.triggerRun())
    this.runBtn.className = 'run'
    this.runBtn.setAttribute('aria-label', S.controls.ariaRun)

    bar.append(
      this.playBtn,
      stepBtn,
      speeds,
      this.scrub,
      this.time,
      idBtn,
      mBtn,
      logBtn,
      sep(),
      scenChips,
      this.scenarioSel,
      stepper,
      this.procsInput,
      labeled(S.controls.goroutines, this.goroutinesInput),
      this.runBtn,
    )
    container.append(bar)
    this.syncScenarioChips()
    this.applyScenarioParams()
  }

  // setParams preselects the scenario and inputs (e.g. from a shared URL) so
  // the next run — or the boot-time first run — uses them. Values are clamped
  // by the same rules as a manual run.
  setParams(p: Partial<RunParams>): void {
    if (p.scenario && this.scenarios.some((s) => s.id === p.scenario)) {
      this.scenarioSel.value = p.scenario
      this.applyScenarioParams()
      this.syncScenarioChips()
      const info = this.scenarios.find((s) => s.id === p.scenario)
      if (info) this.onScenarioChange?.(info)
    }
    if (p.gomaxprocs !== undefined) {
      this.procsInput.value = String(p.gomaxprocs)
      this.syncProcsVal()
    }
    if (p.goroutines !== undefined) this.goroutinesInput.value = String(p.goroutines)
  }

  // params returns what "Запустить" would run right now (same clamping).
  params(): RunParams {
    const gLo = Number(this.goroutinesInput.min) || 1
    const gHi = Number(this.goroutinesInput.max) || 200
    return {
      scenario: this.scenarioSel.value,
      gomaxprocs: clampNum(this.procsInput, 1, 8),
      goroutines: clampNum(this.goroutinesInput, gLo, gHi),
    }
  }

  bindPlayer(player: Player): void {
    this.player = player
    player.setSpeed(this.currentSpeed) // keep the chosen speed across re-runs
    this.setSpeedActive(this.currentSpeed)
    this.sync()
  }

  // sync reflects the current player state into the scrub, time readout, button.
  sync(): void {
    const p = this.player
    if (!p) return
    const frac = p.duration > 0 ? p.t / p.duration : 0
    this.scrub.value = String(Math.round(frac * 1000))
    this.time.textContent = `${(p.t / 1e6).toFixed(2)} / ${(p.duration / 1e6).toFixed(2)} ${t().controls.ms}`
    this.syncPlayBtn()
  }

  setLoading(loading: boolean): void {
    this.runBtn.disabled = loading
    this.runBtn.textContent = loading ? t().controls.running : t().controls.run
  }

  // markDirty highlights the run button when the config changed since the last run,
  // hinting that "Запустить" must be pressed to apply it.
  private markDirty(): void {
    this.runBtn.classList.add('dirty')
  }

  private markClean(): void {
    this.runBtn.classList.remove('dirty')
  }

  private syncPlayBtn(): void {
    this.playBtn.textContent = this.player?.playing ? t().controls.pause : t().controls.play
  }

  private setSpeedActive(s: number): void {
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', SPEEDS[i] === s))
  }

  private syncScenarioChips(): void {
    for (const c of this.scenarioChips) c.classList.toggle('active', c.dataset.id === this.scenarioSel.value)
  }

  private syncProcsVal(): void {
    this.procsVal.textContent = this.procsInput.value
  }

  // stepProcs nudges GOMAXPROCS through the hidden native input, dispatching input
  // so the value display + dirty state update via the same path the harness uses.
  private stepProcs(delta: number): void {
    const next = Math.min(8, Math.max(1, clampNum(this.procsInput, 1, 8) + delta))
    this.procsInput.value = String(next)
    this.procsInput.dispatchEvent(new Event('input', { bubbles: true }))
  }

  private applyScenarioParams(): void {
    const sc = this.scenarios.find((s) => s.id === this.scenarioSel.value)
    const g = sc?.params.find((p) => p.name === 'goroutines')
    if (!g) return
    this.goroutinesInput.min = String(g.min)
    this.goroutinesInput.max = String(g.max)
    this.goroutinesInput.value = String(g.default)
  }

  private triggerRun(): void {
    this.markClean()
    // params() clamps goroutines to the active scenario's own range (set on the
    // input by applyScenarioParams), not a fixed [1,200], so the frontend agrees
    // with the per-scenario backend clamp; the backend re-clamps regardless.
    this.onRun(this.params())
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}

function numberInput(min: number, max: number, value: number): HTMLInputElement {
  const i = document.createElement('input')
  i.type = 'number'
  i.min = String(min)
  i.max = String(max)
  i.value = String(value)
  return i
}

function labeled(text: string, el: HTMLElement): HTMLLabelElement {
  const wrap = document.createElement('label')
  const span = document.createElement('span')
  span.textContent = text
  wrap.append(span, el)
  return wrap
}

function sep(): HTMLElement {
  const s = document.createElement('div')
  s.className = 'sep'
  return s
}

function clampNum(input: HTMLInputElement, lo: number, hi: number): number {
  const v = Number(input.value)
  if (Number.isNaN(v)) return lo
  return Math.min(hi, Math.max(lo, Math.round(v)))
}
