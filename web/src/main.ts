import { fetchScenarios, fetchRun } from './api'
import { Player } from './player/player'
import { Scene } from './scene/scene'

// F3 entry: load a Timeline, build the scene + player, auto-play. Real controls
// (play/pause/scrub/speed, scenario picker) arrive in F4; for now Space toggles
// play/pause so the scene can be eyeballed.
async function boot(): Promise<void> {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')
  root.textContent = 'Загрузка…'

  try {
    const scenarios = await fetchScenarios()
    const tl = await fetchRun({ scenario: scenarios[0].id, gomaxprocs: 4, goroutines: 50 })
    root.textContent = ''

    const scene = await Scene.create(root, tl.meta.numProcs)
    const player = new Player(tl)
    player.onTick = (w) => scene.setWorld(w)

    // Expose for the headless screenshot harness (and manual debugging).
    ;(globalThis as Record<string, unknown>).gmp = { player, scene }

    player.emit()
    player.play()

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault()
        player.toggle()
      }
    })
  } catch (e) {
    root.textContent = `Ошибка: ${e instanceof Error ? e.message : String(e)}`
  }
}

void boot()
