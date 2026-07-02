// Control-verification harness: exercises every button/affordance and asserts the
// resulting player/timeline state, so "all buttons work" has concrete evidence.
import { chromium } from 'playwright'

const url = process.env.SHOOT_URL ?? 'http://localhost:5173'
const outDir = process.env.SHOOT_OUT ?? '/tmp'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const results = []
const ok = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); }

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => globalThis.gmp?.player?.duration > 0, { timeout: 20000 })

const playBtn = page.locator('.controls button').first() // play/pause toggle (label flips)
const stepBtn = page.locator('.controls button', { hasText: 'Шаг' }).first()
const btn = (label) => page.locator('.controls button', { hasText: label }).first()
const state = () => page.evaluate(() => {
  const p = globalThis.gmp.player
  return { playing: p.playing, speed: p.speed, t: p.t, duration: p.duration, scenario: globalThis.gmp.timeline?.meta?.scenario, numProcs: globalThis.gmp.timeline?.meta?.numProcs }
})
const ensurePaused = async () => { if ((await state()).playing) { await playBtn.click(); await page.waitForTimeout(120) } }

// dismiss intro card if present
await page.locator('.intro button', { hasText: 'Понятно' }).click().catch(() => {})

// 1. Pause then Play (the app auto-plays on load)
await ensurePaused()
ok('pause stops the clock', (await state()).playing === false)
await playBtn.click()
await page.waitForTimeout(300)
ok('play starts the clock', (await state()).playing === true)
ok('play button label flips to Пауза', (await playBtn.textContent()).includes('Пауза'))

// 2. Pause
await playBtn.click()
await page.waitForTimeout(150)
let s = await state()
ok('pause stops the clock again', s.playing === false)
ok('play button label flips to Играть', (await playBtn.textContent()).includes('Играть'))

// 3. Step while paused advances and stays paused
const before = (await state()).t
await stepBtn.click()
await page.waitForTimeout(120)
s = await state()
ok('step advances time', s.t > before, `t ${before}->${s.t}`)
ok('step stays paused', s.playing === false)

// 4. Step while PLAYING pauses (regression for the step-no-op bug)
await playBtn.click()
await page.waitForTimeout(150)
await stepBtn.click()
await page.waitForTimeout(150)
ok('step while playing pauses', (await state()).playing === false)

// 5. Speed chips
await btn('2×').click()
ok('speed 2x applies', (await state()).speed === 2)
await btn('0.5×').click()
ok('speed 0.5x applies', (await state()).speed === 0.5)

// 6. Scrub jumps and pauses
await page.evaluate(() => {
  const sc = document.querySelector('.controls input[type=range]')
  sc.value = '600'
  sc.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(150)
s = await state()
ok('scrub seeks (~60%)', Math.abs(s.t / s.duration - 0.6) < 0.02, `${(s.t / s.duration).toFixed(3)}`)
ok('scrub pauses', s.playing === false)

// 7. id toggle
const idBtn = page.locator('.controls button', { hasText: /^id$/ }).first()
const wasActive = await idBtn.evaluate((e) => e.classList.contains('active'))
await idBtn.click()
ok('id toggle flips state', (await idBtn.evaluate((e) => e.classList.contains('active'))) !== wasActive)

// 7b. M (OS thread) toggle
const mBtn = page.locator('.controls button', { hasText: /^M$/ }).first()
const mWasActive = await mBtn.evaluate((e) => e.classList.contains('active'))
await mBtn.click()
ok('M toggle flips state', (await mBtn.evaluate((e) => e.classList.contains('active'))) !== mWasActive)
await mBtn.click() // back on: carriers visible for the screenshots below

// 8. Scenario change + run → gcpressure (real GC)
await page.evaluate(() => {
  const sel = document.querySelector('.controls select'); sel.value = 'gcpressure'; sel.dispatchEvent(new Event('change'))
})
await page.locator('.controls button', { hasText: 'Запустить' }).click()
await page.waitForTimeout(2800)
await page.waitForFunction(() => globalThis.gmp.timeline?.meta?.scenario === 'gcpressure', { timeout: 15000 }).catch(() => {})
ok('run loads selected scenario', (await state()).scenario === 'gcpressure')
const gcReadout = await page.locator('.gc-readout').textContent()
ok('GC readout shows real cycles', /цикл/.test(gcReadout), gcReadout)
const stripTicks = await page.locator('.gc-band.stw').count()
ok('GC strip has real STW ticks', stripTicks > 0, `${stripTicks} ticks`)

// 9. GOMAXPROCS change + run
await page.evaluate(() => {
  const inp = document.querySelectorAll('.controls input[type=number]')[0]; inp.value = '2'; inp.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.locator('.controls button', { hasText: 'Запустить' }).click()
await page.waitForTimeout(2500)
await page.waitForFunction(() => globalThis.gmp.timeline?.meta?.numProcs === 2, { timeout: 15000 }).catch(() => {})
ok('GOMAXPROCS change applies', (await state()).numProcs === 2)

// 10. Capture a real STW moment: seek to a STW tick time
const stwShot = await page.evaluate(() => {
  const ev = globalThis.gmp.timeline.events
  const stw = ev.find((e) => e.type === 'gc_range_begin' && /stop-the-world/.test(e.name || '') && !/start trace/.test(e.name || ''))
  if (!stw) return null
  const p = globalThis.gmp.player
  p.pause(); p.seek(Math.max(0, stw.t - p.duration * 0.0005))
  return stw.t
})
await page.waitForTimeout(120)
await page.screenshot({ path: `${outDir}/verify-stw.png` })
ok('found a STW range to seek to', stwShot !== null)

console.log('\n=== CONTROL VERIFICATION ===')
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`)
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
console.log('console errors:', errors.length ? errors : 'none')
await browser.close()
process.exit(failed.length ? 1 : 0)
