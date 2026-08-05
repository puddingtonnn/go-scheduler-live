package timeline

import "testing"

func TestBuildReconstructsSteal(t *testing.T) {
	// G10 becomes runnable on P0 but runs on P1  -> stolen.
	// G20 becomes runnable on P0 and runs on P0  -> not stolen.
	events := []Event{
		{T: 1, Type: EventGCreate, GID: 10, PID: 0},
		{T: 2, Type: EventGCreate, GID: 20, PID: 0},
		{T: 3, Type: EventGRunStart, GID: 20, PID: 0},
		{T: 4, Type: EventGRunStart, GID: 10, PID: 1},
	}

	tl := Build(events, 4, "test")

	stolen := map[int64]bool{}
	for _, e := range tl.Events {
		if e.Type == EventGRunStart {
			stolen[e.GID] = e.Stolen
		}
	}
	if !stolen[10] {
		t.Errorf("G10 should be stolen (runnable on P0, ran on P1)")
	}
	if stolen[20] {
		t.Errorf("G20 should not be stolen (runnable and ran on P0)")
	}
}

func TestBuildSkipsStealWhenProcUnknown(t *testing.T) {
	// Unblocked with no associated P (NoResource): we cannot tell -> not stolen.
	events := []Event{
		{T: 1, Type: EventGUnblock, GID: 7, PID: NoResource},
		{T: 2, Type: EventGRunStart, GID: 7, PID: 2},
	}

	tl := Build(events, 4, "test")

	for _, e := range tl.Events {
		if e.Type == EventGRunStart && e.Stolen {
			t.Errorf("G7 should not be flagged stolen when prior P is unknown")
		}
	}
}

func TestObservedProcs(t *testing.T) {
	tests := []struct {
		name   string
		events []Event
		want   int
	}{
		{
			name: "normal case, several PIDs",
			events: []Event{
				{PID: 0}, {PID: 2}, {PID: 1}, {PID: 2},
			},
			want: 3,
		},
		{
			name:   "empty slice",
			events: nil,
			want:   0,
		},
		{
			name: "all NoResource",
			events: []Event{
				{PID: NoResource}, {PID: NoResource},
			},
			want: 0,
		},
		{
			name:   "single event with PID 0",
			events: []Event{{PID: 0}},
			want:   1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ObservedProcs(tt.events); got != tt.want {
				t.Errorf("ObservedProcs() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestBuildMeta(t *testing.T) {
	// Deliberately out of time order to check Build sorts.
	events := []Event{
		{T: 10, Type: EventGRunStart, GID: 1, PID: 0},
		{T: 5, Type: EventGCreate, GID: 1, PID: 0},
		{T: 3, Type: EventMetric, GID: NoResource, PID: NoResource, Name: "/gc/heap/goal:bytes", Value: 42},
	}

	tl := Build(events, 8, "demo")

	if tl.Meta.NumProcs != 8 {
		t.Errorf("NumProcs = %d, want 8", tl.Meta.NumProcs)
	}
	if tl.Meta.Scenario != "demo" {
		t.Errorf("Scenario = %q, want %q", tl.Meta.Scenario, "demo")
	}
	if tl.Meta.DurationNs != 10 {
		t.Errorf("DurationNs = %d, want 10", tl.Meta.DurationNs)
	}
	if len(tl.Meta.Goroutines) != 1 || tl.Meta.Goroutines[0] != 1 {
		t.Errorf("Goroutines = %v, want [1]", tl.Meta.Goroutines)
	}
	for i := 1; i < len(tl.Events); i++ {
		if tl.Events[i].T < tl.Events[i-1].T {
			t.Fatalf("events not sorted after Build at index %d", i)
		}
	}
}
