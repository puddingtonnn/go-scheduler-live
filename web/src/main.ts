import { fetchScenarios, fetchRun, type RunParams } from './api'
import type { ScenarioInfo, Timeline } from './model/timeline'
import { Player } from './player/player'
import { Scene } from './scene/scene'
import { Chrome } from './ui/chrome'
import { Controls } from './controls'
import { parseShare, buildShare } from './share'
import { EventLog } from './ui/eventlog'
import { midAliases } from './scene/layout'

// Composition root: builds the DOM chrome (header + GC strip + legend) around the
// canvas stage and the control bar, then on each run fetches a Timeline,
// (re)configures the scene + chrome, and drives both from a fresh virtual-clock
// Player. The old player is paused so only one clock ticks.
async function boot(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')

  // Phase-1 pixel-art demo (static iso scene, no data): /?iso
  if (new URLSearchParams(location.search).has('iso')) {
    const { renderIsoDemo } = await import('./scene/demo')
    await renderIsoDemo(root)
    return
  }

  let scenarios: ScenarioInfo[]
  try {
    scenarios = await fetchScenarios()
    if (!scenarios.length) throw new Error('сервер не вернул ни одного сценария')
  } catch (e) {
    showFatal(root, 'Не удалось загрузить сценарии', e)
    return
  }

  const stage = document.createElement('div')
  stage.className = 'stage'
  const chrome = new Chrome(stage)
  const errorBox = document.createElement('div')
  errorBox.className = 'app-error'
  errorBox.style.display = 'none'
  stage.append(errorBox)

  let scene: Scene | null = null
  let player: Player | null = null
  let timeline: Timeline | null = null

  const eventLog = new EventLog()
  root.append(chrome.header, stage, eventLog.root, chrome.legend)
  const controls = new Controls(
    root,
    scenarios,
    (p) => void run(p),
    () => scene?.toggleIds() ?? false,
    () => scene?.toggleThreads() ?? false,
    () => eventLog.toggle(),
    (info) => chrome.setScenario(info),
  )

  const intro = makeIntro(stage)

  ;(globalThis as Record<string, unknown>).gmp = {
    get player() {
      return player
    },
    get scene() {
      return scene
    },
    get timeline() {
      return timeline
    },
  }

  function scenarioInfo(id: string): ScenarioInfo | undefined {
    return scenarios.find((s) => s.id === id)
  }

  // updateShareUrl mirrors the current run (and, when paused, the playhead)
  // into the address bar so the view is shareable. replaceState only — no
  // history spam; never called while playing (see onTick).
  let lastRun: RunParams | null = null
  let lastUrl = ''
  function updateShareUrl(t?: number): void {
    if (!lastRun) return
    const qs = buildShare({ ...lastRun, t })
    if (qs === lastUrl) return
    lastUrl = qs
    history.replaceState(null, '', `${location.pathname}?${qs}`)
  }

  // Scenario picks auto-run (see controls.ts), so runs can overlap while a fetch
  // is in flight; the generation counter lets only the latest one win.
  let runGen = 0
  async function run(params: RunParams): Promise<void> {
    const gen = ++runGen
    controls.setLoading(true)
    errorBox.style.display = 'none'
    try {
      const tl = await fetchRun(params)
      if (gen !== runGen) return // superseded by a newer run while fetching
      timeline = tl
      lastRun = params
      updateShareUrl()
      player?.pause()
      if (!scene) {
        scene = await Scene.create(stage, tl.meta.numProcs)
        scene.onLayout = () => chrome.layout()
        chrome.attachScene(scene)
      } else {
        scene.reset(tl.meta.numProcs)
      }
      scene.loadTimeline(tl)
      chrome.setProcs(tl.meta.numProcs)
      chrome.setTimeline(tl)
      eventLog.build(tl.events, midAliases(tl.events))
      chrome.setScenario(scenarioInfo(params.scenario))
      intro.show(scenarioInfo(params.scenario))

      const sc = scene
      const p = new Player(tl)
      p.onTick = (w) => {
        sc.setWorld(w)
        chrome.update(w)
        eventLog.setT(w.t)
        controls.sync()
        // Paused emits are discrete (seek/step/pause) — safe to mirror into the
        // URL; while playing the URL keeps the run params without t.
        if (!p.playing) updateShareUrl(w.t)
      }
      player = p
      controls.bindPlayer(p)
      p.emit()
      p.play()
    } catch (e) {
      if (gen !== runGen) return
      errorBox.textContent = `Ошибка запуска: ${msg(e)}. Проверьте, что бэкенд запущен.`
      errorBox.style.display = 'block'
    } finally {
      // A superseded run must not clear the loading state the newer run set.
      if (gen === runGen) controls.setLoading(false)
    }
  }

  // A shared URL preselects the run (and the paused moment); otherwise boot
  // with the first scenario's defaults.
  const share = parseShare(location.search)
  if (share.scenario && scenarioInfo(share.scenario)) {
    controls.setParams(share)
  } else {
    const first = scenarios[0]
    const firstGoroutines = first.params.find((p) => p.name === 'goroutines')?.default ?? 50
    controls.setParams({ scenario: first.id, gomaxprocs: 4, goroutines: firstGoroutines })
  }
  await run(controls.params())
  if (share.t !== undefined && player) {
    const p = player as Player
    p.pause()
    p.seek(Math.min(share.t, p.duration))
    controls.sync()
  }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault()
      player?.toggle()
      controls.sync() // keyboard toggle doesn't emit a tick when pausing — sync the label
    }
  })
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// showFatal renders a blocking error card when the app can't even start (e.g. the
// backend is down on first load) instead of leaving a blank page.
function showFatal(root: HTMLElement, title: string, e: unknown): void {
  const card = document.createElement('div')
  card.className = 'fatal'
  const h = document.createElement('div')
  h.className = 'fatal-title'
  h.textContent = title
  const p = document.createElement('div')
  p.className = 'fatal-msg'
  p.textContent = `${msg(e)} — запустите бэкенд (go run ./cmd/server -addr :8085) и обновите страницу.`
  const btn = document.createElement('button')
  btn.textContent = 'Повторить'
  btn.addEventListener('click', () => location.reload())
  card.append(h, p, btn)
  root.append(card)
}

