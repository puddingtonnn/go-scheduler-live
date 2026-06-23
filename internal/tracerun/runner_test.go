package tracerun

import (
	"bytes"
	"context"
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

func TestRunRejectsEmptyScenario(t *testing.T) {
	if _, err := Run(context.Background(), Request{}); err == nil {
		t.Fatal("expected error for empty scenario")
	}
}
