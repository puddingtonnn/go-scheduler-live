import type { Pt } from './iso'

export interface BotState {
  x: number
  y: number
  sweeping: boolean
}

// botTarget positions the GC cleaning robot: parked at its dock when no concurrent
// mark is active, else cycling over a few sweep spots on the heap pile. Deterministic
// in its inputs (no wall clock) so it is unit-testable; the scene passes animT to
// drive the cycle. Sweep spots stay within ±SWEEP_R of the heap center. Pure.
const SWEEP_DX = 22
const SWEEP_DY = 12

export function botTarget(markActive: boolean, animT: number, heap: Pt, dock: Pt): BotState {
  if (!markActive) return { x: dock.x, y: dock.y, sweeping: false }
  const spots: Pt[] = [
    { x: heap.x - SWEEP_DX * 0.7, y: heap.y + SWEEP_DY * 0.5 },
    { x: heap.x + SWEEP_DX * 0.6, y: heap.y + SWEEP_DY * 0.8 },
    { x: heap.x + SWEEP_DX * 0.9, y: heap.y - SWEEP_DY * 0.2 },
    { x: heap.x - SWEEP_DX * 0.2, y: heap.y - SWEEP_DY * 0.6 },
  ]
  const i = ((Math.floor(animT * 1.5) % spots.length) + spots.length) % spots.length
  const s = spots[i]
  return { x: s.x, y: s.y, sweeping: true }
}

export const SWEEP_BOUNDS = { dx: SWEEP_DX, dy: SWEEP_DY }
