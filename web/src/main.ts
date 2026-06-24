import { fetchScenarios, fetchRun, type RunParams } from './api'
import type { Timeline } from './model/timeline'
import { narrate } from './player/narrate'
import { Player } from './player/player'
import { Scene } from './scene/scene'
import { Controls } from './controls'

// Composition root: builds the control bar + canvas host, then on each run
// fetches a Timeline, (re)configures the scene, and drives it with a fresh
// virtual-clock Player. The old player is paused so only one clock ticks.
async function boot(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')

  const stage = document.createElement('div')
  stage.className = 'stage'

  const scenarios = await fetchScenarios()

  let scene: Scene | null = null
  let player: Player | null = null
  let timeline: Timeline | null = null

  const controls = new Controls(root, scenarios, (p) => void run(p), () => scene?.toggleIds() ?? false)
  root.append(stage)

  // Expose the current player/scene/timeline for the screenshot harness and debugging.
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

  async function run(params: RunParams): Promise<void> {
    controls.setLoading(true)
    try {
      const tl = await fetchRun(params)
      timeline = tl
      player?.pause()
      if (!scene) scene = await Scene.create(stage, tl.meta.numProcs)
      else scene.reset(tl.meta.numProcs)

      const sc = scene
      const p = new Player(tl)
      p.onTick = (w) => {
        sc.setWorld(w)
        sc.setCaption(narrate(tl.events, p.t))
        controls.sync()
      }
      player = p
      controls.bindPlayer(p)
      p.emit()
      p.play()
    } catch (e) {
      stage.textContent = `Ошибка: ${e instanceof Error ? e.message : String(e)}`
    } finally {
      controls.setLoading(false)
    }
  }

  await run({ scenario: scenarios[0].id, gomaxprocs: 4, goroutines: 50 })

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault()
      player?.toggle()
    }
  })
}

void boot()
