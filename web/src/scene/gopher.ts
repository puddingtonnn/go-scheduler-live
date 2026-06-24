import { Container, Graphics, Text } from 'pixi.js'

// Gopher is a placeholder sprite: a colored body + eyes, a steal "flash" ring,
// and an optional id label. It sits behind this factory so real pixel-art
// sprites can replace it later without touching the scene.
export interface Gopher {
  container: Container
  setColor(color: number): void
  /** steal-flash intensity, 0 (hidden) .. 1 (full). */
  setPulse(p: number): void
  setLabel(text: string): void
  showLabel(v: boolean): void
}

const BODY_RX = 12
const BODY_RY = 14
const OUTLINE = 0x0f172a

export function makeGopher(): Gopher {
  const container = new Container()

  const ring = new Graphics()
  ring.circle(0, 0, BODY_RY + 7).stroke({ width: 3.5, color: 0xef4444 })
  ring.alpha = 0

  const body = new Graphics()

  const eyes = new Graphics()
  eyes
    .circle(-4, -4, 2.8)
    .fill(0xffffff)
    .circle(4, -4, 2.8)
    .fill(0xffffff)
    .circle(-4, -4, 1.3)
    .fill(OUTLINE)
    .circle(4, -4, 1.3)
    .fill(OUTLINE)

  const label = new Text({ text: '', style: { fill: 0xe2e8f0, fontSize: 9, fontFamily: 'monospace' } })
  label.anchor.set(0.5, 1)
  label.y = -BODY_RY - 3
  label.visible = false

  container.addChild(ring, body, eyes, label)

  let lastColor = -1
  const setColor = (color: number): void => {
    if (color === lastColor) return
    body.clear()
    body.ellipse(0, 0, BODY_RX, BODY_RY).fill(color).stroke({ width: 1.5, color: OUTLINE })
    lastColor = color
  }

  return {
    container,
    setColor,
    setPulse: (p: number) => {
      ring.alpha = p
    },
    setLabel: (text: string) => {
      label.text = text
    },
    showLabel: (v: boolean) => {
      label.visible = v
    },
  }
}
