// Event log panel: a scrollable, human-readable journal of every timeline
// event (metrics excluded — thousands of heap samples would drown it), synced
// to the playhead. The one-line caption above shows "the most notable thing
// now"; this panel is the full record the caption deliberately is not.
//
// formatLogRow is pure (vitest); EventLog owns the DOM. Rows are built once
// per timeline (a few thousand light divs), then playback only moves the
// past/future split and auto-scrolls — no per-frame rebuilding.

import type { TimelineEvent } from '../model/timeline'
import { PAL } from '../scene/palette'

export type LogCat = 'sched' | 'wait' | 'syscall' | 'gc' | 'proc'

export interface LogRow {
  cat: LogCat
  text: string
}

export const LOG_CATS: ReadonlyArray<readonly [LogCat, string, string]> = [
  ['sched', 'план', PAL.running],
  ['wait', 'ожид', PAL.waiting],
  ['syscall', 'syscall', PAL.syscall],
  ['gc', 'GC', PAL.teal],
  ['proc', 'P', PAL.platEdge],
]

export interface TimedLogRow extends LogRow {
  t: number
}

// fmtDur renders a real duration in the most legible unit.
export function fmtDur(ns: number): string {
  if (ns < 1_000) return `${Math.round(ns)} нс`
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(ns < 10_000 ? 1 : 0)} мкс`
  return `${(ns / 1_000_000).toFixed(2)} мс`
}

export function fmtMs(tNs: number): string {
  return `${(tNs / 1e6).toFixed(2)}`
}

// How a goroutine last became runnable — the provenance of its next run start.
type RunnableVia = 'create' | 'stop' | 'unblock' | 'sysreturn'

interface GCtx {
  state: 'runnable' | 'running' | 'waiting' | 'syscall' | 'dead'
  since: number
  created?: number
  reason?: string
  via?: RunnableVia
  wakerGid?: number
}

// buildLogRows folds the whole event stream once and renders every row WITH
// its causality — all of it derived strictly from trace facts, never from the
// visual reconstructions:
//  - who woke/created a goroutine: the event's mid is the waker's/creator's M,
//    and the fold knows which G was executing on that M (same executor
//    semantics as stateAt, unblocker trap included);
//  - how long it waited / ran / sat in the kernel: time since it entered the
//    previous state;
//  - a p_stop while its M is blocked in a syscall is the sysmon retake.
// Metrics are skipped (thousands of heap samples would drown the journal).
export function buildLogRows(events: TimelineEvent[], midAlias?: Map<number, number>): TimedLogRow[] {
  const m = (mid: number): string => `M${midAlias?.get(mid) ?? mid}`
  const gs = new Map<number, GCtx>()
  const mBusy = new Map<number, number>() // executing mid -> gid
  const gToM = new Map<number, number>() // gid -> its executing/syscall mid
  const pOwner = new Map<number, number>() // pid -> mid
  const sysWithM = new Map<number, number>() // mid blocked in kernel -> its gid

  const bind = (gid: number, mid: number): void => {
    if (mid < 0) return
    mBusy.set(mid, gid)
    gToM.set(gid, mid)
  }
  const unbind = (gid: number): void => {
    const mid = gToM.get(gid)
    if (mid !== undefined) {
      gToM.delete(gid)
      if (mBusy.get(mid) === gid) mBusy.delete(mid)
    }
  }
  // The G executing on the event's M — the actor behind creates/unblocks.
  const actor = (e: TimelineEvent): number | undefined => {
    if (e.mid < 0) return undefined
    const gid = mBusy.get(e.mid)
    return gid !== undefined && gid !== e.gid ? gid : undefined
  }

  const out: TimedLogRow[] = []
  const push = (t: number, cat: LogCat, text: string): void => {
    out.push({ t, cat, text })
  }

  for (const e of events) {
    const ctx = gs.get(e.gid)
    const dur = (): string => (ctx ? fmtDur(e.t - ctx.since) : '')
    switch (e.type) {
      case 'g_create': {
        const by = actor(e)
        push(e.t, 'sched', `G${e.gid} создана${by !== undefined ? ` горутиной G${by}` : ''}`)
        gs.set(e.gid, { state: 'runnable', since: e.t, created: e.t, via: 'create' })
        break
      }
      case 'g_run_start': {
        let why = ''
        if (ctx?.state === 'runnable') {
          const waited = ` — ждала ${dur()}`
          if (ctx.via === 'create') why = `${waited} (первый запуск)`
          else if (ctx.via === 'sysreturn') why = `${waited} (после syscall)`
          else if (ctx.via === 'unblock')
            why = `${waited}${ctx.wakerGid !== undefined ? ` (разбужена G${ctx.wakerGid})` : ''}`
          else why = waited
        }
        push(
          e.t,
          'sched',
          `G${e.gid} встала на P${e.pid}${e.mid >= 0 ? ` · ${m(e.mid)}` : ''}` +
            (e.stolen ? ' · украдена (реконстр.)' : '') +
            why,
        )
        gs.set(e.gid, { ...ctx, state: 'running', since: e.t })
        bind(e.gid, e.mid)
        if (e.mid >= 0 && e.pid >= 0) pOwner.set(e.pid, e.mid)
        break
      }
      case 'g_run_stop': {
        const ran = ctx?.state === 'running' ? ` (бежала ${dur()})` : ''
        push(e.t, 'sched', `G${e.gid} слезла с P${e.pid} — в очередь${ran}`)
        gs.set(e.gid, { ...ctx, state: 'runnable', since: e.t, via: 'stop', wakerGid: undefined })
        unbind(e.gid)
        break
      }
      case 'g_block': {
        const ran = ctx?.state === 'running' ? ` (бежала ${dur()})` : ''
        push(e.t, 'wait', `G${e.gid} заблокирована${e.reason ? `: ${e.reason}` : ''}${ran}`)
        gs.set(e.gid, { ...ctx, state: 'waiting', since: e.t, reason: e.reason })
        unbind(e.gid)
        break
      }
      case 'g_unblock': {
        if (ctx?.state === 'syscall') {
          // Returned from the kernel but the P is gone: runnable, not running.
          push(e.t, 'syscall', `G${e.gid} вернулась из syscall — свободного P нет, в очередь (в ядре ${dur()})`)
          const mid = gToM.get(e.gid)
          if (mid !== undefined) sysWithM.delete(mid)
          gs.set(e.gid, { ...ctx, state: 'runnable', since: e.t, via: 'sysreturn', wakerGid: undefined })
          unbind(e.gid)
          break
        }
        const by = actor(e)
        const waitedFor =
          ctx?.state === 'waiting' ? ` — ждала${ctx.reason ? ` «${ctx.reason}»` : ''} ${dur()}` : ''
        push(
          e.t,
          'wait',
          `G${e.gid} разбужена${by !== undefined ? ` горутиной G${by}` : ''}${waitedFor}`,
        )
        gs.set(e.gid, { ...ctx, state: 'runnable', since: e.t, via: 'unblock', wakerGid: by })
        break
      }
      case 'g_syscall_enter': {
        push(e.t, 'syscall', `G${e.gid} ушла в syscall${e.mid >= 0 ? ` — ${m(e.mid)} блокируется с ней` : ''}`)
        gs.set(e.gid, { ...ctx, state: 'syscall', since: e.t })
        bind(e.gid, e.mid)
        if (e.mid >= 0) sysWithM.set(e.mid, e.gid)
        break
      }
      case 'g_syscall_exit': {
        const inKernel = ctx?.state === 'syscall' ? ` (в ядре ${dur()})` : ''
        push(e.t, 'syscall', `G${e.gid} вернулась из syscall на P${e.pid}${inKernel}`)
        if (e.mid >= 0) sysWithM.delete(e.mid)
        gs.set(e.gid, { ...ctx, state: 'running', since: e.t })
        bind(e.gid, e.mid)
        if (e.mid >= 0 && e.pid >= 0) pOwner.set(e.pid, e.mid)
        break
      }
      case 'g_exit': {
        const lived = ctx?.created !== undefined ? ` (жила ${fmtDur(e.t - ctx.created)})` : ''
        push(e.t, 'sched', `G${e.gid} завершилась${lived}`)
        gs.set(e.gid, { ...ctx, state: 'dead', since: e.t })
        unbind(e.gid)
        break
      }
      case 'p_start':
        push(e.t, 'proc', `P${e.pid} запущен${e.mid >= 0 ? ` · ${m(e.mid)}` : ''}`)
        if (e.mid >= 0) pOwner.set(e.pid, e.mid)
        break
      case 'p_stop': {
        const owner = pOwner.get(e.pid)
        const stuckG = owner !== undefined ? sysWithM.get(owner) : undefined
        push(
          e.t,
          'proc',
          stuckG !== undefined
            ? `P${e.pid} остановлен — его ${m(owner!)} заблокирован в syscall с G${stuckG}, P уходит другому M`
            : `P${e.pid} остановлен`,
        )
        pOwner.delete(e.pid)
        break
      }
      case 'gc_range_begin':
        push(e.t, 'gc', `GC: ${e.name ?? '?'} — начало`)
        break
      case 'gc_range_end':
        push(e.t, 'gc', `GC: ${e.name ?? '?'} — конец`)
        break
      case 'metric':
        break
    }
  }
  return out
}

// EventLog renders and owns the panel. Auto-scroll follows the playhead unless
// the pointer is over the panel (the user is reading — don't yank the scroll).
export class EventLog {
  readonly root: HTMLDivElement
  private readonly list: HTMLDivElement
  private times: number[] = []
  private rows: HTMLDivElement[] = []
  private cursor = 0 // rows[0..cursor) are past, the rest future
  private hovered = false
  private visible = true

  constructor() {
    this.root = document.createElement('div')
    this.root.className = 'event-log'

    const head = document.createElement('div')
    head.className = 'event-log-head'
    const title = document.createElement('span')
    title.className = 'event-log-title'
    title.textContent = 'журнал событий'
    title.title = 'Все события трейса (кроме heap-метрик). Строка сверху показывает только самое заметное; здесь — всё.'
    head.append(title)
    for (const [cat, label, color] of LOG_CATS) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'event-log-chip active'
      chip.textContent = label
      chip.style.setProperty('--chip', color)
      chip.setAttribute('aria-pressed', 'true')
      chip.addEventListener('click', () => {
        const on = this.root.classList.toggle(`hide-${cat}`) === false
        chip.classList.toggle('active', on)
        chip.setAttribute('aria-pressed', String(on))
      })
      head.append(chip)
    }

    this.list = document.createElement('div')
    this.list.className = 'event-log-list'
    this.list.addEventListener('pointerenter', () => (this.hovered = true))
    this.list.addEventListener('pointerleave', () => (this.hovered = false))

    this.root.append(head, this.list)
  }

  build(events: TimelineEvent[], midAlias?: Map<number, number>): void {
    this.list.textContent = ''
    this.times = []
    this.rows = []
    this.cursor = 0
    const frag = document.createDocumentFragment()
    for (const row of buildLogRows(events, midAlias)) {
      const div = document.createElement('div')
      div.className = `event-log-row cat-${row.cat} future`
      const t = document.createElement('span')
      t.className = 'event-log-t'
      t.textContent = fmtMs(row.t)
      div.append(t, document.createTextNode(row.text))
      frag.append(div)
      this.times.push(row.t)
      this.rows.push(div)
    }
    this.list.append(frag)
  }

  // setT moves the past/future split to the playhead and keeps the newest past
  // row in view. O(rows crossed since the last call), not O(total).
  setT(tNs: number): void {
    let c = this.cursor
    while (c < this.times.length && this.times[c] <= tNs) c++
    while (c > 0 && this.times[c - 1] > tNs) c--
    if (c === this.cursor) return
    const lo = Math.min(c, this.cursor)
    const hi = Math.max(c, this.cursor)
    for (let i = lo; i < hi; i++) this.rows[i].classList.toggle('future', i >= c)
    this.cursor = c
    if (this.visible && !this.hovered && c > 0) {
      this.rows[c - 1].scrollIntoView({ block: 'nearest' })
    }
  }

  toggle(): boolean {
    this.visible = !this.visible
    this.root.style.display = this.visible ? '' : 'none'
    return this.visible
  }
}
