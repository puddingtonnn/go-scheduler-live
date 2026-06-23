// Package timeline is the domain model the frontend consumes: a virtual-clock
// ordered list of normalized scheduler/GC events plus run metadata. It is the
// JSON contract between the backend and the (future) PixiJS player, and it knows
// nothing about how traces are produced or parsed.
package timeline

// EventType enumerates the normalized animation events.
type EventType string

const (
	EventGCreate       EventType = "g_create"
	EventGRunStart     EventType = "g_run_start"
	EventGRunStop      EventType = "g_run_stop"
	EventGBlock        EventType = "g_block"
	EventGUnblock      EventType = "g_unblock"
	EventGSyscallEnter EventType = "g_syscall_enter"
	EventGSyscallExit  EventType = "g_syscall_exit"
	EventGExit         EventType = "g_exit"
	EventPStart        EventType = "p_start"
	EventPStop         EventType = "p_stop"
	EventGCRangeBegin  EventType = "gc_range_begin"
	EventGCRangeEnd    EventType = "gc_range_end"
	EventMetric        EventType = "metric"
)

// NoResource marks Event.GID / Event.PID when the field does not apply. We use
// -1 (not omitempty) because goroutine 0 and proc 0 are both valid IDs and
// would be wrongly dropped by omitempty.
const NoResource int64 = -1

// Event is one normalized point on the timeline.
type Event struct {
	T      int64     `json:"t"`    // ns since the first trace event
	Type   EventType `json:"type"` //
	GID    int64     `json:"gid"`  // goroutine id, or NoResource
	PID    int64     `json:"pid"`  // proc id, or NoResource
	Reason string    `json:"reason,omitempty"`
	Name   string    `json:"name,omitempty"`  // range / metric name
	Value  uint64    `json:"value,omitempty"` // metric value
	Stolen bool      `json:"stolen,omitempty"`
}

// Meta describes the run as a whole.
type Meta struct {
	Scenario   string  `json:"scenario"`
	NumProcs   int     `json:"numProcs"`
	DurationNs int64   `json:"durationNs"`
	Goroutines []int64 `json:"goroutines"`
}

// Timeline is the full payload sent to the frontend.
type Timeline struct {
	Meta   Meta    `json:"meta"`
	Events []Event `json:"events"`
}
