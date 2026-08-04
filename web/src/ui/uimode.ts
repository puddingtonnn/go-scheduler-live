// UI mode module: tracks Learn vs Full mode and present flag.
// Persists the mode to localStorage, provides pub/sub for state changes.

export type UiMode = 'learn' | 'full'
export interface UiState {
  mode: UiMode
  present: boolean
}

const KEY = 'gmp.uimode'

let state: UiState = (() => {
  const defaultState: UiState = { mode: 'learn', present: false }
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'full' || stored === 'learn') {
      return { mode: stored, present: false }
    }
    return defaultState
  } catch {
    // non-browser environment (vitest) or blocked storage
    return defaultState
  }
})()

const subscribers: Array<(s: UiState) => void> = []

export function getState(): UiState {
  return { ...state }
}

export function setMode(m: UiMode): void {
  state = { ...state, mode: m }
  try {
    localStorage.setItem(KEY, m)
  } catch {
    // headless/test environment — in-memory value is enough
  }
  notifySubscribers()
}

export function setPresent(on: boolean): void {
  state = { ...state, present: on }
  notifySubscribers()
}

export function subscribe(fn: (s: UiState) => void): () => void {
  subscribers.push(fn)
  // Return unsubscribe function
  return () => {
    const idx = subscribers.indexOf(fn)
    if (idx !== -1) {
      subscribers.splice(idx, 1)
    }
  }
}

function notifySubscribers(): void {
  const snapshot = { ...state }
  // Iterate a shallow copy: a subscriber may (un)subscribe during notification,
  // which would otherwise mutate the live array mid-iteration.
  for (const fn of [...subscribers]) {
    fn(snapshot)
  }
}
