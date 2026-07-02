import type { ScenarioInfo } from './model/timeline'
import type { RunParams } from './api'
import type { Player } from './player/player'

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
  private readonly procsInput: HTMLInputElement
  private readonly goroutinesInput: HTMLInputElement
  private readonly runBtn: HTMLButtonElement

  constructor(
    container: HTMLElement,
    private readonly scenarios: ScenarioInfo[],
    private readonly onRun: (p: RunParams) => void,
    private readonly onToggleIds?: () => boolean,
    private readonly onToggleThreads?: () => boolean,
    private readonly onScenarioChange?: (info: ScenarioInfo) => void,
  ) {
    const bar = document.createElement('div')
    bar.className = 'controls'
    bar.setAttribute('role', 'group')
    bar.setAttribute('aria-label', 'управление проигрыванием')

    // toggle then sync the label, because pausing stops the tick loop that would
    // otherwise refresh it (the button would stay reading "Пауза" after a pause).
    this.playBtn = button('Играть', () => {
      this.player?.toggle()
      this.syncPlayBtn()
    })
    const stepBtn = button('Шаг', () => this.player?.step())

    const idBtn = button('id', () => {
      const on = this.onToggleIds?.() ?? false
      idBtn.classList.toggle('active', on)
      idBtn.setAttribute('aria-pressed', String(on))
    })
    idBtn.title = 'показать номера горутин'
    // ids are shown by default in the scene, so the toggle starts active.
    idBtn.classList.add('active')
    idBtn.setAttribute('aria-pressed', 'true')

    const mBtn = button('M', () => {
      const on = this.onToggleThreads?.() ?? false
      mBtn.classList.toggle('active', on)
      mBtn.setAttribute('aria-pressed', String(on))
    })
    mBtn.title = 'показать OS-потоки (M)'
    // M carriers are shown by default in the scene, so the toggle starts active.
    mBtn.classList.add('active')
    mBtn.setAttribute('aria-pressed', 'true')

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

    this.scrub = document.createElement('input')
    this.scrub.type = 'range'
    this.scrub.min = '0'
    this.scrub.max = '1000'
    this.scrub.value = '0'
    this.scrub.setAttribute('aria-label', 'позиция во времени')
    this.scrub.addEventListener('input', () => {
      if (!this.player) return
      this.player.pause()
      this.player.seek((this.player.duration * Number(this.scrub.value)) / 1000)
      this.syncPlayBtn()
    })

    this.time = document.createElement('span')
    this.time.className = 'time'
    this.time.textContent = '0.00 / 0.00 мс'

    this.scenarioSel = document.createElement('select')
    for (const sc of this.scenarios) {
      const opt = document.createElement('option')
      opt.value = sc.id
      opt.textContent = sc.title
      this.scenarioSel.append(opt)
    }
    this.scenarioSel.addEventListener('change', () => {
      this.applyScenarioParams()
      this.markDirty()
      const info = this.scenarios.find((s) => s.id === this.scenarioSel.value)
      if (info) this.onScenarioChange?.(info)
    })

    this.procsInput = numberInput(1, 8, 4)
    this.procsInput.title = 'GOMAXPROCS — число P (слотов выполнения). Ограничено 1–8 под размер изо-сцены'
    this.goroutinesInput = numberInput(1, 200, 50)
    this.goroutinesInput.title = 'Сколько горутин запустить в сценарии (диапазон зависит от сценария)'
    this.procsInput.addEventListener('input', () => this.markDirty())
    this.goroutinesInput.addEventListener('input', () => this.markDirty())
    this.runBtn = button('Запустить', () => this.triggerRun())
    this.runBtn.className = 'run'
    this.runBtn.setAttribute('aria-label', 'запустить выбранный сценарий')

    bar.append(
      this.playBtn,
      stepBtn,
      speeds,
      this.scrub,
      this.time,
      idBtn,
      mBtn,
      sep(),
      labeled('сценарий', this.scenarioSel),
      labeled('GOMAXPROCS', this.procsInput),
      labeled('горутины', this.goroutinesInput),
      this.runBtn,
    )
    container.append(bar)
    this.applyScenarioParams()
  }

  // setParams preselects the scenario and inputs (e.g. from a shared URL) so
  // the next run — or the boot-time first run — uses them. Values are clamped
  // by the same rules as a manual run.
  setParams(p: Partial<RunParams>): void {
    if (p.scenario && this.scenarios.some((s) => s.id === p.scenario)) {
      this.scenarioSel.value = p.scenario
      this.applyScenarioParams()
      const info = this.scenarios.find((s) => s.id === p.scenario)
      if (info) this.onScenarioChange?.(info)
    }
    if (p.gomaxprocs !== undefined) this.procsInput.value = String(p.gomaxprocs)
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
    this.time.textContent = `${(p.t / 1e6).toFixed(2)} / ${(p.duration / 1e6).toFixed(2)} мс`
    this.syncPlayBtn()
  }

  setLoading(loading: boolean): void {
    this.runBtn.disabled = loading
    this.runBtn.textContent = loading ? 'Запуск…' : 'Запустить'
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
    this.playBtn.textContent = this.player?.playing ? 'Пауза' : 'Играть'
  }

  private setSpeedActive(s: number): void {
    this.speedBtns.forEach((b, i) => b.classList.toggle('active', SPEEDS[i] === s))
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
