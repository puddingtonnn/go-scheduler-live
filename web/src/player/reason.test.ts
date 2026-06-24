import { describe, it, expect } from 'vitest'
import { reasonCategory } from './reason'

describe('reasonCategory', () => {
  it.each([
    ['chan receive', 'канал'],
    ['chan send', 'канал'],
    ['select', 'канал'],
    ['sleep', 'сон'],
    ['sync', 'sync'],
    ['sync.Mutex.Lock', 'sync'],
    ['GC mark assist wait for work', 'GC'],
    ['system goroutine wait', 'прочее'],
    [undefined, 'прочее'],
    ['', 'прочее'],
  ])('maps %s -> %s', (reason, want) => {
    expect(reasonCategory(reason as string | undefined)).toBe(want)
  })
})
