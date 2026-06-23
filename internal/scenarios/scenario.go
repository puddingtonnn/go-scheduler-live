// Package scenarios defines runnable concurrency workloads. Each scenario
// exercises the Go scheduler in a particular way; we run it under the execution
// tracer and turn the resulting trace into an animation of goroutines.
package scenarios

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"
)

// ErrNotFound is returned by Get when no scenario is registered under a name.
var ErrNotFound = errors.New("scenario not found")

// Params holds the runtime-tunable inputs to a scenario.
//
// GOMAXPROCS is deliberately not here: it is a property of the runtime, set
// before (or at) program startup — not something a scenario's Run can
// meaningfully change mid-flight. The workload command sets it.
type Params struct {
	Goroutines int
	Duration   time.Duration
}

// ParamSpec describes one tunable parameter, for the UI and for validation.
type ParamSpec struct {
	Name    string `json:"name"`
	Min     int    `json:"min"`
	Max     int    `json:"max"`
	Default int    `json:"default"`
}

// ScenarioInfo is the user-facing description of a scenario.
type ScenarioInfo struct {
	ID          string      `json:"id"`
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Params      []ParamSpec `json:"params"`
}

// Scenario is a named concurrency workload that can be run under tracing.
type Scenario interface {
	// Name returns the stable identifier used to select the scenario.
	Name() string
	// Describe returns user-facing metadata and tunable parameters.
	Describe() ScenarioInfo
	// Run executes the workload until it finishes or ctx is cancelled.
	Run(ctx context.Context, p Params) error
}

var registry = map[string]Scenario{}

// Register adds s to the global registry. It panics on a duplicate name because
// that is a programming error, surfaced at process startup via init().
func Register(s Scenario) {
	name := s.Name()
	if _, ok := registry[name]; ok {
		panic(fmt.Sprintf("scenarios: duplicate registration %q", name))
	}
	registry[name] = s
}

// Get returns the scenario registered under name, or ErrNotFound.
func Get(name string) (Scenario, error) {
	s, ok := registry[name]
	if !ok {
		return nil, fmt.Errorf("%q: %w", name, ErrNotFound)
	}
	return s, nil
}

// All returns every registered scenario's info, sorted by ID for stable output.
func All() []ScenarioInfo {
	infos := make([]ScenarioInfo, 0, len(registry))
	for _, s := range registry {
		infos = append(infos, s.Describe())
	}
	sort.Slice(infos, func(i, j int) bool { return infos[i].ID < infos[j].ID })
	return infos
}
