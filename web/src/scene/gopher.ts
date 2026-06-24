import { Container, Graphics } from 'pixi.js'

// Gopher is a placeholder sprite: a colored body + eyes, plus a steal "flash"
// ring whose intensity is driven externally (0..1). It sits behind this factory
// so real pixel-art sprites can replace it later without touching the scene.
export interface Gopher {
  container: Container
  setColor(color: number): void
  /** steal-flash intensity, 0 (hidden) .. 1 (full). */
  setPulse(p: number): void
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

  container.addChild(ring, body, eyes)

  let lastColor = -1
  const setColor = (color: number): void => {
    if (color === lastColor) return
    body.clear()
    body.ellipse(0, 0, BODY_RX, BODY_RY).fill(color).stroke({ width: 1.5, color: OUTLINE })
    lastColor = color
  }

  const setPulse = (p: number): void => {
    ring.alpha = p
  }

  setColor(0xfbbf24)
  return { container, setColor, setPulse }
}
