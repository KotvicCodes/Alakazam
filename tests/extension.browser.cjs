//! Installed Extension Acceptance
// optional Playwright runner; uses a new profile and never opens an existing save
const { chromium } = require(process.env.ALAKAZAM_PLAYWRIGHT || 'playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ROOT = path.resolve(__dirname, '..')
const GAME = 'https://orteil.dashnet.org/cookieclicker/'

async function until(check, description) {
    const end = Date.now() + 15000
    while (Date.now() < end) {
        const result = await check()
        if (result) return result
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out: ${description}`)
}

async function run() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'alakazam-acceptance-'))
    const artifacts =
        process.env.ALAKAZAM_ARTIFACTS ||
        fs.mkdtempSync(path.join(os.tmpdir(), 'alakazam-acceptance-artifacts-'))
    fs.mkdirSync(artifacts, { recursive: true })
    const context = await chromium.launchPersistentContext(profile, {
        executablePath: process.env.ALAKAZAM_CHROMIUM || undefined,
        channel: process.env.ALAKAZAM_CHROMIUM ? undefined : 'chromium',
        headless: true,
        ignoreHTTPSErrors: process.env.ALAKAZAM_IGNORE_CERTIFICATE_ERRORS === '1',
        viewport: { width: 1280, height: 800 },
        ignoreDefaultArgs: ['--disable-extensions'],
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            `--disable-extensions-except=${ROOT}`,
            `--load-extension=${ROOT}`
        ]
    })
    try {
        const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'))
        const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`
        const settings = { enabled: false, hud: false }
        await worker.evaluate(settings => chrome.storage.local.set({ settings }), settings)
        // an optional unmodified game mirror makes the run independent of CDN availability
        if (process.env.ALAKAZAM_GAME_DIR) {
            await context.route('**/*', async route => {
                const url = new URL(route.request().url())
                if (url.protocol === 'chrome-extension:') return route.continue()
                if (!/^https:\/\/(orteil|cdn)\.dashnet\.org\/cookieclicker\//.test(url.href))
                    return route.abort()
                const relative =
                    decodeURIComponent(url.pathname.slice('/cookieclicker/'.length)) || 'index.html'
                const file = path.join(process.env.ALAKAZAM_GAME_DIR, relative)
                if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort()
                return route.fulfill({ path: file, headers: { 'Access-Control-Allow-Origin': '*' } })
            })
        }
        await context.addInitScript(() => {
            if (location.origin === 'https://orteil.dashnet.org')
                localStorage.setItem('CookieClickerLang', 'EN')
        })
        const errors = []
        const page = await context.newPage()
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(GAME)
        await page.waitForFunction(() => window.Game?.ready)
        await page.evaluate(() => {
            Game.prefs.timeout = 0
            Game.WriteSave()
        })
        const records = () =>
            worker.evaluate(async () =>
                Object.values(await chrome.storage.local.get(null)).filter(value => value?.pageId)
            )
        const first = await until(
            async () => (await records()).find(value => value.lifecycle === 'running'),
            'hidden startup status'
        )
        assert.equal(await page.locator('#alakazam-hud').count(), 0)
        assert.equal(first.hudVisible, false)
        assert.equal(first.paused, true)
        assert.ok(first.documentId && first.identity.known && first.receivedAt >= first.at)

        async function content(page) {
            const session = await context.newCDPSession(page)
            let id
            session.on('Runtime.executionContextCreated', ({ context }) => {
                if (context.origin === extensionOrigin) id = context.id
            })
            await session.send('Runtime.enable')
            assert.ok(id, 'real extension content-script world exists')
            return async expression => {
                const result = await session.send('Runtime.evaluate', {
                    expression,
                    contextId: id,
                    awaitPromise: true,
                    returnByValue: true
                })
                if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
                return result.result.value
            }
        }
        const inPage = await content(page)
        const popup = await context.newPage()
        popup.on('pageerror', error => errors.push(error.message))
        await popup.goto(`${extensionOrigin}/popup.html`)
        async function activate(tabId) {
            await worker.evaluate(tabId => chrome.tabs.update(tabId, { active: true }), tabId)
        }
        await activate(first.tabId)
        await until(
            async () => (await popup.locator('#identity').innerText()).includes(`Tab ${first.tabId}`),
            'active-tab popup connection'
        )
        assert.match(await popup.locator('#statusLine').innerText(), /Paused/)
        assert.equal(await popup.locator('#buildings').innerText(), '0')
        console.log('PASS hidden startup, paused publication, real popup/storage bridge')

        // keyboard activation in the popup must persist and wake the hidden HUD
        await popup.locator('#configuration summary').focus()
        await popup.keyboard.press('Enter')
        await popup.locator('[data-key="hud"]').focus()
        await popup.keyboard.press('Space')
        await page.locator('#alakazam-hud').waitFor({ state: 'visible' })
        assert.equal(await popup.locator('[data-key="hud"]').getAttribute('aria-pressed'), 'true')
        assert.equal(await page.locator('#alakazam-hud-body').isVisible(), false)
        await page.locator('#alakazam-hud-fold').focus()
        await page.keyboard.press('Enter')
        assert.equal(await page.locator('#alakazam-hud-fold').getAttribute('aria-expanded'), 'true')
        await page.locator('[data-key="purchase"]').focus()
        await page.evaluate(() => {
            window.acceptanceControl = document.activeElement
            document.querySelector('#alakazam-hud-body').scrollTop = 60
            window.acceptanceScroll = document.querySelector('#alakazam-hud-body').scrollTop
        })
        await popup.evaluate(() => {
            window.acceptanceControl = document.activeElement
            window.acceptanceScroll = document.scrollingElement.scrollTop
        })
        const before = await inPage('Alakazam.status.snapshot().at')
        await until(
            async () =>
                (await records()).find(
                    record => record.tabId === first.tabId && record.at > before + 2200
                ),
            'multiple status refreshes'
        )
        assert.equal(
            await page.evaluate(() => document.activeElement === window.acceptanceControl),
            true
        )
        assert.equal(
            await page.evaluate(
                () => document.querySelector('#alakazam-hud-body').scrollTop === window.acceptanceScroll
            ),
            true
        )
        assert.equal(
            await popup.evaluate(() => document.activeElement === window.acceptanceControl),
            true
        )
        assert.equal(
            await popup.evaluate(() => document.scrollingElement.scrollTop === window.acceptanceScroll),
            true
        )
        await page.keyboard.press('Space')
        assert.equal(await page.locator('[data-key="purchase"]').getAttribute('aria-pressed'), 'false')
        await page.keyboard.press('Tab')
        assert.notEqual(
            await page.evaluate(() => document.activeElement === window.acceptanceControl),
            true
        )
        console.log('PASS keyboard controls, stable focus, preserved scroll')

        // master pause remains reachable by keyboard in the compact strip
        const disabled = await popup.evaluate(() =>
            Object.fromEntries(Object.keys(Alakazam.ui.DEFAULTS).map(key => [key, key === 'hud']))
        )
        await popup.evaluate(async settings => {
            for (const [key, value] of Object.entries(settings)) Alakazam.store.setSetting(key, value)
            await Alakazam.store.flush()
        }, disabled)
        await page.locator('#alakazam-hud-pause').focus()
        await page.keyboard.press('Enter')
        assert.equal(await page.locator('#alakazam-hud-pause').innerText(), 'Pause')
        await page.keyboard.press('Space')
        assert.equal(await page.locator('#alakazam-hud-pause').innerText(), 'Resume')

        // both the compact and expanded HUD must leave the store hit-testable
        await page.evaluate(() => {
            Game.cookies = 1e9
            Game.RefreshStore()
        })
        for (const expanded of [true, false]) {
            if (!expanded) {
                await page.locator('#alakazam-hud-fold').focus()
                await page.keyboard.press('Space')
            }
            const target = await page.locator('#product0').boundingBox()
            assert.ok(target)
            assert.equal(
                await page.evaluate(
                    ({ x, y }) => document.elementFromPoint(x, y)?.closest('#product0')?.id,
                    { x: target.x + target.width / 2, y: target.y + target.height / 2 }
                ),
                'product0'
            )
            const owned = await page.evaluate(() => Game.ObjectsById[0].amount)
            await page.locator('#product0').click()
            assert.equal(await page.evaluate(() => Game.ObjectsById[0].amount), owned + 1)
        }
        await page.screenshot({ path: path.join(artifacts, 'hud-1280x800.png') })
        console.log('PASS store access at 1280x800 with expanded and compact HUD')

        // Keep a trusted pointer drag active across several scheduled refreshes.
        const beforeDrag = await page.locator('#alakazam-hud').boundingBox()
        await page.mouse.move(beforeDrag.x + 20, beforeDrag.y + 15)
        await page.mouse.down()
        await page.mouse.move(500, 300)
        const duringDrag = await page.locator('#alakazam-hud').boundingBox()
        assert.notEqual(duringDrag.x, beforeDrag.x)
        const dragStartedAt = await inPage('Alakazam.status.snapshot().at')
        await until(
            async () =>
                (await records()).some(
                    record => record.tabId === first.tabId && record.at > dragStartedAt + 2200
                ),
            'multiple refreshes during a drag'
        )
        assert.deepEqual(await page.locator('#alakazam-hud').boundingBox(), duringDrag)
        await page.mouse.up()
        await inPage('Alakazam.hud.render()')
        assert.deepEqual(await page.locator('#alakazam-hud').boundingBox(), duringDrag)
        console.log('PASS pointer dragging across periodic refreshes and release')

        // keyboard docking is the alternative to pointer dragging
        await page.locator('#alakazam-hud-fold').focus()
        await page.keyboard.press('Enter')
        const dock = page.locator('#alakazam-hud-dock')
        await dock.focus()
        await page.keyboard.press('Space')
        assert.match(await dock.innerText(), /top left/)
        await inPage(
            "Alakazam.store.set('hudPosition', {left: '9000px', top: '-800px'}); Alakazam.hud.render()"
        )
        for (const viewport of [
            { width: 640, height: 400 },
            { width: 320, height: 480 },
            { width: 1280, height: 800 }
        ]) {
            await page.setViewportSize(viewport)
            await inPage('Alakazam.hud.render()')
            const rect = await page.locator('#alakazam-hud').boundingBox()
            assert.ok(
                rect.x >= 0 &&
                    rect.y >= 0 &&
                    rect.x + rect.width <= viewport.width &&
                    rect.y + rect.height <= viewport.height
            )
        }
        // reload restoration uses the same clamping path
        await inPage(
            "Alakazam.store.set('hudPosition', {left: '9000px', top: '-800px'}); Alakazam.store.flush()"
        )
        await page.reload()
        await page.locator('#alakazam-hud').waitFor()
        const restored = await page.locator('#alakazam-hud').boundingBox()
        assert.ok(
            restored.x >= 0 &&
                restored.y >= 0 &&
                restored.x + restored.width <= 1280 &&
                restored.y + restored.height <= 800
        )
        const currentFirst = await until(
            async () =>
                (await records()).find(
                    record => record.tabId === first.tabId && record.pageId !== first.pageId
                ),
            'new document identity'
        )
        const inReloaded = await content(page)
        console.log('PASS docking, viewport changes, off-screen restore, document identity')

        const secondPage = await context.newPage()
        await secondPage.goto(GAME)
        await secondPage.waitForFunction(() => window.Game?.ready)
        await secondPage.evaluate(() => {
            Game.cookies = 22222
            Game.prefs.timeout = 0
        })
        const second = await until(
            async () => (await records()).find(record => record.tabId !== first.tabId),
            'second game tab'
        )
        const inSecond = await content(secondPage)
        await inSecond('Alakazam.status.publish()')
        await activate(first.tabId)
        await until(
            async () => (await popup.locator('#identity').innerText()).includes(`Tab ${first.tabId}`),
            'first tab selected over newer second record'
        )
        assert.notEqual(currentFirst.pageId, second.pageId)
        await activate(second.tabId)
        await until(
            async () => (await popup.locator('#identity').innerText()).includes(`Tab ${second.tabId}`),
            'second tab selected'
        )
        assert.equal(await popup.locator('#cookies').innerText(), '22.222k')
        await activate(first.tabId)
        await until(
            async () => (await popup.locator('#identity').innerText()).includes(`Tab ${first.tabId}`),
            'first tab restored'
        )
        console.log('PASS two game tabs, active-tab selection, separate live data')

        await page.evaluate(() => localStorage.setItem('CookieClickerLang', 'FR'))
        await until(
            async () =>
                (await popup.locator('#statusLine').innerText()).includes('Unsupported language: FR'),
            'language restriction in popup'
        )
        await page.evaluate(() => localStorage.setItem('CookieClickerLang', 'EN'))
        await inReloaded('window.__alakazam.identity = {known:false}; Alakazam.status.publish()')
        await until(
            async () =>
                (await popup.locator('#statusLine').innerText()).includes('Save identity unresolved'),
            'identity restriction in popup'
        )
        await inReloaded(
            'window.__alakazam.identity = Alakazam.identity.fromSave(Alakazam.save.get()); Alakazam.registry.register({name:"acceptanceFailure", always:true, interval:20, tick(){throw new Error("acceptance failure")}})'
        )
        await until(
            async () => (await popup.locator('#statusLine').innerText()).includes('acceptanceFailure'),
            'module failure in popup'
        )
        await popup
            .locator('details')
            .last()
            .evaluate(node => (node.open = true))
        assert.match(await popup.locator('#diagnostics').innerText(), /acceptance failure/)
        await popup.locator('#configuration').evaluate(node => (node.open = false))
        await popup.setViewportSize({ width: 360, height: 600 })
        await popup.evaluate(() => (document.scrollingElement.scrollTop = 0))
        await popup.screenshot({ path: path.join(artifacts, 'popup-diagnostics.png'), fullPage: true })
        console.log('PASS language/identity restrictions and scheduler failures reach popup')

        await secondPage.close()
        await until(
            async () => !(await records()).some(record => record.tabId === second.tabId),
            'closed tab status cleanup'
        )
        await page.goto('about:blank')
        await until(
            async () =>
                (await popup.locator('#statusLine').innerText()).includes('Select a Cookie Clicker tab'),
            'non-game active tab'
        )
        assert.deepEqual(errors, [])
        console.log(`PASS navigation/close cleanup; artifacts: ${artifacts}`)
    } finally {
        await context.close()
        fs.rmSync(profile, { recursive: true, force: true })
    }
}
run().catch(error => {
    console.error(error)
    process.exitCode = 1
})
