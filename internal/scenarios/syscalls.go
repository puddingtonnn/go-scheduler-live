//go:build unix

package scenarios

import (
	"context"
	"runtime"
	"sync"
	"syscall"
	"time"
)

// Pacing constants. All pacing is CPU work (busyFor), never time.Sleep — a
// sleeping goroutine parks as Waiting and empties the P platforms (see spin.go).
const (
	// scReadBusy is how long a reader works (Running, visible on a P) after
	// each successful read before blocking in the next syscall.
	scReadBusy = 400 * time.Microsecond
	// scFeedGap is the feeder's CPU-work gap between writes. With n readers,
	// each reader blocks ~n*scFeedGap per cycle — far above sysmon's ~20µs
	// retake threshold, so the P is reliably handed to another M.
	scFeedGap = 1200 * time.Microsecond
	// scSpinSlice is one CPU slice of a background spinner.
	scSpinSlice = 2 * time.Millisecond
)

func init() {
	Register(sysCalls{})
}

// sysCalls blocks goroutines in real read(2) syscalls on pipes. The raw
// syscall package is essential: os.Pipe/os.File readers go through the
// netpoller, which parks the goroutine as Waiting WITHOUT blocking its OS
// thread — no M story to show. syscall.Read on a blocking fd truly blocks the
// M inside the kernel, so sysmon takes the P away and gives it to another M:
// the classic G·M·P handoff this scenario exists to demonstrate. Background
// spinners keep every P busy (npidle == 0), which is what makes sysmon retake
// the P instead of letting it idle.
type sysCalls struct{}

func (sysCalls) Name() string { return "syscalls" }

func (sysCalls) Describe() ScenarioInfo {
	return ScenarioInfo{
		ID:          "syscalls",
		Title:       "Блокирующие сисколлы (смена M)",
		Description: "Горутины блокируются в настоящих syscall-read из pipe: M блокируется вместе с горутиной, sysmon забирает P и отдаёт его другому M.",
		Order:       2,
		Params: []ParamSpec{
			{Name: "goroutines", Min: 2, Max: 24, Default: 8},
		},
	}
}

// scSink keeps the workers' CPU work observable. Written only after the
// goroutines join (in Run), so no race.
var scSink uint64 //nolint:unused // deliberate write-only sink; see the comment above

func (sysCalls) Run(ctx context.Context, p Params) error {
	n := max(p.Goroutines, 2)

	readFDs := make([]int, n)
	writeFDs := make([]int, n)
	for i := range n {
		var fds [2]int
		if err := syscall.Pipe(fds[:]); err != nil {
			for j := range i {
				_ = syscall.Close(readFDs[j])
				_ = syscall.Close(writeFDs[j])
			}
			return err
		}
		readFDs[i], writeFDs[i] = fds[0], fds[1]
	}

	spinners := max(runtime.GOMAXPROCS(0), 1)
	results := make([]uint64, n+spinners+1)
	var wg sync.WaitGroup

	// Readers: block in read(2) — the M blocks with the G — then do a visible
	// slice of CPU work and block again. They exit on EOF, which the feeder
	// delivers by closing the write ends; a goroutine stuck in a raw syscall
	// cannot observe ctx directly.
	for i := range n {
		wg.Go(func() {
			var acc uint64
			defer func() { results[i] = acc }()
			var buf [1]byte
			for {
				m, err := syscall.Read(readFDs[i], buf[:])
				if err == syscall.EINTR {
					continue
				}
				if err != nil || m == 0 { // error or EOF: feeder closed the pipe
					return
				}
				acc += busyFor(scReadBusy)
			}
		})
	}

	// Spinners: pure CPU load on every P, so no P is idle and sysmon must
	// hand a blocked reader's P to another M instead of parking it.
	for i := range spinners {
		wg.Go(func() {
			var acc uint64
			defer func() { results[n+i] = acc }()
			for ctx.Err() == nil {
				acc += busyFor(scSpinSlice)
			}
		})
	}

	// Feeder: wakes readers round-robin, one byte at a time. Closing the write
	// ends on the way out is the readers' only shutdown signal, hence defer.
	wg.Go(func() {
		defer func() {
			for _, fd := range writeFDs {
				_ = syscall.Close(fd)
			}
		}()
		var acc uint64
		defer func() { results[n+spinners] = acc }()
		one := [1]byte{1}
		for i := 0; ctx.Err() == nil; i = (i + 1) % n {
			acc += busyFor(scFeedGap)
			for {
				_, err := syscall.Write(writeFDs[i], one[:])
				if err == syscall.EINTR {
					continue
				}
				if err != nil {
					return // broken pipe etc. — defer closes everything, readers get EOF
				}
				break
			}
		}
	})

	wg.Wait()
	// Only now is it safe to close the read ends: no goroutine reads them
	// anymore (closing an fd another thread is blocked on is undefined).
	for _, fd := range readFDs {
		_ = syscall.Close(fd)
	}
	for _, v := range results {
		scSink += v
	}
	return nil
}
