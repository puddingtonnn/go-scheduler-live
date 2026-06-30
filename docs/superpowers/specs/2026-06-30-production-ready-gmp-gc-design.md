# Design spec — Production-ready GMP+GC visualizer (floor796 clarity pass)

Date: 2026-06-30 · Branch: `feat/pixel-art` → integrate to `dev`

## Goal
Take the educational Go-scheduler (G-M-P) + GC pixel-art visualizer to a
**production-ready** state: every control works, the scene is **legible**, the
design reads like a **floor796** cozy isometric world, and — most importantly —
it shows the **REAL** GMP + GC behavior already present in the trace data
(nothing faked, reconstructed parts clearly labeled).

## Ground truth (verified this session)
- Backend (`cmd/workload` → `traceparse` → `timeline`) replays a real
  `runtime/trace` of 3 scenarios and emits a normalized Timeline. Go tests + race
  pass; HTTP API clamps inputs (gomaxprocs∈[1,8], goroutines per-scenario,
  duration∈[100ms,10s]), 404 on unknown scenario, 400 on missing. **Backend is
  solid — no changes required for correctness.**
- Frontend: `npm run build` (tsc+vite) clean, 43 vitest pass, no console errors.
- **GC data is REAL but invisible**: backend emits `GC concurrent mark phase`,
  `stop-the-world (GC sweep termination)`, `stop-the-world (GC mark termination)`
  ranges + heap sawtooth (`/memory/classes/heap/objects:bytes` 2.7→49.6MB) +
  `/gc/heap/goal:bytes`. Frontend string-matching is correct. The problem is
  **temporal**: at 45s-normalized playback GC is ~3% of wall-time and most STW
  pauses are *sub-frame*, so the player steps over them → UI shows "GC: idle"
  almost always. Heap goal marker hard-pinned at 80% while bar already
  normalized to live goal (nonsensical).
