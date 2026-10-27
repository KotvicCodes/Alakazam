const {
    test,
    expect,
    localOnly,
    openGame,
    loadAlakazam,
    publish,
    lumpReserve,
    stockCapacity,
    cosmeticChange,
    minigame,
    transition,
    researchTooltip,
    buffTooltip
} = require('./fixtures.cjs')

test('reads actual save output and dispatches a store purchase', async ({ game }) => {
    await game.evaluate(() => {
        Game.cookies = 1000
        Game.cookiesEarned = 1000
        Game.RefreshStore()
    })
    await publish(game)
    expect(await game.evaluate(() => Alakazam.save.get().scalars.cookies)).toBe(1000)
    const owned = await game.evaluate(() => Game.Objects.Cursor.amount)
    await game.evaluate(() => Alakazam.input.simulateClick(document.getElementById('product0')))
    expect(await game.evaluate(() => Game.Objects.Cursor.amount)).toBe(owned + 1)
    // A real purchase changes live state without updating the autosave.
    expect(await game.evaluate(() => Alakazam.save.get().buildings[0].amount)).toBe(owned)
    await publish(game)
    expect(await game.evaluate(() => Alakazam.save.get().buildings[0].amount)).toBe(owned + 1)
})

test('recognizes actual ascension prompts and transition classes', async ({ game }) => {
    await transition(game, 'ascend-prompt')
    expect(await game.evaluate(() => Alakazam.act.ascend.promptIs('ascend'))).toBe(true)
    await transition(game, 'intro')
    expect(await game.evaluate(() => Alakazam.act.ascend.screen())).toBe('intro')
    await transition(game, 'ascending')
    expect(await game.evaluate(() => Alakazam.act.ascend.screen())).toBe('ascending')
    await transition(game, 'reincarnate-prompt')
    expect(await game.evaluate(() => Alakazam.act.ascend.promptIs('reincarnate'))).toBe(true)
    await transition(game, 'reincarnating')
    expect(await game.evaluate(() => Alakazam.act.ascend.screen())).toBe('reincarnating')
    await transition(game, 'playing')
    expect(await game.evaluate(() => Alakazam.act.ascend.screen())).toBe('playing')
})

test('French fixtures use game-generated tooltips', async ({ page, context }) => {
    await localOnly(context)
    await openGame(page, 'FR')
    await loadAlakazam(page)
    await expect(await researchTooltip(page)).toContainText('Esprit unique')
    await expect(await buffTooltip(page)).toContainText('Frénésie')
    // Guard/classification correctness belongs with the localization fix.
})

test('fresh fixtures survive the delayed startup save retry', async ({ page, context }) => {
    await localOnly(context)
    await page.addInitScript(() => {
        const schedule = window.setTimeout.bind(window)
        // Hold only the pinned game's fresh-start recovery callback so the race
        // is reproducible regardless of machine speed. A reload discards it.
        window.runStartupSaveRetry = () => {}
        window.setTimeout = (callback, delay, ...args) => {
            if (
                delay === 500 &&
                typeof callback === 'function' &&
                callback.toString().includes('Game.LoadSave(local)')
            ) {
                sessionStorage.setItem(
                    'heldStartupSaveRetries',
                    String(Number(sessionStorage.getItem('heldStartupSaveRetries')) + 1)
                )
                window.runStartupSaveRetry = () => callback(...args)
                return schedule(() => {}, 0)
            }
            return schedule(callback, delay, ...args)
        }
    })
    await openGame(page, 'FR')
    expect(await page.evaluate(() => sessionStorage.getItem('heldStartupSaveRetries'))).toBe('1')
    await expect(await buffTooltip(page)).toContainText('Frénésie')
    await page.evaluate(() => {
        Game.cookies = 123
        window.runStartupSaveRetry()
    })
    expect(await page.evaluate(() => Game.cookies)).toBe(123)
    await expect(page.locator('#buffs .crate')).toHaveCount(1)
    await expect(await buffTooltip(page)).toContainText('Frénésie')
})

test('lump fixture exposes live changes while the autosave stays fixed', async ({ game }) => {
    const raw = await lumpReserve(game)
    await game.evaluate(() => {
        Game.prefs.askLumps = 0
        Game.Objects['Wizard tower'].levelUp()
    })
    expect(await game.evaluate(() => Game.lumps)).toBe(100)
    expect(await game.evaluate(() => Game.Objects['Wizard tower'].level)).toBe(2)
    expect(await game.evaluate(() => localStorage.getItem(Game.SaveTo))).toBe(raw)
    expect(await game.evaluate(() => Alakazam.save.get().scalars.lumps)).toBe(102)
})

