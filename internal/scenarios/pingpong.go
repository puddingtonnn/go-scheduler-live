package scenarios

import (
	"context"
	"sync"
	"time"
)

// hopPause throttles the token so the ring runs at a watchable rate instead of
// circulating millions of times per second.
const hopPause = 4 * time.Millisecond

func init() {
	Register(pingPong{})
}

// pingPong connects goroutines in a ring of channels and circulates a single
// token. At any moment almost every goroutine is parked on a channel operation,
// so the trace is full of chan receive / chan send blocks and unblocks — the
// behavior this scenario exists to make visible.
type pingPong struct{}

func (pingPong) Name() string { return "pingpong" }

func (pingPong) Describe() ScenarioInfo {
	return ScenarioInfo{
		ID:          "pingpong",
		Title:       "Каналы (ping-pong)",
		Description: "Кольцо горутин передаёт токен по каналам: почти все стоят заблокированные на chan receive/send.",
		Order:       1,
		Params: []ParamSpec{
			{Name: "goroutines", Min: 2, Max: 200, Default: 24},
		},
	}
}

func (pingPong) Run(ctx context.Context, p Params) error {
	n := max(p.Goroutines, 2)

	ring := make([]chan struct{}, n)
	for i := range ring {
		ring[i] = make(chan struct{})
	}

	var wg sync.WaitGroup
	wg.Add(n)
	for i := range n {
		in := ring[i]
		out := ring[(i+1)%n]
		go func() {
			defer wg.Done()
			for {
				// Wait for the token, then hand it to the next goroutine. Both
				// operations honor ctx so the ring unwinds cleanly on shutdown.
				select {
				case <-ctx.Done():
					return
				case <-in:
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(hopPause):
				}
				select {
				case <-ctx.Done():
					return
				case out <- struct{}{}:
				}
			}
		}()
	}

	// Inject the token; it circulates until ctx is cancelled.
	select {
	case ring[0] <- struct{}{}:
	case <-ctx.Done():
	}

	wg.Wait()
	return nil
}
