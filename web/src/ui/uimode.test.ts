import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('uimode', () => {
  // Mock localStorage
  let store: Record<string, string> = {}
  let getState: typeof import('./uimode').getState
  let setMode: typeof import('./uimode').setMode
  let setPresent: typeof import('./uimode').setPresent
  let subscribe: typeof import('./uimode').subscribe

  beforeEach(async () => {
    vi.resetModules()
    store = {}
    // Replace global localStorage with our mock
    const localStorageMock = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value
      },
      removeItem: (key: string) => {
        delete store[key]
      },
      clear: () => {
        store = {}
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      length: Object.keys(store).length,
    }
    globalThis.localStorage = localStorageMock as any

    // Re-import the module fresh for each test
    const uimode = await import('./uimode')
    getState = uimode.getState
    setMode = uimode.setMode
    setPresent = uimode.setPresent
    subscribe = uimode.subscribe
  })

  afterEach(() => {
    store = {}
  })

  describe('default state', () => {
    it('is { mode: "learn", present: false } when localStorage is empty', () => {
      const state = getState()
      expect(state).toEqual({ mode: 'learn', present: false })
    })
  })

  describe('setMode', () => {
    it('updates getState() with the new mode', () => {
      setMode('full')
      const state = getState()
      expect(state.mode).toBe('full')
    })

    it('persists the new mode to localStorage under key "gmp.uimode"', () => {
      setMode('full')
      expect(store['gmp.uimode']).toBe('full')
      setMode('learn')
      expect(store['gmp.uimode']).toBe('learn')
    })
  })

  describe('fresh load', () => {
    it('respects a previously persisted mode', async () => {
      // Set up localStorage with a persisted mode BEFORE importing the module
      let freshStore: Record<string, string> = { 'gmp.uimode': 'full' }

      // Create mock that reads from freshStore
      const freshStorageMock = {
        getItem: (key: string) => freshStore[key] ?? null,
        setItem: (key: string, value: string) => {
          freshStore[key] = value
        },
        removeItem: (key: string) => {
          delete freshStore[key]
        },
        clear: () => {
          freshStore = {}
        },
        key: (index: number) => Object.keys(freshStore)[index] ?? null,
        length: Object.keys(freshStore).length,
      }
      globalThis.localStorage = freshStorageMock as any

      // NOW reset modules and import fresh — the IIFE will run against the pre-populated store
      vi.resetModules()
      const uimode = await import('./uimode')

      // The module should have initialized with mode: 'full' from localStorage
      const initialState = uimode.getState()
      expect(initialState.mode).toBe('full')
      expect(initialState.present).toBe(false)
    })
  })

  describe('subscribe', () => {
    it('notifies subscriber when setMode is called', () => {
      const fn = vi.fn()
      subscribe(fn)

      setMode('full')

      expect(fn).toHaveBeenCalledWith({ mode: 'full', present: false })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('notifies subscriber when setPresent is called', () => {
      const fn = vi.fn()
      subscribe(fn)

      setPresent(true)

      expect(fn).toHaveBeenCalledWith({ mode: 'learn', present: true })
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('notifies all subscribers on state changes', () => {
      const fn1 = vi.fn()
      const fn2 = vi.fn()
      subscribe(fn1)
      subscribe(fn2)

      setMode('full')

      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(1)
      expect(fn1).toHaveBeenCalledWith({ mode: 'full', present: false })
      expect(fn2).toHaveBeenCalledWith({ mode: 'full', present: false })
    })

    it('returns an unsubscribe function that stops notifications', () => {
      const fn = vi.fn()
      const unsubscribe = subscribe(fn)

      setMode('full')
      expect(fn).toHaveBeenCalledTimes(1)

      unsubscribe()

      setMode('learn')
      expect(fn).toHaveBeenCalledTimes(1) // still 1, not called again
    })

    it('unsubscribe works for multiple subscribers', () => {
      const fn1 = vi.fn()
      const fn2 = vi.fn()
      const unsub1 = subscribe(fn1)
      subscribe(fn2)

      setMode('full')
      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(1)

      unsub1()

      setPresent(true)
      expect(fn1).toHaveBeenCalledTimes(1) // not called again
      expect(fn2).toHaveBeenCalledTimes(2) // called again
    })
  })

  describe('present flag', () => {
    it('is independent from mode', () => {
      setMode('full')
      const state1 = getState()
      expect(state1).toEqual({ mode: 'full', present: false })

      setPresent(true)
      const state2 = getState()
      expect(state2).toEqual({ mode: 'full', present: true })

      setMode('learn')
      const state3 = getState()
      expect(state3).toEqual({ mode: 'learn', present: true })
    })

    it('is not persisted to localStorage', () => {
      setPresent(true)
      expect(store['gmp.uimode']).toBeUndefined()
    })
  })

  describe('localStorage error handling', () => {
    it('defaults to learn mode if localStorage throws on read', async () => {
      // Set up a throwing localStorage BEFORE importing the module
      // so the IIFE initialization catches the error
      const throwingMock = {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      }
      globalThis.localStorage = throwingMock as any

      // Reset modules and import fresh — the IIFE catches the throw and defaults to 'learn'
      vi.resetModules()
      const uimode = await import('./uimode')

      // The module should have defaulted to 'learn' despite the throw
      const initialState = uimode.getState()
      expect(initialState.mode).toBe('learn')
      expect(initialState.present).toBe(false)
    })

    it('handles localStorage throws on setItem gracefully', () => {
      // setMode should not throw even if setItem fails
      const failingMock = {
        getItem: () => null,
        setItem: () => {
          throw new Error('blocked')
        },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      }
      globalThis.localStorage = failingMock as any
      expect(() => setMode('full')).not.toThrow()
      const afterSetMode = getState()
      expect(afterSetMode.mode).toBe('full') // in-memory state updated
    })
  })
})