test('capacity fixture exposes executable and full market orders', async ({ game }) => {
    const capacity = await stockCapacity(game)
    expect(capacity).toEqual({ full: 91, availableCapacity: 10 })
    expect(await game.evaluate(() => Alakazam.market.state().goods.map(good => good.signal))).toEqual([
        'strong buy',
        'strong buy',
        ...Array(16).fill('hold')
    ])
    await expect(game.locator('#bankGood-0-stock')).toHaveText('91')
    await expect(game.locator('#bankGood-0-stockMax')).toHaveText('/91')
    await game.evaluate(() => Alakazam.input.simulateClick(document.getElementById('bankGood-1_Max')))
    expect(await game.evaluate(() => Game.Objects.Bank.minigame.goodsById[1].stock)).toBe(10)
})

test('cosmetic fixture keeps the latest appearance separate from its save', async ({ game }) => {
    const { saved, live, raw } = await cosmeticChange(game)
    expect(await game.evaluate(() => Game.YouCustomizer.currentGenes)).toEqual(live)
    expect(await game.evaluate(() => Alakazam.save.get().run.appearance)).toEqual(saved)
    expect(await game.evaluate(() => localStorage.getItem(Game.SaveTo))).toBe(raw)
})

test('store transactions restore player controls across successive real redraws', async ({ game }) => {
    await game.evaluate(() => {
        Game.cookies = 1e6
        Game.cookiesEarned = 1e6
        Game.RefreshStore()
        Alakazam.store.setSetting('enabled', true)
    })
    await expect
        .poll(() =>
            game.evaluate(() => Alakazam.live.readProducts().some(product => product.index === 0))
        )
        .toBe(true)
    await game.evaluate(() => {
        window.transactionProduct = Alakazam.live.readProducts().find(product => product.index === 0)
        Alakazam.input.simulateClick(document.getElementById('storeBulkSell'))
        Alakazam.input.simulateClick(document.getElementById('storeBulk10'))
    })
    const before = await game.evaluate(() => Game.Objects.Cursor.amount)
    for (let i = 0; i < 3; i++) {
        const result = await game.evaluate(() =>
            Alakazam.act.store.buy(window.transactionProduct, 1, 1000)
        )
        expect(result.bought, JSON.stringify(result)).toBe(true)
        expect(result.amount).toBe(1)
        expect(await game.evaluate(() => [Game.buyMode, Game.buyBulk])).toEqual([-1, 10])
    }
    expect(await game.evaluate(() => Game.Objects.Cursor.amount)).toBe(before + 3)
})

test('live maturity harvesting preserves the selected seed without replanting', async ({ game }) => {
    await minigame(game, 'Farm')
    await game.evaluate(() => {
        const farm = Game.Objects.Farm
        farm.amount = 300
        farm.level = 9
        const garden = farm.minigame
        garden.nextStep = Date.now() + 1e9
        garden.plants.bakeberry.unlocked = 0
        garden.plants.bakerWheat.unlocked = 1
        for (const row of garden.plot)
            for (const tile of row) {
                tile[0] = garden.plants.bakeberry.id + 1
                tile[1] = 49
            }
        garden.buildPanel()
        garden.buildPlot()
        Game.cookies = 1e9
        Game.cookiesEarned = 1e9
        Alakazam.store.setSetting('enabled', true)
        Alakazam.input.simulateClick(document.getElementById('gardenSeed-0'))
    })
    await publish(game)
    await game.evaluate(() => Alakazam.registry.get('garden').tick())
    expect(await game.evaluate(() => Game.Objects.Farm.minigame.plot[0][0])).toEqual([9, 49])
    expect(await game.evaluate(() => Game.Objects.Farm.minigame.seedSelected)).toBe(0)
    await game.evaluate(() => {
        const garden = Game.Objects.Farm.minigame
        garden.plot[0][0][1] = 50
        garden.buildPlot()
    })
    await game.evaluate(() => Alakazam.registry.get('garden').tick())
    expect(await game.evaluate(() => Game.Objects.Farm.minigame.plot[0][0][0])).toBe(0)
    expect(await game.evaluate(() => Game.Objects.Farm.minigame.plants.bakeberry.unlocked)).toBe(1)
    expect(await game.evaluate(() => Game.Objects.Farm.minigame.seedSelected)).toBe(0)
    expect(await game.evaluate(() => Alakazam.store.get('gardenHarvests', 0))).toBe(1)
    expect(await game.evaluate(() => Alakazam.save.get().buildings[2].minigame.plot[0][0].age)).toBe(49)
})

