package timeline

import "sort"

// Build assembles a Timeline from normalized events. It sorts events by time,
// reconstructs the work-stealing flag, and fills metadata. NumProcs is taken
// from the caller (the authoritative GOMAXPROCS the workload ran with), not
// inferred from the trace.
func Build(events []Event, gomaxprocs int, scenario string) Timeline {
	sort.SliceStable(events, func(i, j int) bool { return events[i].T < events[j].T })

	reconstructSteals(events)

	var (
		gids     []int64
		seen     = map[int64]struct{}{}
		duration int64
	)
	for _, e := range events {
		if e.T > duration {
			duration = e.T
		}
		if e.GID == NoResource {
			continue
		}
		if _, ok := seen[e.GID]; !ok {
			seen[e.GID] = struct{}{}
			gids = append(gids, e.GID)
		}
	}

	return Timeline{
		Meta: Meta{
			Scenario:   scenario,
			NumProcs:   gomaxprocs,
			DurationNs: duration,
			Goroutines: gids,
		},
		Events: events,
	}
}

// reconstructSteals sets Stolen on g_run_start events whose goroutine last
// became runnable on a different P than the one it now runs on.
//
// This is a heuristic, NOT a fact from the trace: the runtime records neither
// local run-queue membership nor steals directly. We approximate by remembering,
// per goroutine, the P seen when it was created or unblocked, and flag a run
// start on a different P. At unblock that P is the *unblocker's* P, so the signal
// is rough — which is exactly why it is surfaced as a reconstruction flag.
func reconstructSteals(events []Event) {
	lastRunnableProc := map[int64]int64{}
	for i := range events {
		e := &events[i]
		switch e.Type {
		case EventGCreate, EventGUnblock:
			lastRunnableProc[e.GID] = e.PID
		case EventGRunStart:
			prev, ok := lastRunnableProc[e.GID]
			if ok && prev != NoResource && e.PID != NoResource && e.PID != prev {
				e.Stolen = true
			}
			lastRunnableProc[e.GID] = e.PID
		}
	}
}
