// @vitest-environment happy-dom
//
// Regression guard for scripts/verify-controls.mjs, which reads
// `.controls input[type=number]`[0] as GOMAXPROCS regardless of UI mode.
// controls.ts nests a second type=number input (goroutines) inside the
// .controls-advanced wrapper — this only stays safe if procsInput precedes
// that wrapper in DOM order (display:none doesn't change document order).
import { describe, it, expect } from 'vitest'
import { Controls } from './controls'
import type { ScenarioInfo } from './model/timeline'

const SCENARIOS: ScenarioInfo[] = [
  {
    id: 'workstealing',
    title: 'Work stealing',
    description: '',
    order: 0,
    params: [{ name: 'goroutines', min: 1, max: 200, default: 50 }],
  },
]

describe('Controls DOM order', () => {
  it('keeps GOMAXPROCS as the first .controls input[type=number]', () => {
    const container = document.createElement('div')
    new Controls(container, SCENARIOS, () => {})
    const nums = container.querySelectorAll('.controls input[type=number]')
    expect(nums.length).toBe(2)
    expect(nums[0].getAttribute('aria-label')).toBe('GOMAXPROCS')
  })
})
