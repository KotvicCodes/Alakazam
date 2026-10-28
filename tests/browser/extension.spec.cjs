const { test, expect, chromium } = require('@playwright/test')
const { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createHash, generateKeyPairSync } = require('node:crypto')
const { root, manifest, origin, localOnly, openGame } = require('./fixtures.cjs')

async function extensionAcceptance(handoff) {
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
        // Keep the pinned assets unchanged while exercising the real beta URL
        // and its separate native save key in this disposable browser profile.
        await context.route(`${origin}/cookieclicker/beta/**`, route =>
            route.continue({
                url: route
                    .request()
                    .url()
                    .replace(origin + '/cookieclicker/beta/', origin + '/')
            })
        )
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
        const readyWorld = async () => {
            await expect
                .poll(() => {
                    world = [...worlds.values()].find(
                        value => value.origin === `chrome-extension://${id}`
                    )
                    return Boolean(world)
                })
                .toBe(true)
            await expect.poll(() => isolated('Boolean(window.Alakazam?.store.isReady())')).toBe(true)
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

        // A second real content-script document must not retire the first
        // document's durable undo while that document is between mutations.
        for (const kind of ['name', 'clones']) {
            const originalGenes = [4, 5, 6, 1, 2, 3, 4]
            const originalName = 'Shared tab original'
            const key = kind === 'name' ? 'bakeryNameRecovery' : 'cloneRecovery'
            await page.evaluate(
                ({ originalGenes, originalName }) => {
                    Game.ClosePrompt()
                    Game.Objects.You.amount = 1
                    Game.bakeryName = originalName
                    Game.bakeryNameRefresh()
                    Game.YouCustomizer.load(originalGenes.join(','))
                    Game.WriteSave()
                },
                { originalGenes, originalName }
            )
            await isolated('Alakazam.registry.get("saveWatch").tick()')
            const other = await context.newPage()
            const otherCdp = await context.newCDPSession(other)
            let otherWorld
            otherCdp.on('Runtime.executionContextCreated', ({ context }) => {
                if (context.origin === `chrome-extension://${id}`) otherWorld = context
            })
            await otherCdp.send('Runtime.enable')
            await openGame(other)
            await expect.poll(() => Boolean(otherWorld)).toBe(true)
            const otherIsolated = async expression => {
                const result = await otherCdp.send('Runtime.evaluate', {
                    contextId: otherWorld.id,
                    expression,
                    awaitPromise: true,
                    returnByValue: true
                })
                if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
                return result.result.value
            }
            await expect.poll(() => otherIsolated('Boolean(Alakazam.store.isReady())')).toBe(true)
            await isolated(`(() => {
                const kind = ${JSON.stringify(kind)}
                const wait = Alakazam.safety.wait
                const flush = Alakazam.store.flush
                let writes = 0
                Alakazam.safety.wait = async (owner, ms) => {
                    if (kind === 'name' && owner === 'achievements' && ms === 600)
                        await new Promise(resolve => window.releaseSharedMutation = resolve)
                    else await wait(owner, ms)
                }
                Alakazam.store.flush = async () => {
                    const ok = await flush()
                    if (kind === 'clones' && ++writes === 5)
                        await new Promise(resolve => window.releaseSharedMutation = resolve)
                    return ok
                }
                window.pendingSharedMutation = Alakazam.safety.run(
                    { name: kind === 'name' ? 'achievements' : 'clones', always: true },
                    () => kind === 'name' ? Alakazam.achievements.godComplex() : Alakazam.clones.tick()
                )
                return true
            })()`)
            await expect.poll(() => isolated('typeof window.releaseSharedMutation')).toBe('function')
            const current = () =>
                page.evaluate(
                    kind => (kind === 'name' ? Game.bakeryName : Game.YouCustomizer.currentGenes),
                    kind
                )
            expect(await current()).not.toEqual(kind === 'name' ? originalName : originalGenes)
            await expect
                .poll(() => otherIsolated(`Boolean(Alakazam.store.get(${JSON.stringify(key)}, null))`))
                .toBe(true)
            for (let attempt = 0; attempt < 2; attempt++) {
                await otherIsolated(
                    kind === 'name' ? 'Alakazam.achievements.recoverName()' : 'Alakazam.clones.recover()'
                )
                await otherIsolated('Alakazam.store.flush()')
                expect(
                    await otherIsolated(`Boolean(Alakazam.store.get(${JSON.stringify(key)}, null))`)
                ).toBe(true)
                expect(await isolated(`Boolean(Alakazam.store.get(${JSON.stringify(key)}, null))`)).toBe(
                    true
                )
            }
            // Autosave the temporary value, then destroy A without releasing
            // its old task. Recovery must survive in the replacement document.
            await page.evaluate(() => Game.WriteSave())
            if (handoff === 'reload') {
                await page.reload()
                await otherIsolated(
                    kind === 'name' ? 'Alakazam.achievements.recoverName()' : 'Alakazam.clones.recover()'
                )
                expect(
                    await otherIsolated(`Boolean(Alakazam.store.get(${JSON.stringify(key)}, null))`)
                ).toBe(true)
                await page.waitForFunction(() => window.Game?.ready)
                await expect
                    .poll(() => {
                        world = [...worlds.values()].find(
                            value => value.origin === `chrome-extension://${id}`
                        )
                        return Boolean(world)
                    })
                    .toBe(true)
                await expect.poll(() => isolated('Boolean(Alakazam.store.isReady())')).toBe(true)
                await isolated(
                    kind === 'name' ? 'Alakazam.achievements.recoverName()' : 'Alakazam.clones.recover()'
                )
                await expect.poll(current).toEqual(kind === 'name' ? originalName : originalGenes)
            } else {
                await page.evaluate(() =>
                    localStorage.setItem('CookieClickerGameBeta', localStorage.getItem(Game.SaveTo))
                )
                await page.goto(origin + '/cookieclicker/beta/')
                await page.waitForFunction(
                    () => window.Game?.ready && Game.SaveTo === 'CookieClickerGameBeta'
                )
                await readyWorld()
                expect(await isolated('Alakazam.identity.current().legacyId')).not.toBe(
                    await otherIsolated('Alakazam.identity.current().legacyId')
                )
                // B loads the stable temporary save while A stays open on beta.
                await other.evaluate(() => {
                    Game.LoadSave()
                    Game.ClosePrompt()
                })
                await otherIsolated('Alakazam.registry.get("saveWatch").tick()')
                await expect
                    .poll(async () => {
                        await otherIsolated(
                            kind === 'name'
                                ? 'Alakazam.achievements.recoverName()'
                                : 'Alakazam.clones.recover()'
                        )
                        return other.evaluate(
                            kind =>
                                kind === 'name' ? Game.bakeryName : Game.YouCustomizer.currentGenes,
                            kind
                        )
                    })
                    .toEqual(kind === 'name' ? originalName : originalGenes)
                // Persist restoration before returning A to the stable document.
                await other.evaluate(() => Game.WriteSave())
                await otherIsolated(
                    kind === 'name' ? 'Alakazam.achievements.recoverName()' : 'Alakazam.clones.recover()'
                )
                await otherIsolated('Alakazam.store.flush()')
                await page.goto(origin)
                await page.waitForFunction(() => window.Game?.ready)
                await readyWorld()
            }
            await other.close()
        }

        await context.close()
        // Keep extension storage and preferences across restart, while bounding
        // generated browser caches in this disposable profile on shared runners.
        for (const cache of [
            'Default/Cache',
            'Default/Code Cache',
            'Default/GPUCache',
            'ShaderCache',
            'GrShaderCache',
            'GraphiteDawnCache'
        ]) {
            rmSync(join(profile, cache), { recursive: true, force: true })
        }
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
}

for (const handoff of ['reload', 'beta']) {
    test(`unpacked extension isolates globals, bridges popup and recovers journals after ${handoff}`, () =>
        extensionAcceptance(handoff))
}
