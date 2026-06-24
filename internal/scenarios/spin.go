package scenarios

import "time"

// busyFor burns CPU for ~d of wall-clock time so the calling goroutine stays in
// the Running state (it wants the CPU) instead of being parked in Waiting by a
// timer. Pacing scenario loops with CPU work — not time.Sleep / time.After —
// keeps the goroutines visible on the P platforms; being wall-clock-bounded also
// keeps the resulting event volume machine-independent.
//
// It returns an accumulator so callers can keep the work from being optimized
// away (add it into a package-level sink after the goroutines join).
func busyFor(d time.Duration) uint64 {
	var x uint64 = 1
	end := time.Now().Add(d)
	for {
		for range 2000 {
			x = x*1664525 + 1013904223 // cheap LCG, keeps the CPU busy
		}
		if !time.Now().Before(end) {
			return x
		}
	}
}
