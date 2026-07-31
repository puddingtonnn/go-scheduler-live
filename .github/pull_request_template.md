<!--
Keep a pull request to one idea. Delete whatever does not apply — this is a
checklist, not a form to fill in for its own sake.
-->

## What and why

<!-- What changed, and what problem it solves. The why matters more than the what. -->

## How you know it works

<!--
Which checks you ran, and anything you verified by hand. If you touched the
world, a screenshot says more than a paragraph.

  go vet ./... && go test ./...
  golangci-lint run ./...
  cd web && npx tsc --noEmit && npx vitest run
  node scripts/verify-controls.mjs     # needs both servers running
-->

## Fidelity

<!--
Only if this changes what the world shows.

Does anything here present a reconstruction as a fact? If the change draws
something the trace does not record, it belongs in the Assumptions panel too —
that is the project's one hard rule.
-->
