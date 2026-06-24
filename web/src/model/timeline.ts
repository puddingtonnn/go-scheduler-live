// Mirror of the Go timeline DTO (internal/timeline). Keep these in sync with the
// backend's JSON contract.

export type EventType =
  | 'g_create'
  | 'g_run_start'
  | 'g_run_stop'
  | 'g_block'
  | 'g_unblock'
  | 'g_syscall_enter'
  | 'g_syscall_exit'
  | 'g_exit'
  | 'p_start'
  | 'p_stop'
  | 'gc_range_begin'
  | 'gc_range_end'
  | 'metric'

/** Sentinel for an absent goroutine/proc id (matches timeline.NoResource). */
export const NO_RESOURCE = -1

export interface TimelineEvent {
  /** ns since the first trace event. */
  t: number
  type: EventType
  gid: number
  pid: number
  reason?: string
  name?: string
  value?: number
  stolen?: boolean
}

export interface Meta {
  scenario: string
  numProcs: number
  durationNs: number
  goroutines: number[]
}

export interface Timeline {
  meta: Meta
  events: TimelineEvent[]
}

export interface ScenarioParam {
  name: string
  min: number
  max: number
  default: number
}

export interface ScenarioInfo {
  id: string
  title: string
  description: string
  params: ScenarioParam[]
}