- **Work-stealing reconstruction**: local queues & steals are reconstructed
  heuristically (trace doesn't carry them), flagged `Stolen`. In `workstealing`,
  `stolen` is the *normal* state → a per-steal flash + arc-lift makes runners
  levitate near-continuously.

## Defects → fixes (settled; from root-cause analysis)

### A. Scene legibility / floor796 (scene.ts, layout.ts, iso.ts)
- **A1 Overcrowding blobs**: zone packing spacing is 18×15px but sprites are
  48×52px → massive overlap. Fix: render zone (non-running) gophers at reduced
  scale (~0.55) and set packing spacing to the *scaled* footprint; lower visible
  caps to what fits without overlap; rely on existing "+N" overflow pill.
- **A2 Zone floor platters**: draw a labeled iso "floor" panel behind each zone
  (waiting/global/syscall/local) so clusters read as bins even when full and the
  "+N" sits on a visible surface. (Reference `drawScene` floor patches.)
- **A3 Idle-P marker**: empty P-stations should show the floor796 dashed marker
  (idle P available to steal onto), not a bare platform.
- **A4 Runner stays on platform**: remove the steal vertical arc-lift; running
  gopher feet stay planted on the P. (Steal cue handled in B/decision-2.)
- **A5 Local-queue distribution**: distribute pid-less / spawn-clustered
  runnables across P local queues for display (`gid % numProcs`) so per-P queues
  read clearly in all scenarios; only show a local pill when that P has ≥1
  placed runnable. Honest: same reconstruction status as `stolen`, labeled.
- **A6 Cozy props** (sparingly): CPU tower already on stations; add lamp glow /
  warm crate accents per the handoff, low-contrast, to fill dead space.
- **A7 Zone separation**: widen bottom zone rects so waiting + syscall don't fuse.

### C. Controls / narration correctness (controls.ts, player.ts, main.ts, narrate.ts)
- **C1 Step pauses**: `step()` must `pause()` first (else RAF advances past it).
- **C2 Space-bar label sync**: keydown handler must call `controls.sync()`.
- **C3 fetchScenarios failure**: wrap initial load; render visible error in #app
  (not a blank page).
- **C4 Run error overlay**: render fetch/run errors in a dedicated DOM overlay,
  not into the Pixi stage div (can hide behind canvas); friendlier 404 copy.
- **C5 Scenario description shown**: `ScenarioInfo.description` is fetched then
  discarded — surface it (subtitle near the select / scenario card). Core
  "what this teaches" text.
- **C6 narrate STW desync**: caption claims STW for ~8ms trace-window after STW
  ended. Drive STW caption from folded `world.gcActive` / honor `gc_range_end`;
  shrink the look-back window. (Ties into decision-1.)
- **C7 narrate steal desync**: steal caption outlives the visual pulse and can
  over-count; tie to the same pulse the scene uses. (Ties into decision-2.)
- **C8 goroutines clamp**: frontend clamp uses hardcoded [1,200]; use the input's
  per-scenario min/max.

### Production-ready polish (decision-3 sets the bar)
- Responsive (resize already handled; verify small viewports / control-bar wrap).
- a11y: aria-pressed on toggles, label/for on inputs, landmark role on bar.
- Verify every control end-to-end via the screenshot harness.

## Contestable decisions — RESOLVED BY COUNCIL
(Full deliberation in scratchpad `council.md`; 4 seats + chairman.)

1. **GC visibility (honesty vs legibility)** — ship BOTH honest channels:
   - A **to-scale GC strip** (DOM lane) keyed off the real GC ranges: mark bands +
     STW ticks drawn at true wall-time proportion, with a playhead. This is the
     honesty backbone — STW reads as the real sliver it is.
   - A **brief (~120ms) in-world STW cue** (red screen-edge vignette flash) fired
     when a STW range is crossed in the current playback step, with the caption
     stating the **real µs** ("stop-the-world: 84µs"). NEVER a long held freeze —
     the governing principle is *never make a sub-ms STW look long*.
   - Detection of "STW crossed in step" lives in chrome/scene tracking their own
     `prevT` → **`player/*` stays untouched** for GC. (player.ts gets only the
     one-line `step()` pause fix.)
   - Header: **GC cycle counter** + **longest-STW µs** from real range data.
   - Heap bar: drop the fake 80% marker; bar = live/goal (100% = goal, labeled
     "цель"); **color the fill by GC phase every frame**.

2. **Depicting work-stealing truthfully** — cut the lie, keep the defensible signal:
   - **Remove per-goroutine steal flash + the arc-lift levitation** (the heuristic
     marks nearly every goroutine stolen → per-G flashing is a disclaimer on a
     falsehood). Runners stay planted on their P.
   - Ship only the **aggregate destination-P cue** (a brief glow/ring on the P that
     just went idle→active, driven by `stealBurst`) + the existing batch narration
     ("P3 забрал N"), behind a **"реконструкция (не из трейса)"** badge.
   - Per-goroutine "stolen (reconstr.)" detail stays in the on-demand **tooltip**.
   - Per-P **local-queue stacks** (already present) carry the "idle P pulls from a
     queue" idea; no bespoke token-flight animation.

3. **Production-ready scope (MUST / SHOULD / WON'T)** — "done" = correctness +
   legibility checklist, not infinite polish.

### MUST (this slice)
- Heap goal marker fix + heap bar colored by GC phase (derive `heapGoalPct`).
- GC cycle counter + longest-STW µs readout (real range data) in header.
- To-scale GC strip (DOM), playhead-tracked.
- Brief STW vignette cue + real-µs caption; remove long freeze hold.
- Caption↔scene sync: narrate STW/mark from `world.gcActive`; fix windowing.
- Remove runner levitation; runners planted (A4).
- Fix zone packing (scale zone sprites + spacing clears 48×52 footprint + lower
  caps + zone floor platters) (A1, A2).
- Distribute pid-less runnables across P local queues for display (A5); local pill
  only when ≥1 placed.
- Idle-P dashed marker (A3).
- Controls correctness: step pauses (C1), space-bar label sync (C2), goroutines
  clamp per-scenario (C8), fetchScenarios error visible (C3), run-error DOM overlay
  not in Pixi stage (C4).
- Scenario description shown ("what this teaches") (C5).
- Aggregate steal cue + reconstruction badge (replaces per-G flash).

### SHOULD (if time, low risk)
- Compact dismissible intro card per scenario (P/G/caption explainer).
- Scenario-tuned captions (one crisp idea per scene).
- a11y: aria-pressed on toggles, label/for on inputs, landmark role on bar.
- Cozy floor796 props (lamp glow / warm crate) for density, low-contrast.

### WON'T (defer to a future slice)
- Slow-mo "GC inspector" (needs a second clock regime / `player/*` changes).
- Batch-steal token-flight animation (animates an inferred mechanism).
- Mark-assist tinting (extra concept + trace plumbing).

## Asset chunking (floor796 GIF-chunk note)
floor796 chunk-loads because it's a giant pre-rendered animated image. Our
sprites are **procedural** (generated in-browser from the palette, ~7 small state
textures baked once) and Vite already code-splits Pixi + lazy-loads the `?iso`
demo. There is **no heavy asset payload to chunk** → asset-chunking is N/A here;
building it would be gold-plating. (Decision confirmed; documented for honesty.)

## Verification
- `go test ./...` + `TestSchedulerInvariants` green (backend untouched).
- `npm run build` + `npx vitest run` green; new pure logic (gc-hold, layout
  distribution, narrate fix) covered by tests.
- Screenshot harness (`shoot.mjs` + `shoot-all.mjs`): each scenario legible,
  runners on platforms, zones non-overlapping, GC visibly fires on gcpressure,
  captions match the scene.

## Out of scope
- Backend/model changes (frontend slice; backend already correct).
- New scenarios, multiplayer/floor796-editor, real bitmap font atlases.