test('beta-keyed exports verify empty and live wrinkler hoards', async ({ game }) => {
    await game.evaluate(() => {
        // The pinned mirror serves the live game; select the beta storage variant
        // explicitly without changing the export or identity implementation.
        history.replaceState({}, '', '/cookieclicker/beta/')
        Game.SaveTo = 'CookieClickerGameBeta'
        Alakazam.store.setSetting('enabled', true)
    })
    await publish(game)
    const empty = await game.evaluate(() => Alakazam.act.ascend.liveHoard())
    expect(empty).not.toBeNull()
    expect(empty.hoard).toBe(0)
    expect(empty.runId).toBe(await game.evaluate(() => Alakazam.identity.current().runId))
    await game.evaluate(() => {
        for (const [index, amount] of [1e9, 2e9].entries()) {
            const wrinkler = Game.wrinklers[index]
            wrinkler.phase = 2
            wrinkler.type = index
            wrinkler.sucked = amount
        }
    })
    const valuable = await game.evaluate(() => Alakazam.act.ascend.liveHoard())
    expect(valuable).not.toBeNull()
    expect(valuable.hoard).toBe(3e9)
    expect(valuable.active).toBe(2)
    // Exporting must not update the stale zero-hoard autosave.
    expect(await game.evaluate(() => Alakazam.save.get().scalars.wrinklersAmount)).toBe(0)
})

test('heavenly-screen reload replans the unchanged run instead of waiting forever', async ({
    page,
    context
}) => {
    await localOnly(context)
    await page.addInitScript(() => {
        // Persist the store across a real document reload without claiming this
        // page-world test exercises Chrome's extension storage bridge.
        const key = '__alakazam_reload_test_storage'
        const read = () => JSON.parse(localStorage.getItem(key) || '{}')
        window.chrome = {
            storage: {
                local: {
                    get(_keys, callback) {
                        queueMicrotask(() => callback(read()))
                    },
                    set(values, callback) {
                        localStorage.setItem(key, JSON.stringify({ ...read(), ...values }))
                        queueMicrotask(() => callback())
                    }
                }
            }
        }
    })
    await openGame(page)
    await loadAlakazam(page)
    await page.evaluate(() => {
        Game.cookies = 1e24
        Game.cookiesEarned = 1e24
        Game.cookiesReset = 0
        Game.resets = 0
    })
    await publish(page)
    await page.evaluate(async () => {
        await Alakazam.save.connect()
        Alakazam.store.setSetting('enabled', true)
        for (let i = 0; i < 3; i++) await Alakazam.registry.get('ascend').tick()
    })
    await expect.poll(() => page.evaluate(() => Game.AscendTimer)).toBeGreaterThan(0)
    await transition(page, 'ascending')
    await page.evaluate(async () => {
        await Alakazam.registry.get('ascend').tick()
        await Alakazam.store.flush()
    })
    expect(await page.evaluate(() => Alakazam.store.get('ascendPhase'))).toBe('shopping')
    expect(await page.evaluate(() => Alakazam.store.get('ascendAwaitReset'))).toBe(0)
    const run = await page.evaluate(() => Alakazam.identity.current().runId)
    await page.reload()
    await page.waitForFunction(() => window.Game?.ready)
    await page.evaluate(() => Game.ClosePrompt())
    await loadAlakazam(page)
    await page.evaluate(async () => {
        await Alakazam.save.connect()
        Alakazam.store.setSetting('enabled', true)
        await Alakazam.registry.get('ascend').tick()
    })
    expect(await page.evaluate(() => Game.OnAscend)).toBe(0)
    expect(await page.evaluate(() => Alakazam.identity.current().runId)).toBe(run)
    expect(await page.evaluate(() => window.__alakazam.ascend.waitingForSave)).not.toBe(true)
    expect(await page.evaluate(() => Alakazam.store.get('ascendAwaitReset', null))).toBeNull()
    expect(await page.evaluate(() => Alakazam.ascend.state().phase)).toBe('loans')
})

