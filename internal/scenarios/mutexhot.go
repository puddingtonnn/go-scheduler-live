package scenarios

import (
	"context"
	"sync"
	"time"
)

// Pacing: the critical section is long relative to the outside work, so at any
// moment one worker runs and the rest are parked on the mutex. Contention
// self-paces the event volume — lock handoffs are serialized (~500 per 600ms
// run regardless of the worker count).
const (
	mhHold = 1200 * time.Microsecond // CPU work inside the critical section
	mhGap  = 200 * time.Microsecond  // CPU work outside, before re-contending
)

func init() {
	Register(mutexHot{})
}

// mutexHot makes N workers fight over one sync.Mutex: the critical section
// serializes the work, so adding Ps does not add throughput — the classic
// production contention picture. Visually: one gopher runs while the rest sit
// in the Waiting zone under the "sync" reason.
type mutexHot struct{}

func (mutexHot) Name() string { return "mutex" }

func (mutexHot) Describe() ScenarioInfo {
	return ScenarioInfo{
		ID:          "mutex",
		Title:       "Горячий мьютекс (contention)",
		Description: "N воркеров делят один sync.Mutex: критическая секция сериализует работу — бежит один, остальные ждут, сколько бы P ни было.",
		Order:       4,
		Params: []ParamSpec{
			{Name: "goroutines", Min: 2, Max: 64, Default: 12},
		},
	}
}

// mhSink keeps the workers' CPU work observable. Written only after the
// goroutines join (in Run), so no race.
var mhSink uint64

func (mutexHot) Run(ctx context.Context, p Params) error {
	n := max(p.Goroutines, 2)

	var mu sync.Mutex
	results := make([]uint64, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Go(func() {
			var acc uint64
			defer func() { results[i] = acc }()
			for ctx.Err() == nil {
				mu.Lock()
				acc += busyFor(mhHold)
				mu.Unlock()
				acc += busyFor(mhGap)
			}
		})
	}

	wg.Wait()
	for _, v := range results {
		mhSink += v
	}
	return nil
}
