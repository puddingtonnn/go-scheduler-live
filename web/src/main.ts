import { fetchScenarios, fetchRun, type RunParams } from './api'
import type { ScenarioInfo, Timeline } from './model/timeline'
import { Player } from './player/player'
import { Scene } from './scene/scene'
import { Chrome } from './ui/chrome'
import { Controls } from './controls'

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

  root.append(chrome.header, stage, chrome.legend)
  const controls = new Controls(
    root,
    scenarios,
    (p) => void run(p),
    () => scene?.toggleIds() ?? false,
    () => scene?.toggleThreads() ?? false,
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

  async function run(params: RunParams): Promise<void> {
    controls.setLoading(true)
    errorBox.style.display = 'none'
    try {
      const tl = await fetchRun(params)
      timeline = tl
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
      chrome.setScenario(scenarioInfo(params.scenario))
      intro.show(scenarioInfo(params.scenario))

      const sc = scene
      const p = new Player(tl)
      p.onTick = (w) => {
        sc.setWorld(w)
        chrome.update(w)
        controls.sync()
      }
      player = p
      controls.bindPlayer(p)
      p.emit()
      p.play()
    } catch (e) {
      errorBox.textContent = `Ошибка запуска: ${msg(e)}. Проверьте, что бэкенд запущен.`
      errorBox.style.display = 'block'
    } finally {
      controls.setLoading(false)
    }
  }

  const first = scenarios[0]
  const firstGoroutines = first.params.find((p) => p.name === 'goroutines')?.default ?? 50
  await run({ scenario: first.id, gomaxprocs: 4, goroutines: firstGoroutines })

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

// makeIntro builds a small dismissible "what am I looking at" card shown on each
// new run, so a first-timer can parse the iso world (P = platform, G = gopher).
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
  let dismissed = false
  return {
    show(info) {
      if (dismissed) return // only nag once per session
      title.textContent = info?.title ?? 'Планировщик Go'
      body.innerHTML =
        '<b>G</b> — горутина (один гофер = одна горутина), <b>P</b> — платформа: слот выполнения (их =GOMAXPROCS). ' +
        'Горутина бежит, только стоя на P; заблокированная — уходит вниз в зоны ожидания. ' +
        '<b>M</b> — OS-поток (тележка с номером): id настоящие, из трейса. В блокирующем syscall M уходит вместе с горутиной, а P получает новый M; запаркованные M не рисуются. ' +
        'Внизу — подпись, что происходит сейчас. ' +
        (info?.description ? `<br><span class="intro-teach">${info.description}</span>` : '')
      card.style.display = 'block'
      close.addEventListener('click', () => (dismissed = true), { once: true })
    },
  }
}

void boot()
