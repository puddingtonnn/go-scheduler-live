import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js'
import { T_ANCHOR_X, T_ANCHOR_Y, T_TOP_FROM_BASE } from './drawthread'

// ThreadSprite is the OS-thread (M) carrier: a baked pixel texture plus an
// "M7" tag, in a container positioned at the carrier's base. Mirrors the
// Gopher wrapper shape (gopher.ts); the tag pill is deliberately duplicated
// rather than extracted so the gopher wrapper's internals stay untouched.
export interface ThreadSprite {
  container: Container
  setTexture(t: Texture): void
  setLabel(text: string): void
  showLabel(v: boolean): void
  /** re-rasterize the tag text for the given zoom bucket (crisp when zoomed). */
  setTagResolution(r: number): void
  setScale(s: number): void
  setAlpha(a: number): void
}

const TAG_GAP = 3

export function makeThread(tagColor: string): ThreadSprite {
  const container = new Container()

  const sprite = new Sprite()
  sprite.anchor.set(T_ANCHOR_X, T_ANCHOR_Y) // base at the container origin

  // id tag: dark pill + colored left bar + text, just above the chassis.
  const tag = new Container()
  const bg = new Graphics()
  const bar = new Graphics()
  const text = new Text({ text: '', style: { fill: tagColor, fontSize: 8, fontFamily: 'monospace' } })
  text.anchor.set(0.5, 0.5)
  tag.addChild(bg, bar, text)
  tag.y = T_TOP_FROM_BASE - TAG_GAP
  tag.visible = false

  const redraw = (): void => {
    const w = Math.ceil(text.width) + 8
    const h = Math.ceil(text.height) + 2
    bg.clear()
      .roundRect(-w / 2, -h / 2, w, h, 2)
      .fill({ color: 0x08090f, alpha: 0.9 })
    bar
      .clear()
      .rect(-w / 2, -h / 2, 2, h)
      .fill(tagColor)
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
    showLabel: (v) => {
      tag.visible = v
    },
    setTagResolution: (r) => {
      text.resolution = r
    },
    setScale: (s) => {
      sprite.scale.set(s) // anchored at the base, so the base stays planted
      tag.y = (T_TOP_FROM_BASE - TAG_GAP) * s
      tag.scale.set(Math.max(0.8, s)) // keep the id legible even in the zone crowd
    },
    setAlpha: (a) => {
      container.alpha = a
    },
  }
}
