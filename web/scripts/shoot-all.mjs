// Multi-scenario screenshot harness: for each scenario, run it and capture a
// couple of timeline points. Drives the real DOM controls via window.gmp.
import { chromium } from 'playwright'

const url = process.env.SHOOT_URL ?? 'http://localhost:5173'
const outDir = process.env.SHOOT_OUT ?? '/tmp'
const scenarios = (process.env.SHOOT_SCEN ?? 'pingpong,gcpressure').split(',')
const fractions = (process.env.SHOOT_FRAC ?? '0.3,0.7').split(',').map(Number)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => {
  const g = globalThis.gmp
  return Boolean(g && g.player && g.player.duration > 0)
}, { timeout: 20000 })

for (const scen of scenarios) {
  // pick scenario in the select and click Запустить
  await page.evaluate((s) => {
    const sel = document.querySelector('.controls select')
    sel.value = s
    sel.dispatchEvent(new Event('change'))
    const btns = [...document.querySelectorAll('.controls button')]
    const run = btns.find((b) => b.textContent.includes('Запустить'))
    run.click()
  }, scen)
  // wait for the new run to load
  await page.waitForTimeout(2500)
  await page.waitForFunction(() => globalThis.gmp.player && globalThis.gmp.player.duration > 0, { timeout: 20000 })
  for (const f of fractions) {
    await page.evaluate((frac) => {
      const p = globalThis.gmp.player
      p.pause(); p.seek(p.duration * frac)
    }, f)
    await page.waitForTimeout(600)
    const path = `${outDir}/scen-${scen}-${Math.round(f * 100)}.png`
    await page.screenshot({ path })
    console.log('wrote', path)
  }
}
console.log('console errors:', errors.length ? errors : 'none')
await browser.close()
