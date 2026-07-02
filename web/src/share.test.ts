import { describe, it, expect } from 'vitest'
import { parseShare, buildShare } from './share'

describe('share codec', () => {
  it('round-trips a full state', () => {
    const s = { scenario: 'syscalls', gomaxprocs: 4, goroutines: 8, t: 1_234_567 }
    expect(parseShare('?' + buildShare(s))).toEqual(s)
  })

  it('omits absent fields', () => {
    expect(buildShare({ scenario: 'mutex' })).toBe('scenario=mutex')
    expect(parseShare('?scenario=mutex')).toEqual({
      scenario: 'mutex',
      gomaxprocs: undefined,
      goroutines: undefined,
      t: undefined,
    })
  })

  it('drops garbage values instead of propagating them', () => {
    const s = parseShare('?scenario=..%2Fetc&gomaxprocs=-3&goroutines=abc&t=NaN')
    expect(s.scenario).toBeUndefined()
    expect(s.gomaxprocs).toBeUndefined()
    expect(s.goroutines).toBeUndefined()
    expect(s.t).toBeUndefined()
  })

  it('rounds fractional t and ignores the iso demo key', () => {
    expect(parseShare('?iso&t=10.6').t).toBe(11)
    expect(parseShare('?iso').scenario).toBeUndefined()
  })
})
