// Palette + helpers ported verbatim from the design handoff reference
// (design_handoff_go_scheduler/"Go Scheduler Pixel Style.dc.html", get PAL()).
// Fixed ~28-color dark-theme set; one shared palette across all sprites/tiles.

export const PAL = {
  bg0: '#0b0c13',
  bg1: '#11131d',
  bg2: '#181b29',
  panel: '#13151f',
  line: '#262a40',
  line2: '#2f344e',
  grid: '#1c2032',
  floorT: '#333a57',
  floorL: '#242a42',
  floorR: '#2b3150',
  floorTw: '#4a4334',
  floorLw: '#322d22',
  floorRw: '#3c3528',
  platT: '#3b4368',
  platL: '#272d49',
  platR: '#313858',
  platEdge: '#535d8a',
  cpu: '#1b2030',
  cpuHi: '#2a3147',
  lampW: '#f0b44b',
  screen: '#7ef0c0',
  cream: '#f3e2c3',
  creamD: '#cdb487',
  out: '#16131f',
  eye: '#ffffff',
  tooth: '#fbf6e6',
  nose: '#16131f',
  running: '#62d27a',
  runningD: '#2c8f4d',
  runnable: '#f2b53d',
  runnableD: '#bd7e1d',
  waiting: '#56a7ef',
  waitingD: '#2d6cbd',
  syscall: '#b07ef2',
  syscallD: '#7a47c6',
  steal: '#ff5e5e',
  stealD: '#c43838',
  dead: '#565b73',
  deadD: '#393d52',
  froT: '#dbe4f4',
  froD: '#94a6c6',
  teal: '#34c9bf',
  tealD: '#1f8e88',
  gcIdle: '#6b7089',
  gcStw: '#ff5e5e',
  txHi: '#e7eafb',
  txMid: '#9aa0c2',
  txDim: '#5d6385',
  txGreen: '#62d27a',
} as const

export type SpriteState = 'running' | 'runnable' | 'waiting' | 'syscall' | 'steal' | 'dead'

export function stateColors(s: SpriteState): [string, string] {
  const p = PAL
  const m: Record<SpriteState, [string, string]> = {
    running: [p.running, p.runningD],
    runnable: [p.runnable, p.runnableD],
    waiting: [p.waiting, p.waitingD],
    syscall: [p.syscall, p.syscallD],
    steal: [p.steal, p.stealD],
    dead: [p.dead, p.deadD],
  }
  return m[s] ?? m.running
}

// shade lightens/darkens a #rrggbb hex by a flat per-channel amount.
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16)
  const clamp = (v: number) => Math.max(0, Math.min(255, v))
  const r = clamp((n >> 16) + amt)
  const g = clamp(((n >> 8) & 255) + amt)
  const b = clamp((n & 255) + amt)
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')
}
