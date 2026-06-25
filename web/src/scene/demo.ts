import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js'
import { PAL } from './palette'
import { gopherCanvas, ANCHOR_X, ANCHOR_Y, type GopherOpts } from './drawgopher'
import { drawGrid, drawStation, stationPositions, WORLD_W, WORLD_H } from './iso'

// Phase-1 demo: a static isometric scene built from the ported palette/sprites/
// tiles, with no live data. Reachable via ?iso for harness verification against
// design_handoff_go_scheduler/screens/01-calm.png.

function tex(opts: GopherOpts): Texture {
  const t = Texture.from(gopherCanvas(opts))
  t.source.scaleMode = 'nearest'
  return t
}

export async function renderIsoDemo(parent: HTMLElement, numProcs = 4): Promise<void> {
  const app = new Application()
  await app.init({ resizeTo: parent, background: PAL.bg0, antialias: false })
  parent.appendChild(app.canvas)

  const world = new Container()
  app.stage.addChild(world)
  const fit = (): void => {
    const s = Math.min(app.screen.width / WORLD_W, app.screen.height / WORLD_H)
    world.scale.set(s)
    world.x = (app.screen.width - WORLD_W * s) / 2
    world.y = (app.screen.height - WORLD_H * s) / 2
  }
  fit()
  window.addEventListener('resize', fit)

  const grid = new Graphics()
  drawGrid(grid)
  grid.alpha = 0.5
  world.addChild(grid)

  const stationsG = new Graphics()
  world.addChild(stationsG)

  const layer = new Container()
  layer.sortableChildren = true
  world.addChild(layer)

  const add = (opts: GopherOpts, x: number, y: number): void => {
    const s = new Sprite(tex(opts))
    s.anchor.set(ANCHOR_X, ANCHOR_Y)
    s.position.set(x, y)
    s.zIndex = y
    layer.addChild(s)
  }

  for (const st of stationPositions(numProcs)) {
    drawStation(stationsG, st.x, st.y)
    add({ state: 'running', work: true, armPhase: 1 }, st.x, st.y)
    for (let q = 0; q < 2; q++) add({ state: 'runnable', blink: q % 2 === 0 }, st.x - 6 - q * 5, st.y + 50 + q * 19)
  }
  for (let i = 0; i < 5; i++) add({ state: 'runnable' }, 26, 150 + i * 16)
  ;[
    [196, 206],
    [230, 214],
    [214, 228],
  ].forEach((p) => add({ state: 'waiting', zzz: true, zt: 0.3, blink: true }, p[0], p[1]))
  ;[
    [372, 206],
    [406, 214],
    [390, 228],
  ].forEach((p, i) => add({ state: 'syscall', flip: i % 2 === 0, dots: 2 }, p[0], p[1]))
}