test('rounded-price refusal stops unchanged retries and recovers after funding', async ({ game }) => {
    await game.evaluate(() => {
        Game.cookies = 1e6
        Game.cookiesEarned = 2e6
        Game.Objects.Cursor.basePrice = 1000400
        Game.Objects.Cursor.refresh()
        Game.RefreshStore()
        Alakazam.store.setSetting('enabled', true)
        window.refusedClicks = 0
        document.addEventListener('click', event => {
            if (event.target.closest('#product0')) window.refusedClicks++
        })
    })
    await expect.poll(() => game.evaluate(() => Alakazam.live.readGlobals().cookies)).toBe(1e6)
    await expect
        .poll(() => game.evaluate(() => Alakazam.live.readProducts().some(item => item.index === 0)))
        .toBe(true)
    const attempt = () =>
        game.evaluate(() => {
            const product = Alakazam.live.readProducts().find(item => item.index === 0)
            return Alakazam.act.store.buy(product, 1, Infinity)
        })
    expect((await attempt()).bought).toBe(false)
    for (let i = 0; i < 3; i++) expect((await attempt()).bought).toBe(false)
    expect(await game.evaluate(() => window.refusedClicks)).toBe(1)
    expect(await game.evaluate(() => Game.Objects.Cursor.amount)).toBe(0)
    await game.evaluate(() => {
        Game.cookies = 1.1e6
        Game.Objects.Cursor.refresh()
    })
    await expect.poll(() => game.evaluate(() => Alakazam.live.readGlobals().cookies)).toBe(1.1e6)
    expect((await attempt()).bought).toBe(true)
    expect(await game.evaluate(() => Game.Objects.Cursor.amount)).toBe(1)
    expect(await game.evaluate(() => [Game.buyMode, Game.buyBulk])).toEqual([1, 1])
})

for (const cancellation of ['pause', 'foreign prompt']) {
    test(`cancelled lump confirmation releases its reservation after ${cancellation}`, async ({
        game
    }) => {
        await lumpReserve(game)
        await game.evaluate(() => {
            const wizard = Game.Objects['Wizard tower']
            wizard.amount = 1
            wizard.highest = 1
            wizard.level = 2
            wizard.refresh()
            Game.lumps = 103
            Game.lumpsTotal = 200
            Game.lumpT = Date.now()
            Game.prefs.askLumps = 1
            Game.computeLumpTimes()
            Game.Draw()
            Alakazam.store.setSetting('enabled', true)
        })
        await publish(game)
        await expect(game.locator('#lumpsAmount')).toHaveText('103')
        await expect
            .poll(() =>
                game.evaluate(() =>
                    Alakazam.parse.firstNumberIn(document.getElementById('productLevel7').innerText)
                )
            )
            .toBe(2)
        expect(await game.evaluate(() => Alakazam.lumps.nextSpend(103)?.cost)).toBe(3)
        await game.evaluate(() => {
            const until = Alakazam.transactions.until
            window.restoreLumpWait = () => (Alakazam.transactions.until = until)
            Alakazam.transactions.until = async (...args) => {
                const outcome = await until(...args)
                if (document.getElementById('promptContentSpendLump') && !window.releaseLumpWait) {
                    await new Promise(resolve => (window.releaseLumpWait = resolve))
                }
                return outcome
            }
            window.pendingLumpTick = Alakazam.registry.get('lumps').tick()
        })
        await expect(game.locator('#promptContentSpendLump')).toHaveCount(1)
        if (cancellation === 'pause') {
            await game.evaluate(() => Alakazam.store.setSetting('enabled', false))
            await game.locator('#promptOption1').click()
        } else {
            await game.locator('#promptOption1').click()
            await game.keyboard.press('Control+o')
            await expect(game.locator('#promptContentImportSave')).toHaveCount(1)
        }
        await game.evaluate(async () => {
            window.releaseLumpWait()
            await window.pendingLumpTick
            window.restoreLumpWait()
        })
        expect(await game.evaluate(() => Game.lumps)).toBe(103)
        expect(await game.evaluate(() => Game.Objects['Wizard tower'].level)).toBe(2)
        if (cancellation === 'foreign prompt') {
            await expect(game.locator('#promptContentImportSave')).toHaveCount(1)
            await game.locator('#promptOption1').click()
        }
        await publish(game)
        await game.evaluate(() => Alakazam.store.setSetting('enabled', true))
        expect(await game.evaluate(() => Alakazam.lumps.nextSpend(103)?.cost)).toBe(3)
        await game.evaluate(async () => {
            Game.prefs.askLumps = 0
            await Alakazam.registry.get('lumps').tick()
        })
        expect(await game.evaluate(() => Game.lumps)).toBe(100)
        expect(await game.evaluate(() => Game.Objects['Wizard tower'].level)).toBe(3)
    })
}

