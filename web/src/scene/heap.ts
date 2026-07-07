// Pure geometry for the GC "heap pile" — a stack of iso tiles whose size tracks the
// real heap fill (heapLive/heapGoal). Kept pure so it is unit-tested; the scene
// draws the tiles from these numbers. Mirrors the mockup's heap sizing.

// heapTileCount maps a heap fill fraction [0,1] to a tile count: 2 when nearly
// empty, 9 at (or over) the goal. Clamped so the pile always reads as a pile.
export function heapTileCount(pct: number): number {
  const p = Math.max(0, Math.min(1, pct))
  return Math.max(2, Math.min(9, Math.round(2 + p * 7)))
}

// heapTileOrder returns iso grid cells (gx, gy) in the order tiles are ADDED as the
// heap grows, so growing/shrinking adds/removes from the same end. The scene depth-
// sorts the drawn subset by (gx+gy) itself.
export function heapTileOrder(): ReadonlyArray<readonly [number, number]> {
  return [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 0],
    [0, 2],
    [2, 1],
    [1, 2],
    [2, 2],
  ]
}
