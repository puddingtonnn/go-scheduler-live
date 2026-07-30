package scenarios

import (
	"context"
	"sync"
	"time"
)

func init() {
	Register(gcPressure{})
}

// gcPressure has goroutines allocate short-lived garbage as fast as they can, so
// the heap grows and the garbage collector runs repeatedly — producing GC mark
// ranges, stop-the-world pauses, and a sawtooth heap metric in the trace.
type gcPressure struct{}

func (gcPressure) Name() string { return "gcpressure" }

func (gcPressure) Describe() ScenarioInfo {
	return ScenarioInfo{
		ID:          "gcpressure",
		Title:       "Давление на GC (аллокации)",
		Description: "Горутины быстро плодят мусор: куча растёт, GC запускается циклами с фазами mark и stop-the-world.",
		Order:       3,
		Params: []ParamSpec{
			{Name: "goroutines", Min: 1, Max: 200, Default: 20},
		},
	}
}

// sinkGC keeps allocation work observable so the compiler cannot optimize it
// away. Written only by Run's goroutine after the workers finish — no race.
var sinkGC int //nolint:unused // deliberate write-only sink; see the comment above

func (gcPressure) Run(ctx context.Context, p Params) error {
	n := max(p.Goroutines, 1)

	results := make([]int, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := range n {
		go func() {
			defer wg.Done()
			results[i] = allocate(ctx)
		}()
	}
	wg.Wait()

	for _, v := range results {
		sinkGC += v
	}
	return nil
}

// allocate churns short-lived heap objects, retaining only a small rolling
// window so most become garbage. Between bursts it paces with CPU work (not a
// timer sleep), so the goroutine stays Running/Runnable — visible on the P
// platforms and queues — while the heap sawtooths through GC cycles. It returns
// an accumulator so the work stays observable, and checks ctx to stop.
func allocate(ctx context.Context) int {
	const (
		blockSize = 8192
		batch     = 24
		windowCap = 128
		pace      = 4 * time.Millisecond
	)
	total := 0
	buf := make([][]byte, 0, windowCap)
	for {
		for i := range batch {
			b := make([]byte, blockSize)
			b[0] = byte(i)
			total += int(b[0])
			buf = append(buf, b)
			if len(buf) >= windowCap {
				buf = buf[:0] // drop references: the window becomes garbage
			}
		}
		total += int(busyFor(pace)) // pace allocation with CPU work, not sleep
		if ctx.Err() != nil {
			return total
		}
	}
}
