import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import { ANCHOR_X, ANCHOR_Y, HEAD_TOP_FROM_FEET } from './drawgopher'

// Gopher is a pixel-art sprite (body texture baked by the scene) plus an id tag
// above its head, in a container positioned at the gopher's feet. The tag is a
// dark pill with a state-colored left bar + text so a goroutine's id stays
// legible over the dense iso pile. Real per-state textures and overlays are owned
// by the scene; this stays a thin wrapper so the sprite source can change later.
export interface Gopher {
  container: Container
  setTexture(t: Texture): void
  setLabel(text: string): void
  setTagColor(hex: string): void
  showLabel(v: boolean): void
}

export function makeGopher(): Gopher {
  const container = new Container()

  const sprite = new Sprite()
  sprite.anchor.set(ANCHOR_X, ANCHOR_Y) // feet at the container origin

  // id tag: dark pill + state-colored bar + text, just above the head.
  const tag = new Container()
  const bg = new Graphics()
  const bar = new Graphics()
  const text = new Text({ text: '', style: { fill: '#e7eafb', fontSize: 8, fontFamily: 'monospace' } })
  text.anchor.set(0.5, 0.5)
  tag.addChild(bg, bar, text)
  tag.y = HEAD_TOP_FROM_FEET - 5
  tag.visible = false

  let color = '#e7eafb'
  const redraw = (): void => {
    const w = Math.ceil(text.width) + 8
    const h = Math.ceil(text.height) + 2
    bg.clear()
      .roundRect(-w / 2, -h / 2, w, h, 2)
      .fill({ color: 0x08090f, alpha: 0.9 })
    bar
      .clear()
      .rect(-w / 2, -h / 2, 2, h)
      .fill(color)
  }

  container.addChild(sprite, tag)

  return {
    container,
    setTexture: (t) => {
      sprite.texture = t
    },
    setLabel: (s) => {
      text.text = s
      redraw()
    },
    setTagColor: (hex) => {
      color = hex
      text.style.fill = hex
      redraw()
    },
    showLabel: (v) => {
      tag.visible = v
    },
  }
}
