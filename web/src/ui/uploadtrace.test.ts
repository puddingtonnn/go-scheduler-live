import { describe, it, expect } from 'vitest'
import { uploadErrorMessage, traceFacts } from './uploadtrace'
import type { Timeline } from '../model/timeline'

describe('uploadErrorMessage', () => {
  it('maps each wire-contract code to its i18n message', () => {
    expect(uploadErrorMessage(413, 'too_big')).toMatch(/16 МБ/)
    expect(uploadErrorMessage(400, 'unreadable')).toMatch(/трейс/)
    expect(uploadErrorMessage(400, 'too_dense')).toMatch(/200 000/)
    expect(uploadErrorMessage(400, 'not_a_trace')).toMatch(/активности/)
  })

  it('interpolates the observed P count for too_many_procs', () => {
    expect(uploadErrorMessage(400, 'too_many_procs', 12)).toContain('12')
    expect(uploadErrorMessage(400, 'too_many_procs', 12)).toMatch(/до 8/)
  })

  it('falls back to a generic status-keyed message for an unrecognized code', () => {
    const msg = uploadErrorMessage(500, 'some_future_code')
    expect(msg).toContain('500')
  })
})

describe('traceFacts', () => {
  it('extracts duration/events/numProcs/goroutine count from a Timeline', () => {
    const tl: Timeline = {
      meta: { scenario: 'custom', numProcs: 4, durationNs: 123_456, goroutines: [1, 2, 3] },
      events: [
        { t: 0, type: 'g_create', gid: 1, pid: 0, mid: 0 },
        { t: 1, type: 'g_run_start', gid: 1, pid: 0, mid: 0 },
      ],
    }
    expect(traceFacts(tl)).toEqual({
      durationNs: 123_456,
      events: 2,
      numProcs: 4,
      numGoroutines: 3,
    })
  })
})
