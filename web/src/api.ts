import type { ScenarioInfo, Timeline } from './model/timeline'

export async function fetchScenarios(): Promise<ScenarioInfo[]> {
  const r = await fetch('/api/scenarios')
  if (!r.ok) throw new Error(`scenarios: HTTP ${r.status}`)
  return r.json() as Promise<ScenarioInfo[]>
}

export interface RunParams {
  scenario: string
  gomaxprocs?: number
  goroutines?: number
  duration?: string
}

export async function fetchRun(p: RunParams): Promise<Timeline> {
  const q = new URLSearchParams({ scenario: p.scenario })
  if (p.gomaxprocs != null) q.set('gomaxprocs', String(p.gomaxprocs))
  if (p.goroutines != null) q.set('goroutines', String(p.goroutines))
  if (p.duration != null) q.set('duration', p.duration)

  const r = await fetch(`/api/run?${q.toString()}`)
  if (!r.ok) throw new Error(`run: HTTP ${r.status}`)
  return r.json() as Promise<Timeline>
}
