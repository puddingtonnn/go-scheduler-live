import type { ScenarioInfo, Timeline } from './model/timeline'
import { t } from './i18n'

export interface RunParams {
  scenario: string
  gomaxprocs?: number
  goroutines?: number
  duration?: string
}

// Static-demo mode (VITE_STATIC=1, e.g. GitHub Pages): no Go backend — the
// frontend reads timelines pre-baked by `go run ./cmd/bake` from public/runs/.
// fetchRun then serves the nearest baked run for the requested params; the
// chrome's meta readouts (numProcs etc.) always reflect what actually loaded.
const STATIC = import.meta.env.VITE_STATIC === '1'
const RUNS_BASE = `${import.meta.env.BASE_URL}runs/`

// isStaticDemo lets the UI say out loud that parameters here select the nearest
// pre-baked run instead of recording a new trace — otherwise a visitor changes
// the goroutine count, sees the same world, and concludes the control is broken.
export function isStaticDemo(): boolean {
  return STATIC
}

interface BakedRun {
  scenario: string
  gomaxprocs: number
  goroutines: number
  file: string
}

interface BakedIndex {
  scenarios: ScenarioInfo[]
  runs: BakedRun[]
}

let bakedIndex: Promise<BakedIndex> | null = null

function loadIndex(): Promise<BakedIndex> {
  bakedIndex ??= fetch(`${RUNS_BASE}index.json`).then((r) => {
    if (!r.ok) throw new Error(t().api.demoIndex(r.status))
    return r.json() as Promise<BakedIndex>
  })
  return bakedIndex
}

// nearestRun picks the baked run closest to the request: same scenario is
// mandatory, then nearest gomaxprocs (dominant), then nearest goroutines.
export function nearestRun<T extends { scenario: string; gomaxprocs: number; goroutines: number }>(
  runs: T[],
  p: RunParams,
): T | undefined {
  const dist = (r: T): number =>
    Math.abs(r.gomaxprocs - (p.gomaxprocs ?? r.gomaxprocs)) * 1000 +
    Math.abs(r.goroutines - (p.goroutines ?? r.goroutines))
  return runs
    .filter((r) => r.scenario === p.scenario)
    .sort((a, b) => dist(a) - dist(b))[0]
}

export async function fetchScenarios(): Promise<ScenarioInfo[]> {
  if (STATIC) return (await loadIndex()).scenarios

  const r = await fetch('/api/scenarios')
  if (!r.ok) throw new Error(`scenarios: HTTP ${r.status}`)
  return r.json() as Promise<ScenarioInfo[]>
}

export async function fetchRun(p: RunParams): Promise<Timeline> {
  if (STATIC) {
    const idx = await loadIndex()
    const run = nearestRun(idx.runs, p)
    if (!run) throw new Error(t().api.noBaked(p.scenario))
    const r = await fetch(`${RUNS_BASE}${run.file}`)
    if (!r.ok) throw new Error(t().api.demoRun(r.status))
    return r.json() as Promise<Timeline>
  }

  const q = new URLSearchParams({ scenario: p.scenario })
  if (p.gomaxprocs != null) q.set('gomaxprocs', String(p.gomaxprocs))
  if (p.goroutines != null) q.set('goroutines', String(p.goroutines))
  if (p.duration != null) q.set('duration', p.duration)

  const r = await fetch(`/api/run?${q.toString()}`)
  if (!r.ok) throw new Error(`run: HTTP ${r.status}`)
  return r.json() as Promise<Timeline>
}

// TraceUploadError carries the wire-contract `code` (and `n` for too_many_procs)
// plus the HTTP status, so callers can map it through i18n (uploadErrorMessage
// in ui/uploadtrace.ts) rather than just displaying the raw server text. Status
// is kept alongside code (not in the brief's minimal sketch) so an unrecognized
// future code still has something to key a fallback message on.
export class TraceUploadError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly n?: number,
  ) {
    super(message)
  }
}

// postTrace uploads a raw .trace file body to POST /api/trace (not multipart —
// File implements BodyInit) and returns the parsed Timeline. On failure the
// backend responds with a structured {error, code, n?} body.
export async function postTrace(file: File): Promise<Timeline> {
  if (STATIC) throw new Error(t().custom.needsServer)
  const r = await fetch('/api/trace', { method: 'POST', body: file })
  if (!r.ok) {
    // A non-JSON body means an infrastructure failure (proxy/server error),
    // not a bad trace — fall back to an empty code (not one of the five wire
    // codes) so uploadErrorMessage falls through to its generic, status-keyed
    // message instead of claiming the file isn't a trace.
    const body = await r.json().catch(() => ({ error: `HTTP ${r.status}`, code: '' }))
    throw new TraceUploadError(body.error ?? `HTTP ${r.status}`, body.code ?? '', r.status, body.n)
  }
  return r.json() as Promise<Timeline>
}