// makeIntro builds a dismissible "what am I looking at" card. It appears on every
// scenario CHANGE (re-running the same scenario doesn't nag): the first time with
// the full G/P/M primer, afterwards as a short "what this scenario teaches" note.
function makeIntro(stage: HTMLElement): { show(info: ScenarioInfo | undefined): void } {
  const card = document.createElement('div')
  card.className = 'intro'
  const title = document.createElement('div')
  title.className = 'intro-title'
  const body = document.createElement('div')
  body.className = 'intro-body'
  const close = document.createElement('button')
  close.textContent = 'Понятно'
  close.addEventListener('click', () => (card.style.display = 'none'))
  card.append(title, body, close)
  card.style.display = 'none'
  stage.append(card)
  const PRIMER =
    '<b>G</b> — горутина (один гофер = одна горутина), <b>P</b> — платформа: слот выполнения (их =GOMAXPROCS). ' +
    'Горутина бежит, только стоя на P; заблокированная — уходит вниз в зоны ожидания. ' +
    '<b>M</b> — OS-поток (тележка с номером): id настоящие, из трейса. В блокирующем syscall M уходит вместе с горутиной, а P получает новый M; запаркованные M не рисуются. ' +
    'Внизу — подпись, что происходит сейчас, и журнал событий. ' +
    'Колесо мыши приближает мир (id читаются вблизи), перетаскивание двигает, двойной клик — весь мир. '
  let primerShown = false
  let lastId: string | null = null
  return {
    show(info) {
      const id = info?.id ?? null
      if (id === lastId) return // same scenario re-run — don't nag
      lastId = id
      const teach = info?.description ? `<span class="intro-teach">${info.description}</span>` : ''
      if (!primerShown) {
        primerShown = true
        body.innerHTML = PRIMER + (teach ? `<br>${teach}` : '')
      } else {
        if (!teach) return // nothing scenario-specific to say
        body.innerHTML = teach
      }
      title.textContent = info?.title ?? 'Планировщик Go'
      card.style.display = 'block'
    },
  }
}

void boot()
