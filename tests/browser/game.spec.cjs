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
