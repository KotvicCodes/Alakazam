const { test, expect, chromium } = require('@playwright/test')
const { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createHash, generateKeyPairSync } = require('node:crypto')
const { root, manifest, origin, localOnly, openGame } = require('./fixtures.cjs')

test('unpacked extension isolates globals and bridges popup through persistent Chrome storage', async () => {
    const temporary = mkdtempSync(join(tmpdir(), 'alakazam-smoke-'))
    const extension = join(temporary, 'extension')
    const profile = join(temporary, 'profile')
    for (const file of ['src', 'icons', 'popup.html', 'popup.js', 'popup.css']) {
        cpSync(join(root, file), join(extension, file), { recursive: true })
    }
    // Adapt only the disposable copy's canonical-origin guards to our local server.
    for (const file of ['popup.js', 'src/background.js']) {
        const target = join(extension, file)
        const code = readFileSync(target, 'utf8')
        const canonical = String.raw`/^https:\/\/orteil\.dashnet\.org\/cookieclicker\//`
        expect(code.includes(canonical)).toBe(true)
        writeFileSync(
            target,
            code.replace(canonical, String.raw`/^http:\/\/127\.0\.0\.1:${new URL(origin).port}\//`)
        )
    }
    const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
        type: 'spki',
        format: 'der'
    })
    const id = [...createHash('sha256').update(publicKey).digest().subarray(0, 16)]
        .map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
        .join('')
    const localManifest = structuredClone(manifest)
    localManifest.key = publicKey.toString('base64')
    localManifest.host_permissions = ['http://127.0.0.1/*']
    for (const scripts of localManifest.content_scripts) scripts.matches = ['http://127.0.0.1/*']
    writeFileSync(join(extension, 'manifest.json'), JSON.stringify(localManifest, null, 4))
    const launch = () =>
        chromium.launchPersistentContext(profile, {
            channel: 'chromium',
            headless: true,
            args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
        })
    let context
    try {
        context = await launch()
        await localOnly(context)
        const popup = await context.newPage()
        await popup.goto(`chrome-extension://${id}/popup.html`)
        await popup.evaluate(() => chrome.storage.local.set({ settings: { enabled: false } }))
        await popup.reload()
        await expect(popup.getByRole('button', { name: 'Resume automation', exact: true })).toBeVisible()

        const page = await context.newPage()
        const cdp = await context.newCDPSession(page)
        const worlds = new Map()
        cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.set(context.id, context))
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) =>
            worlds.delete(executionContextId)
        )
        cdp.on('Runtime.executionContextsCleared', () => worlds.clear())
        await cdp.send('Runtime.enable')
        await openGame(page)
        let world
        await expect
            .poll(() => {
                world = [...worlds.values()].find(value => value.origin === `chrome-extension://${id}`)
                return Boolean(world)
            })
            .toBe(true)
        const isolated = async expression => {
            const result = await cdp.send('Runtime.evaluate', {
                contextId: world.id,
                expression,
                awaitPromise: true,
                returnByValue: true
            })
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
            return result.result.value
        }
        await expect.poll(() => isolated('Boolean(window.Alakazam?.store.isReady())')).toBe(true)
        expect(await page.evaluate(() => typeof window.Alakazam)).toBe('undefined')
        expect(await page.evaluate(() => typeof window.Game)).toBe('object')
        expect(await isolated('typeof window.Game')).toBe('undefined')
        expect(await isolated('Alakazam.savefile.read().ok')).toBe(true)
        expect(await isolated('Alakazam.store.setting("enabled")')).toBe(false)

        await popup.evaluate(async url => {
            const [tab] = await chrome.tabs.query({ url })
            await chrome.tabs.update(tab.id, { active: true })
            document.querySelector('#configuration').open = true
        }, page.url())
        await expect(popup.locator('#identity')).toContainText('Tab ')
        await popup.locator('[data-key=autoclick]').click()
        await expect.poll(() => isolated('Alakazam.store.setting("autoclick")')).toBe(false)
        await isolated('Alakazam.store.setSetting("shimmers", false); Alakazam.store.flush()')
        await popup.getByRole('button', { name: 'Refresh status', exact: true }).click()
        await expect(popup.locator('[data-key=shimmers]')).toHaveAttribute('aria-pressed', 'false')

        // Use the status relay and real active-tab API, then read its document-bound record.
        await isolated('Alakazam.status.publish()')
        await popup.reload()
        await expect(popup.locator('#gameData')).toBeVisible()
        expect(
            await popup.evaluate(async () => {
                const all = await chrome.storage.local.get(null)
                return Object.entries(all).some(
                    ([key, value]) => key.startsWith('status:tab:') && value.documentId && value.pageId
                )
            })
        ).toBe(true)

        await context.close()
        context = await launch()
        const reopened = await context.newPage()
        await reopened.goto(`chrome-extension://${id}/popup.html`)
        await expect(reopened.locator('[data-key=autoclick]')).toHaveAttribute('aria-pressed', 'false')
        await expect(reopened.locator('[data-key=shimmers]')).toHaveAttribute('aria-pressed', 'false')
        await expect(
            reopened.getByRole('button', { name: 'Resume automation', exact: true })
        ).toBeVisible()
    } finally {
        try {
            if (context) await context.close()
        } finally {
            rmSync(temporary, { recursive: true, force: true })
        }
    }
})
