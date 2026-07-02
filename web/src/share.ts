// Shareable-URL codec: ?scenario=&gomaxprocs=&goroutines=&t= reproduces a run
// (and, when paused, the exact moment). Pure string<->state mapping, no DOM —
// unit-tested; main.ts owns history.replaceState and the boot-time apply.
// The standalone `?iso` sprite demo uses its own key and is ignored here.

export interface ShareState {
  scenario?: string
  gomaxprocs?: number
  goroutines?: number
  /** paused playhead position, ns since trace start. */
  t?: number
}

function posInt(v: string | null): number | undefined {
  if (v === null) return undefined
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n : undefined
}

export function parseShare(search: string): ShareState {
  const q = new URLSearchParams(search)
  const scenario = q.get('scenario') ?? undefined
  const t = q.get('t') === null ? undefined : Number(q.get('t'))
  return {
    scenario: scenario && /^[a-z0-9_-]+$/i.test(scenario) ? scenario : undefined,
    gomaxprocs: posInt(q.get('gomaxprocs')),
    goroutines: posInt(q.get('goroutines')),
    t: t !== undefined && Number.isFinite(t) && t >= 0 ? Math.round(t) : undefined,
  }
}

export function buildShare(s: ShareState): string {
  const q = new URLSearchParams()
  if (s.scenario) q.set('scenario', s.scenario)
  if (s.gomaxprocs !== undefined) q.set('gomaxprocs', String(s.gomaxprocs))
  if (s.goroutines !== undefined) q.set('goroutines', String(s.goroutines))
  if (s.t !== undefined) q.set('t', String(Math.round(s.t)))
  return q.toString()
}