test('cancelled bulk switch restores one while a player import prompt stays open', async ({ game }) => {
    await game.evaluate(() => {
        Game.cookies = 1e9
        Game.cookiesEarned = 1e9
        Game.RefreshStore()
        Alakazam.store.setSetting('enabled', true)
    })
    await expect.poll(() => game.evaluate(() => Alakazam.live.readGlobals().cookies)).toBe(1e9)
    await game.evaluate(() => {
        const until = Alakazam.transactions.until
        window.restoreStoreWait = () => (Alakazam.transactions.until = until)
        Alakazam.transactions.until = async (...args) => {
            const result = await until(...args)
            if (Game.buyBulk === 100 && !window.releaseStoreWait) {
                await new Promise(resolve => (window.releaseStoreWait = resolve))
            }
            return result
        }
        const product = Alakazam.live.readProducts().find(item => item.index === 0)
        window.pendingStoreBuy = Alakazam.act.store.buy(product, 100, 1e9).catch(error => ({
            error: error.name
        }))
    })
    await game.waitForFunction(() => typeof window.releaseStoreWait === 'function')
    expect(await game.evaluate(() => Game.buyBulk)).toBe(100)
    await game.keyboard.press('Control+o')
    await expect(game.locator('#promptContentImportSave')).toHaveCount(1)
    await game.evaluate(async () => {
        window.releaseStoreWait()
        await window.pendingStoreBuy
        window.restoreStoreWait()
    })
    await expect(game.locator('#promptContentImportSave')).toHaveCount(1)
    expect(await game.evaluate(() => Game.Objects.Cursor.amount)).toBe(0)
    expect(await game.evaluate(() => [Game.buyMode, Game.buyBulk])).toEqual([1, 1])
})

test('pausing after gift wrapping retains the actual generated code', async ({ game }) => {
    await game.evaluate(() => {
        Game.cookies = 1e10
        Game.cookiesEarned = 1e10
        Game.prestige = 1e6
        Game.heavenlyChips = 1
        Game.heavenlyChipsSpent = 999999
        Game.Upgrades['Wrapping paper'].bought = 1
    })
    await publish(game)
    await game.evaluate(async () => {
        await Alakazam.save.connect()
        Alakazam.store.setSetting('enabled', true)
    })
    await expect.poll(() => game.evaluate(() => Alakazam.live.readGlobals().cookies)).toBe(1e10)
    await game.evaluate(() => {
        const schedule = window.setTimeout.bind(window)
        window.restoreGiftWait = () => (window.setTimeout = schedule)
        window.setTimeout = (callback, delay, ...args) => {
            if (delay === 350 && Alakazam.safety.ownsPrompt('gifts', 'GiftSendReady')) {
                window.generatedGiftCode = document.getElementById('giftCode').value
                window.releaseGiftWait = () => callback(...args)
                return schedule(() => {}, 0)
            }
            return schedule(callback, delay, ...args)
        }
        window.pendingGiftTick = Alakazam.registry.get('gifts').tick()
    })
    await game.waitForFunction(() => typeof window.releaseGiftWait === 'function')
    expect(await game.evaluate(() => window.generatedGiftCode.length)).toBeGreaterThan(0)
    expect(await game.evaluate(() => !!Game.hasBuff('Gifted out'))).toBe(true)
    await game.evaluate(async () => {
        Alakazam.store.setSetting('enabled', false)
        window.releaseGiftWait()
        await window.pendingGiftTick
        window.restoreGiftWait()
    })
    expect(await game.evaluate(() => Alakazam.gifts.heldCode()?.code === window.generatedGiftCode)).toBe(
        true
    )
})

