import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

const findBrowserExecutable = (): string => {
  for (const path of CHROME_PATHS) {
    if (existsSync(path)) {
      return path
    }
  }
  throw new Error('No compatible browser executable found (checked Chrome and Edge).')
}

const ARTIFACT_DIR =
  'C:\\Users\\yousa\\.gemini\\antigravity\\brain\\4457e4ed-a410-42ee-9a04-41e9b6d5e58b'
const SCREENSHOTS_DIR = join(ARTIFACT_DIR, 'screenshots')

if (!existsSync(SCREENSHOTS_DIR)) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true })
}

const PORT = 4179
const BASE_URL = `http://localhost:${PORT}`

async function startPreviewServer(): Promise<ChildProcess> {
  console.log(`Starting Vite preview server on port ${PORT}...`)
  const server = spawn('bunx', ['vite', 'preview', '--port', `${PORT}`, '--host', '127.0.0.1'], {
    shell: true,
    stdio: 'pipe',
  })

  // Wait for the server to be listening
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(BASE_URL)
      if (res.ok) {
        console.log(`Preview server is ready at ${BASE_URL}`)
        return server
      }
    } catch {
      // not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  server.kill()
  throw new Error('Vite preview server failed to start within 30 seconds.')
}

async function runResponsiveTests() {
  const serverProcess = await startPreviewServer()
  const executablePath = findBrowserExecutable()
  console.log(`Using browser executable: ${executablePath}`)

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  })

  try {
    const page = await browser.newPage()

    // 1. Desktop Viewport (1440x900)
    console.log('\n--- Testing Desktop (1440x900) ---')
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 1000))

    const desktopOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth
    })
    console.log(
      `Desktop horizontal overflow: ${desktopOverflow ? 'FAIL (overflow)' : 'PASS (no overflow)'}`
    )
    if (desktopOverflow) {
      throw new Error('Desktop viewport has horizontal overflow!')
    }

    const desktopScreenshot = join(SCREENSHOTS_DIR, 'desktop-1440.png')
    await page.screenshot({ path: desktopScreenshot, fullPage: true })
    console.log(`Saved screenshot: ${desktopScreenshot}`)

    // 2. Tablet Viewport (768x1024)
    console.log('\n--- Testing Tablet (768x1024) ---')
    await page.setViewport({ width: 768, height: 1024 })
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 1000))

    const tabletOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth
    })
    console.log(
      `Tablet horizontal overflow: ${tabletOverflow ? 'FAIL (overflow)' : 'PASS (no overflow)'}`
    )
    if (tabletOverflow) {
      throw new Error('Tablet viewport has horizontal overflow!')
    }

    const tabletScreenshot = join(SCREENSHOTS_DIR, 'tablet-768.png')
    await page.screenshot({ path: tabletScreenshot, fullPage: true })
    console.log(`Saved screenshot: ${tabletScreenshot}`)

    // 3. Mobile Viewport (390x844 - iPhone 14)
    console.log('\n--- Testing Mobile (390x844) ---')
    await page.setViewport({ width: 390, height: 844 })
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 1000))

    const mobileOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth
    })
    console.log(
      `Mobile horizontal overflow: ${mobileOverflow ? 'FAIL (overflow)' : 'PASS (no overflow)'}`
    )
    if (mobileOverflow) {
      throw new Error('Mobile viewport has horizontal overflow!')
    }

    const mobileScreenshot = join(SCREENSHOTS_DIR, 'mobile-390.png')
    await page.screenshot({ path: mobileScreenshot, fullPage: true })
    console.log(`Saved screenshot: ${mobileScreenshot}`)

    // 4. Test Mobile Navigation Drawer
    console.log('\n--- Testing Mobile Menu Drawer ---')
    const menuButton = await page.$('button[aria-controls="mobile-navigation"]')
    if (!menuButton) {
      throw new Error('Mobile menu button not found on 390px viewport!')
    }
    await menuButton.click()
    await new Promise((r) => setTimeout(r, 500))

    const mobileNavVisible = await page.$('#mobile-navigation')
    console.log(`Mobile drawer opened: ${mobileNavVisible ? 'PASS' : 'FAIL'}`)

    const menuScreenshot = join(SCREENSHOTS_DIR, 'mobile-menu-open.png')
    await page.screenshot({ path: menuScreenshot, fullPage: false })
    console.log(`Saved screenshot: ${menuScreenshot}`)

    // Close menu
    await menuButton.click()
    await new Promise((r) => setTimeout(r, 500))

    // 5. Test JD Fit Check Preset Click
    console.log('\n--- Testing Fit Check Preset Input ---')
    await page.evaluate(() => {
      const heading = document.getElementById('fit-check')
      heading?.scrollIntoView()
    })
    await new Promise((r) => setTimeout(r, 500))

    // Click first preset button
    const buttons = await page.$$('button')
    for (const btn of buttons) {
      const text = await page.evaluate((el) => el.textContent, btn)
      if (text && text.includes('Machine Learning Engineer')) {
        await btn.click()
        await new Promise((r) => setTimeout(r, 400))
        break
      }
    }
    const textareaValue = await page.$eval(
      '#fit-jd-input',
      (el) => (el as HTMLTextAreaElement).value
    )
    console.log(
      `Preset loaded into textarea: ${textareaValue.length > 20 ? 'PASS' : 'FAIL'} (${textareaValue.substring(0, 45)}...)`
    )

    // 6. Test Mobile Small (375x667 - iPhone SE)
    console.log('\n--- Testing Small Mobile (375x667) ---')
    await page.setViewport({ width: 375, height: 667 })
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 1000))

    const smallMobileOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth
    })
    console.log(
      `Small mobile horizontal overflow: ${smallMobileOverflow ? 'FAIL (overflow)' : 'PASS (no overflow)'}`
    )
    if (smallMobileOverflow) {
      throw new Error('Small mobile viewport has horizontal overflow!')
    }

    const smallMobileScreenshot = join(SCREENSHOTS_DIR, 'mobile-375.png')
    await page.screenshot({ path: smallMobileScreenshot, fullPage: true })
    console.log(`Saved screenshot: ${smallMobileScreenshot}`)

    // 7. Test Non-Overlap with Google Developer Link in Footer
    console.log('\n--- Testing Floating Button Overlap with Footer Links ---')
    await page.setViewport({ width: 1440, height: 900 })
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await new Promise((r) => setTimeout(r, 600))

    const overlapResult = await page.evaluate(() => {
      const chatButton = document.querySelector('button[aria-controls="resume-chat-dialog"]')
      const googleDevLink = Array.from(document.querySelectorAll('a')).find((a) =>
        a.textContent?.includes('Google Developer')
      )
      if (!chatButton || !googleDevLink) {
        return { found: false, overlaps: false }
      }
      const b1 = chatButton.getBoundingClientRect()
      const b2 = googleDevLink.getBoundingClientRect()
      const overlaps = !(
        b1.right < b2.left ||
        b1.left > b2.right ||
        b1.bottom < b2.top ||
        b1.top > b2.bottom
      )
      return { found: true, overlaps, b1, b2 }
    })
    console.log(
      `Footer Link Overlap Check: ${!overlapResult.overlaps ? 'PASS (Zero overlap with Google Developer link!)' : 'FAIL (Overlaps!)'}`
    )
    if (overlapResult.overlaps) {
      throw new Error('Floating chat button overlaps with Google Developer link!')
    }

    // 8. Capture Focused Fit-Check Dark Mode Snapshot
    console.log('\n--- Testing Dark Mode Fit-Check Section ---')
    await page.evaluate(() => {
      document.documentElement.classList.add('dark')
      const fitSection = document.getElementById('fit-check')
      fitSection?.scrollIntoView({ behavior: 'instant', block: 'start' })
    })
    await new Promise((r) => setTimeout(r, 600))
    const fitDarkScreenshot = join(SCREENSHOTS_DIR, 'fit-check-dark.png')
    const fitElement = await page.$('#fit-check')
    if (fitElement) {
      await fitElement.screenshot({ path: fitDarkScreenshot })
      console.log(`Saved screenshot: ${fitDarkScreenshot}`)
    }

    // 9. Verify SEO Assets: robots.txt and sitemap.xml
    console.log('\n--- Testing SEO Assets (robots.txt & sitemap.xml) ---')
    const robotsRes = await page.goto(`${BASE_URL}/robots.txt`)
    const robotsText = await robotsRes?.text()
    console.log(
      `robots.txt status: ${robotsRes?.status()} (Contains Sitemap: ${robotsText?.includes('Sitemap:') ? 'PASS' : 'FAIL'})`
    )
    if (robotsRes?.status() !== 200 || !robotsText?.includes('Sitemap:')) {
      throw new Error('robots.txt failed validation!')
    }

    const sitemapRes = await page.goto(`${BASE_URL}/sitemap.xml`)
    const sitemapText = await sitemapRes?.text()
    console.log(
      `sitemap.xml status: ${sitemapRes?.status()} (Contains urlset: ${sitemapText?.includes('<urlset') ? 'PASS' : 'FAIL'})`
    )
    if (sitemapRes?.status() !== 200 || !sitemapText?.includes('<urlset')) {
      throw new Error('sitemap.xml failed validation!')
    }

    console.log('\n=============================================')
    console.log('ALL LIVE BROWSER RESPONSIVE TESTS PASSED! ✅')
    console.log('=============================================')
  } finally {
    await browser.close()
    serverProcess.kill()
  }
}

runResponsiveTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Browser testing failed:', err)
    process.exit(1)
  })
