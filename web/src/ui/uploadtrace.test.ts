// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { uploadErrorMessage, traceFacts, createUploadPanel } from './uploadtrace'
import type { Timeline } from '../model/timeline'
import * as api from '../api'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return { ...actual, postTrace: vi.fn() }
})

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

function tl(scenario: string): Timeline {
  return { meta: { scenario, numProcs: 1, durationNs: 1, goroutines: [] }, events: [] }
}

// Regression test for the race a code review caught: a scenario run and a
// custom upload can be in flight at the same time, and whichever resolved
// LAST used to win outright regardless of which the user asked for last.
// main.ts fixes this with one shared generation counter that BOTH paths bump
// (before starting their async work) and check (before calling
// applyTimeline). createUploadPanel's contribution to that fix is calling
// onUploadStart synchronously, before postTrace's promise settles — this
// test reproduces main.ts's exact wiring pattern (a tiny fake "run()" plus
// the real createUploadPanel) to prove a stale result is dropped either way,
// without needing to import main.ts itself (a composition root with no
// exported, independently-callable pieces).
describe('upload vs. scenario-run supersession (mirrors main.ts wiring)', () => {
  it('drops a stale scenario fetch that resolves after a newer upload already applied', async () => {
    let runGen = 0
    const beginRun = (): number => ++runGen
    const isCurrentRun = (gen: number): boolean => gen === runGen
    const applied: string[] = []

    async function fakeRun(fetch: Promise<string>): Promise<void> {
      const gen = beginRun()
      const scenario = await fetch
      if (!isCurrentRun(gen)) return // superseded — must not apply
      applied.push(scenario)
    }

    let uploadGen = 0
    const container = document.createElement('div')
    const panel = createUploadPanel(container, {
      onUploadStart: () => {
        uploadGen = beginRun()
      },
      onUploaded: (t) => {
        if (!isCurrentRun(uploadGen)) return
        applied.push(t.meta.scenario)
      },
    })
    panel.show()

    let resolveUpload!: (v: Timeline) => void
    vi.mocked(api.postTrace).mockImplementationOnce(() => new Promise((res) => (resolveUpload = res)))

    let resolveScenarioFetch!: (v: string) => void
    const scenarioFetch = new Promise<string>((res) => (resolveScenarioFetch = res))
    const runPromise = fakeRun(scenarioFetch) // gen 1

    // Start the upload while the scenario fetch is still in flight — this
    // bumps the shared gen to 2 synchronously, via onUploadStart.
    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = new File(['x'], 'custom.trace')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))

    // The upload resolves first...
    resolveUpload(tl('custom'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // ...then the STALE scenario fetch resolves after it.
    resolveScenarioFetch('workstealing')
    await runPromise

    expect(applied).toEqual(['custom']) // the stale scenario result must not appear
  })

  it('drops a stale upload that resolves after a newer scenario run already applied', async () => {
    let runGen = 0
    const beginRun = (): number => ++runGen
    const isCurrentRun = (gen: number): boolean => gen === runGen
    const applied: string[] = []

    let uploadGen = 0
    const container = document.createElement('div')
    const panel = createUploadPanel(container, {
      onUploadStart: () => {
        uploadGen = beginRun()
      },
      onUploaded: (t) => {
        if (!isCurrentRun(uploadGen)) return
        applied.push(t.meta.scenario)
      },
    })
    panel.show()

    let resolveUpload!: (v: Timeline) => void
    vi.mocked(api.postTrace).mockImplementationOnce(() => new Promise((res) => (resolveUpload = res)))

    const input = container.querySelector('input[type=file]') as HTMLInputElement
    const file = new File(['x'], 'custom.trace')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change')) // gen 1 (upload starts first)

    async function fakeRun(fetch: Promise<string>): Promise<void> {
      const gen = beginRun()
      const scenario = await fetch
      if (!isCurrentRun(gen)) return
      applied.push(scenario)
    }

    // A scenario run starts (and finishes) while the upload is still in flight.
    const runPromise = fakeRun(Promise.resolve('workstealing')) // gen 2
    await runPromise

    // The STALE upload resolves after the newer scenario run already applied.
    resolveUpload(tl('custom'))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(applied).toEqual(['workstealing']) // the stale upload must not appear
  })
})
