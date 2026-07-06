import { describe, it, expect, afterEach } from 'vitest'
import { setLang, getLang, t, scenarioTitle, scenarioDesc } from './i18n'
import { buildLogRows, fmtDur } from './ui/eventlog'
import { narrate } from './player/narrate'
import type { TimelineEvent, ScenarioInfo } from './model/timeline'

const ev = (extra: Partial<TimelineEvent> & { type: TimelineEvent['type']; t: number }): TimelineEvent =>
  ({ gid: -1, pid: -1, mid: -1, ...extra }) as TimelineEvent

afterEach(() => setLang('ru'))

describe('i18n', () => {
  it('defaults to Russian outside the browser', () => {
    expect(getLang()).toBe('ru')
    expect(t().controls.run).toBe('Запустить')
  })

  it('switches the event log to English', () => {
    setLang('en')
    const rows = buildLogRows([
      ev({ t: 0, type: 'g_run_start', gid: 1, pid: 0, mid: 7 }),
      ev({ t: 1_000, type: 'g_block', gid: 5, pid: 1, mid: 3, reason: 'chan receive' }),
      ev({ t: 3_000, type: 'g_unblock', gid: 5, pid: 0, mid: 7 }),
    ])
    expect(rows[2].text).toBe('G5 woken by goroutine G1 — waited “chan receive” 2.0 µs')
  })

  it('switches the caption and duration units to English', () => {
    setLang('en')
    expect(fmtDur(1_510_000)).toBe('1.51 ms')
    const cap = narrate([ev({ t: 5, type: 'g_block', gid: 3, reason: 'select' })], 10, [])
    expect(cap).toBe('G3 blocked: select')
  })

  it('translates every scenario the backend ships', () => {
    setLang('en')
    const ids = ['workstealing', 'pingpong', 'gcpressure', 'syscalls', 'mutex', 'leak']
    for (const id of ids) {
      const info = { id, title: 'ру', description: 'ру', params: [] } as unknown as ScenarioInfo
      expect(scenarioTitle(info), id).not.toBe('ру')
      expect(scenarioDesc(info), id).not.toBe('ру')
    }
    // unknown scenarios fall back to the backend strings instead of vanishing
    const unknown = { id: 'new-one', title: 'заголовок', description: 'описание', params: [] } as unknown as ScenarioInfo
    expect(scenarioTitle(unknown)).toBe('заголовок')
  })
})
