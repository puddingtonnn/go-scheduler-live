import { NO_RESOURCE, type Timeline } from '../model/timeline'

export type GState = 'runnable' | 'running' | 'waiting' | 'syscall' | 'dead'

export interface GoroutineView {
  gid: number
  state: GState
  /** associated P: where it runs (running/syscall) or was enqueued (runnable hint). */
  pid: number
  reason?: string
  /** the current run started as a reconstructed steal. */
  stolen: boolean
}

export interface ProcView {
  pid: number
  /** the goroutine currently running on this P, or NO_RESOURCE. */
  gid: number
}

export interface WorldState {
  t: number
  procs: ProcView[]
  goroutines: Map<number, GoroutineView>
  /** names of GC ranges active at t (e.g. stop-the-world). */
  gcActive: string[]
  heapLive?: number
  heapGoal?: number
}

// Heap metric names (must match the backend's traceparse constants).
const metricHeapLive = '/memory/classes/heap/objects:bytes'
const metricHeapGoal = '/gc/heap/goal:bytes'

// stateAt folds every event with t' <= t into the world state at time t. It is
// pure (no clock, no rendering), which makes scrubbing trivial and the logic
// unit-testable. Proc occupancy is derived from goroutine events; the explicit
// p_start/p_stop events are kept in the data for later but not needed here.
export function stateAt(timeline: Timeline, t: number): WorldState {
  const n = timeline.meta.numProcs
  const procs: ProcView[] = Array.from({ length: n }, (_, pid) => ({ pid, gid: NO_RESOURCE }))
  const goroutines = new Map<number, GoroutineView>()
  const gcActive: string[] = []
  let heapLive: number | undefined
  let heapGoal: number | undefined

  const setProc = (pid: number, gid: number) => {
    if (pid >= 0 && pid < n) procs[pid].gid = gid
  }
  const clearProc = (pid: number, gid: number) => {
    if (pid >= 0 && pid < n && procs[pid].gid === gid) procs[pid].gid = NO_RESOURCE
  }
  const view = (gid: number): GoroutineView => {
    let v = goroutines.get(gid)
    if (!v) {
      v = { gid, state: 'runnable', pid: NO_RESOURCE, stolen: false }
      goroutines.set(gid, v)
    }
    return v
  }

  for (const e of timeline.events) {
    if (e.t > t) break
    switch (e.type) {
      case 'g_create':
        goroutines.set(e.gid, { gid: e.gid, state: 'runnable', pid: e.pid, stolen: false })
        break
      case 'g_run_start': {
        const v = view(e.gid)
        v.state = 'running'
        v.pid = e.pid
        v.stolen = e.stolen ?? false
        v.reason = undefined
        setProc(e.pid, e.gid)
        break
      }
      case 'g_syscall_exit': {
        const v = view(e.gid)
        v.state = 'running'
        v.pid = e.pid
        v.stolen = false
        setProc(e.pid, e.gid)
        break
      }
      case 'g_run_stop': {
        const v = view(e.gid)
        clearProc(e.pid, e.gid)
        v.state = 'runnable'
        v.pid = e.pid
        v.stolen = false
        break
      }
      case 'g_unblock': {
        const v = view(e.gid)
        v.state = 'runnable'
        v.pid = e.pid
        v.stolen = false
        break
      }
      case 'g_block': {
        const v = view(e.gid)
        clearProc(e.pid, e.gid)
        v.state = 'waiting'
        v.reason = e.reason
        v.pid = NO_RESOURCE
        v.stolen = false
        break
      }
      case 'g_syscall_enter': {
        const v = view(e.gid)
        clearProc(e.pid, e.gid)
        v.state = 'syscall'
        v.pid = e.pid
        v.stolen = false
        break
      }
      case 'g_exit': {
        const v = view(e.gid)
        clearProc(e.pid, e.gid)
        v.state = 'dead'
        v.pid = NO_RESOURCE
        v.stolen = false
        break
      }
      case 'p_start':
      case 'p_stop':
        // Proc occupancy is derived from goroutine events above.
        break
      case 'gc_range_begin':
        if (e.name) gcActive.push(e.name)
        break
      case 'gc_range_end': {
        if (e.name) {
          const i = gcActive.lastIndexOf(e.name)
          if (i >= 0) gcActive.splice(i, 1)
        }
        break
      }
      case 'metric':
        if (e.name === metricHeapLive) heapLive = e.value
        else if (e.name === metricHeapGoal) heapGoal = e.value
        break
    }
  }

  return { t, procs, goroutines, gcActive, heapLive, heapGoal }
}
