import { Container, Sprite, Text, type Texture } from 'pixi.js'

// Gopher is a pixel-art sprite (body texture baked by the scene) plus an
// optional id label, in a container positioned at the gopher's feet. Real
// per-state textures and overlays are owned by the scene; this stays a thin
// wrapper so the sprite source can change later without touching the scene.
export interface Gopher {
  container: Container
  setTexture(t: Texture): void
  setLabel(text: string): void
  showLabel(v: boolean): void
}

export function makeGopher(): Gopher {
  const container = new Container()

  const sprite = new Sprite()
  sprite.anchor.set(0.5, 0.886) // feet at the container origin (44x44 cell)

  const label = new Text({ text: '', style: { fill: 0xe7eafb, fontSize: 7, fontFamily: 'monospace' } })
  label.anchor.set(0.5, 1)
  label.y = -31
  label.visible = false

  container.addChild(sprite, label)

  return {
    container,
    setTexture: (t) => {
      sprite.texture = t
    },
    setLabel: (s) => {
      label.text = s
    },
    showLabel: (v) => {
      label.visible = v
    },
  }
}
