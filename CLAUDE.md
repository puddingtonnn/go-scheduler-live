# go-scheduler-live

An educational visualization of the real Go scheduler (G–M–P) and the garbage
collector. A Go backend runs curated workloads under `runtime/trace`, parses the
trace into a normalized `Timeline`, and a Vite + TypeScript + PixiJS frontend
replays it on a virtual clock.

**The real Go runtime is the source of truth.** If the trace does not record
something, do not draw it as if it did. Anything reconstructed, stylized or
omitted is marked as such and listed in the in-app Assumptions panel. A change
that makes the world prettier by making it less true is the one thing this
project will not accept.

## Read these first

- [`docs/architecture.md`](docs/architecture.md) — the pipeline, package
  boundaries, `mid` binding rules, what is real versus reconstructed, and the
  traps that shaped the design.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — conventions, the three contribution
  surfaces (a scenario, a language, a fidelity report), and the checks.

## Running it

```bash
go run ./cmd/server                     # listens on :8080
cd web && npm install && npm run dev    # proxies /api to :8080
```

If :8080 is already taken, move the backend and point the proxy at it:

```bash
go run ./cmd/server -addr :8085
GMP_API_TARGET=http://localhost:8085 npm run dev
```

## Checks

```bash
go vet ./... && go test ./...
golangci-lint run ./...            # the tree is clean; keep it clean
cd web && npx tsc --noEmit && npx vitest run
node scripts/verify-controls.mjs   # 33/33, needs both servers running
```

CI runs all of it on every pull request.

## Repo-specific gotchas

- In `web/src/ui/chrome.ts` the i18n helper is imported as `tr`, because
  `update()` already has a local `const t`.
- `internal/traceparse/testdata/workstealing.trace` is a binary recording of a
  real run and still contains the old module name. It is data, not source — do
  not edit it.
- All pixel art is drawn procedurally in `web/src/scene/`; there are no external
  asset files to look for.
- User-facing strings never appear inline — they go through `t()` in
  `web/src/i18n.ts`, where the compiler enforces RU/EN parity via `typeof RU`.
