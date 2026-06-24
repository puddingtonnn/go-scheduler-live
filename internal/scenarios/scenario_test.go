package scenarios

import (
	"context"
	"testing"
	"time"
)

// TestScenariosRunRace runs every registered scenario in-process under a short
// deadline. Its real value is under `go test -race`: it exercises each
// scenario's own goroutine/channel code with the race detector (the subprocess
// integration tests cannot, since the workload runs uninstrumented).
func TestScenariosRunRace(t *testing.T) {
	for _, info := range All() {
		sc, err := Get(info.ID)
		if err != nil {
			t.Fatal(err)
		}
		t.Run(info.ID, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
			defer cancel()
			if err := sc.Run(ctx, Params{Goroutines: 12, Duration: 200 * time.Millisecond}); err != nil {
				t.Errorf("Run: %v", err)
			}
		})
	}
}
