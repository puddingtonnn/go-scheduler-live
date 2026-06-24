package scenarios

import (
	"context"
	"runtime"
	"sync"
	"time"
)

// hopBusy is how long a token holder works (Running, on a P) before passing the
// token on — CPU work, not a timer sleep, so the holder is visible on a platform.
const hopBusy = 4 * time.Millisecond

func init() {
	Register(pingPong{})
}

// pingPong connects goroutines in a ring of channels and circulates GOMAXPROCS
// tokens. A token holder does a little CPU work then hands the token to the next
// goroutine; everyone else is parked on a channel receive. So at any moment a few
// gophers run on Ps (passing tokens) while the rest wait on channels — the
// channel-blocking behavior this scenario exists to show.
type pingPong struct{}

func (pingPong) Name() string { return "pingpong" }

func (pingPong) Describe() ScenarioInfo {
	return ScenarioInfo{
		ID:          "pingpong",
		Title:       "Каналы (ping-pong)",
		Description: "Кольцо горутин передаёт токены по каналам: несколько бегут, остальные ждут на chan receive.",
		Order:       1,
		Params: []ParamSpec{
			{Name: "goroutines", Min: 2, Max: 200, Default: 24},
		},
	}
}

// ppSink keeps the token-holders' CPU work observable. Written only after the
// goroutines join (in Run), so no race.
var ppSink uint64

func (pingPong) Run(ctx context.Context, p Params) error {
	n := max(p.Goroutines, 2)

	ring := make([]chan struct{}, n)
	for i := range ring {
		ring[i] = make(chan struct{})
	}

	results := make([]uint64, n)
	var wg sync.WaitGroup
	wg.Add(n)
	for i := range n {
		in := ring[i]
		out := ring[(i+1)%n]
		go func() {
			defer wg.Done()
			var acc uint64
			defer func() { results[i] = acc }()
			for {
				select {
				case <-ctx.Done():
					return
				case <-in:
				}
				acc += busyFor(hopBusy) // hold the token by working (Running), not sleeping
				select {
				case <-ctx.Done():
					return
				case out <- struct{}{}:
				}
			}
		}()
	}

	// Inject GOMAXPROCS tokens spread around the ring so several goroutines run
	// concurrently instead of just one.
	tokens := min(max(runtime.GOMAXPROCS(0), 1), n)
	for k := range tokens {
		select {
		case ring[(k*n)/tokens] <- struct{}{}:
		case <-ctx.Done():
		}
	}

	wg.Wait()
	for _, v := range results {
		ppSink += v
	}
	return nil
}
