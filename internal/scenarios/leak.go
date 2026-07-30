package scenarios

import (
	"context"
	"runtime"
	"sync"
	"time"
)

const (
	// lkDrip is the CPU-paced gap between spawning two leaked goroutines: the
	// Waiting zone grows visibly step by step instead of all at once.
	lkDrip = 40 * time.Millisecond
	// lkWork is the leaked goroutine's brief on-P appearance before it parks
	// forever — the viewer sees it run, then walk into Waiting and stay.
	lkWork = 300 * time.Microsecond
)

func init() {
	Register(leak{})
}

// leak demonstrates the most common production goroutine bug: goroutines
// blocked on a channel nobody ever writes to. A dripper keeps spawning them;
// each runs briefly and parks forever, so the Waiting zone only grows and
// never drains. Background spinners keep the P stations alive so the leak
// contrasts against healthy work.
//
// The leaked goroutines are deliberately NOT in the WaitGroup: Run returns
// when the dripper and spinners finish, leaving them parked. In the workload
// subprocess they die with the process; in the in-process race test they
// linger parked until the test binary exits (<= 60 goroutines, harmless, and
// the test does not hang).
type leak struct{}

func (leak) Name() string { return "leak" }

func (leak) Describe() ScenarioInfo {
	return ScenarioInfo{
		ID:          "leak",
		Title:       "Утечка горутин",
		Description: "Часть горутин ждёт канал, в который никто никогда не пишет: зона Ожидание только растёт — так выглядит утечка в проде.",
		Order:       5,
		Params: []ParamSpec{
			{Name: "goroutines", Min: 4, Max: 60, Default: 24},
		},
	}
}

// lkSink keeps the workers' CPU work observable. Written only after the
// tracked goroutines join (in Run), so no race.
var lkSink uint64 //nolint:unused // deliberate write-only sink; see the comment above

func (leak) Run(ctx context.Context, p Params) error {
	n := max(p.Goroutines, 4)

	spinners := max(runtime.GOMAXPROCS(0), 1)
	results := make([]uint64, spinners+1)
	var wg sync.WaitGroup

	// Healthy background load: the stations stay busy, making the ever-growing
	// Waiting pile stand out as the anomaly it is.
	for i := range spinners {
		wg.Go(func() {
			var acc uint64
			defer func() { results[i] = acc }()
			for ctx.Err() == nil {
				acc += busyFor(2 * time.Millisecond)
			}
		})
	}

	// Dripper: spawns one leaked goroutine per lkDrip of CPU-paced time.
	wg.Go(func() {
		var acc uint64
		defer func() { results[spinners] = acc }()
		for leaked := 0; leaked < n && ctx.Err() == nil; leaked++ {
			ch := make(chan struct{}) // no writer will ever exist
			go func() {
				lkSpin(lkWork) // visible on a P for a moment...
				<-ch           // ...then parked forever: the leak
			}()
			acc += busyFor(lkDrip)
		}
	})

	wg.Wait()
	for _, v := range results {
		lkSink += v
	}
	return nil
}

// lkSpin is busyFor for the leaked goroutines. Their accumulator is written to
// a package sink directly-ish: they never join, so returning the value would
// be dropped; a plain call keeps the work from being optimized away because
// busyFor's result feeds a comparison the compiler cannot elide.
func lkSpin(d time.Duration) {
	if busyFor(d) == 0 {
		// busyFor's LCG never yields 0 from a non-zero seed; this branch exists
		// so the call has an observable effect and cannot be optimized away.
		panic("unreachable")
	}
}
