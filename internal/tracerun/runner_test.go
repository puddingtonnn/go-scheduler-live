package tracerun

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"gmp-model/internal/timeline"
	"gmp-model/internal/traceparse"
)

// TestRunProducesParsableTrace runs the full pipeline: subprocess workload ->
// raw trace -> parse -> build. It compiles and runs the workload, so it is
// skipped under -short.
func TestRunProducesParsableTrace(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping: compiles and runs the workload subprocess")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	raw, err := Run(ctx, Request{
		Scenario:   "workstealing",
		GOMAXPROCS: 2,
		Goroutines: 20,
		Duration:   2 * time.Second,
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	events, err := traceparse.Parse(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	tl := timeline.Build(events, 2, "workstealing")

	if tl.Meta.NumProcs != 2 {
		t.Errorf("NumProcs = %d, want 2", tl.Meta.NumProcs)
	}
	if len(tl.Meta.Goroutines) < 20 {
		t.Errorf("goroutines = %d, want >= 20", len(tl.Meta.Goroutines))
	}
	t.Logf("subprocess trace: %d bytes, %d events, %d goroutines",
		len(raw), len(tl.Events), len(tl.Meta.Goroutines))
}

// TestScenarioEvents runs each non-default scenario as a subprocess and checks
// it produces the events it exists to demonstrate. Skipped under -short.
func TestScenarioEvents(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping: compiles and runs workload subprocesses")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()

	parse := func(t *testing.T, req Request) []timeline.Event {
		t.Helper()
		raw, err := Run(ctx, req)
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		ev, err := traceparse.Parse(bytes.NewReader(raw))
		if err != nil {
			t.Fatalf("Parse: %v", err)
		}
		return ev
	}

	t.Run("pingpong blocks and unblocks on channels", func(t *testing.T) {
		ev := parse(t, Request{Scenario: "pingpong", GOMAXPROCS: 4, Goroutines: 24, Duration: 500 * time.Millisecond})
		var blocks, unblocks int
		for _, e := range ev {
			switch e.Type {
			case timeline.EventGBlock:
				blocks++
			case timeline.EventGUnblock:
				unblocks++
			}
		}
		if blocks == 0 || unblocks == 0 {
			t.Errorf("want channel blocks and unblocks, got block=%d unblock=%d", blocks, unblocks)
		}
	})

	t.Run("gcpressure triggers GC mark phases and heap metrics", func(t *testing.T) {
		ev := parse(t, Request{Scenario: "gcpressure", GOMAXPROCS: 4, Goroutines: 20, Duration: 700 * time.Millisecond})
		var gcMark, metrics int
		for _, e := range ev {
			if e.Type == timeline.EventGCRangeBegin && strings.Contains(e.Name, "mark phase") {
				gcMark++
			}
			if e.Type == timeline.EventMetric {
				metrics++
			}
		}
		if gcMark == 0 {
			t.Errorf("want GC mark-phase ranges, got 0")
		}
		if metrics == 0 {
			t.Errorf("want heap metric samples, got 0")
		}
	})
}

func TestRunRejectsEmptyScenario(t *testing.T) {
	if _, err := Run(context.Background(), Request{}); err == nil {
		t.Fatal("expected error for empty scenario")
	}
}
