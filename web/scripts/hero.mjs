// Hero-screenshot harness for the README: dismisses the intro card so
// the world is unobstructed, optionally switches the UI to English, seeks to a
// busy moment, and writes a PNG.
//
//   HERO_LANG=en HERO_OUT=../docs/screenshot.png node scripts/hero.mjs
import { chromium } from 'playwright'

const url = process.env.HERO_URL ?? 'http://localhost:5177'
const out = process.env.HERO_OUT ?? '/tmp/hero.png'
const lang = process.env.HERO_LANG ?? 'ru'
const frac = Number(process.env.HERO_FRAC ?? 0.45)

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2, // retina-crisp PNG for the README
})

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

const ready = () =>
  page.waitForFunction(
    () => {
      const g = /** @type {any} */ (globalThis).gmp
      return Boolean(g && g.player && g.player.duration > 0)
    },
    { timeout: 30000 },
  )

await page.goto(url, { waitUntil: 'networkidle' })
await ready()

if (lang === 'en') {
  // strings bake at boot, so the switch reloads the page
  await page.locator('.lang-btn').click()
  await page.waitForLoadState('networkidle')
  await ready()
}

// the intro card overlays the scene; it is per-scenario and dismissible
await page
  .locator('.intro button')
  .first()
  .click({ timeout: 5000 })
  .catch(() => {})
await page.waitForTimeout(300)

await page.evaluate((f) => {
  const p = /** @type {any} */ (globalThis).gmp.player
  p.pause()
  p.seek(p.duration * f)
}, frac)
await page.waitForTimeout(1200) // let sprites settle and the log fill

await page.screenshot({ path: out })
console.log('wrote', out, '| lang:', lang, '| console errors:', errors.length ? errors : 'none')
await browser.close()