for (const kind of ['name', 'clones']) {
    for (const replacement of ['same-run', 'family-owned', 'family-other', 'run-owned', 'run-other']) {
        test(`file import ${replacement} preserves ${kind} recovery ownership`, async ({ game }) => {
            const fixture = await game.evaluate(
                async ({ kind, replacement }) => {
                    // Page-world DOM coverage uses a test storage adapter; the extension
                    // project separately exercises the real Chrome storage bridge.
                    const disk = {}
                    window.chrome = {
                        storage: {
                            local: {
                                get(_keys, callback) {
                                    queueMicrotask(() => callback({ ...disk }))
                                },
                                set(values, callback) {
                                    Object.assign(disk, structuredClone(values))
                                    queueMicrotask(() => callback())
                                }
                            }
                        }
                    }
                    const original = [4, 5, 6, 1, 2, 3, 4]
                    const temporary = [6, 5, 6, 1, 2, 3, 4]
                    Game.Objects.You.amount = 1
                    Game.Objects.You.refresh()
                    Game.YouCustomizer.load((kind === 'clones' ? temporary : original).join(','))
                    Game.bakeryName = kind === 'name' ? 'Orteil' : 'Acceptance Original'
                    Game.bakeryNameRefresh()
                    Game.WriteSave()
                    await Alakazam.registry.get('saveWatch').tick()
                    await Alakazam.save.connect()
                    Alakazam.store.setSetting('enabled', true)
                    const who = Alakazam.identity.current()
                    const key = kind === 'name' ? 'bakeryNameRecovery' : 'cloneRecovery'
                    const mark =
                        kind === 'name'
                            ? {
                                  legacyId: who.legacyId,
                                  original: 'Acceptance Original',
                                  expected: 'Orteil'
                              }
                            : {
                                  legacyId: who.legacyId,
                                  original,
                                  expected: temporary,
                                  previous: original,
                                  history: [original, temporary]
                              }
                    Alakazam.store.set(key, mark)
                    await Alakazam.store.flush()
                    window.recoverImportedCosmetic = () =>
                        kind === 'name' ? Alakazam.achievements.recoverName() : Alakazam.clones.recover()
                    const sections = Alakazam.savefile.decode(Game.WriteSave(1)).split('|')
                    const run = sections[2].split(';')
                    if (replacement.startsWith('family-')) run[1] = String(Number(run[1]) - 86400000)
                    if (replacement.startsWith('run-')) run[4] = 'other-run-seed'
                    if (replacement.endsWith('-other')) {
                        if (kind === 'name') run[3] = 'Imported choice'
                        else run[5] = '2,4,1,0,3,5,7'
                    }
                    sections[2] = run.join(';')
                    const raw = escape(btoa(unescape(encodeURIComponent(sections.join('|')))) + '!END!')
                    await window.recoverImportedCosmetic()
                    return {
                        raw,
                        original,
                        temporary,
                        key,
                        stored: localStorage.getItem(Game.SaveTo),
                        journal: Alakazam.store.get(key)
                    }
                },
                { kind, replacement }
            )
            const current = () =>
                game.evaluate(
                    kind => (kind === 'name' ? Game.bakeryName : Game.YouCustomizer.currentGenes),
                    kind
                )
            const original = kind === 'name' ? 'Acceptance Original' : fixture.original
            const temporary = replacement.endsWith('-other')
                ? kind === 'name'
                    ? 'Imported choice'
                    : [2, 4, 1, 0, 3, 5, 7]
                : kind === 'name'
                  ? 'Orteil'
                  : fixture.temporary
            expect(await current()).toEqual(original)
            expect(await game.evaluate(key => !!Alakazam.store.get(key, null), fixture.key)).toBe(true)
            await game.locator('#prefsButton').click()
            await game.locator('#FileLoadInput').setInputFiles({
                name: 'temporary-cosmetic.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from(fixture.raw)
            })
            await expect.poll(current).toEqual(temporary)
            expect(await game.evaluate(() => Alakazam.safety.prompt())).toBe(null)
            expect(await game.evaluate(() => localStorage.getItem(Game.SaveTo))).toBe(fixture.stored)
            await game.evaluate(() => window.recoverImportedCosmetic())
            expect(await current()).toEqual(replacement === 'same-run' ? original : temporary)
            if (replacement !== 'same-run') {
                expect(await game.evaluate(key => Alakazam.store.get(key), fixture.key)).toEqual(
                    fixture.journal
                )
            }
        })
    }
}
