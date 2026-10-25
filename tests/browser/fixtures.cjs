const { test: base, expect } = require('@playwright/test')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const pin = require('./game-pin.json')
const root = resolve(__dirname, '../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'))
const origin = `http://127.0.0.1:${process.env.ALAKAZAM_TEST_PORT || 4173}`

async function localOnly(context) {
    await context.route('**/*', route => {
        const url = new URL(route.request().url())
        return url.origin === origin || url.protocol === 'chrome-extension:'
            ? route.continue()
            : route.abort()
    })
}

async function openGame(page, language = 'EN') {
    await page.addInitScript(language => {
        localStorage.setItem('CookieClickerLang', language)
    }, language)
    await page.goto(origin)
    const ready = () => window.Game?.ready && Game.ObjectsById?.length === 20
    await page.waitForFunction(ready)
    expect(await page.evaluate(() => String(Game.version))).toBe(pin.version)
    await page.evaluate(() => {
        Game.prefs.autosave = 0
        Game.prefs.volume = 0
        Game.volume = 0
        Game.ClosePrompt()
        Game.WriteSave()
    })
    // A fresh game schedules a delayed LoadSave retry. It can reload the save
    // above over later unsaved fixture changes, including removing buffs. Start
    // a new document with that real save so startup succeeds without a retry.
    await page.reload()
    await page.waitForFunction(ready)
    await page.evaluate(() => Game.ClosePrompt())
}

async function loadAlakazam(page) {
    // The game project exercises actual DOM/events but deliberately shares the
    // page world. Only the extension project makes isolated-world claims.
    for (const file of manifest.content_scripts[0].js) {
        if (file === 'src/main.js') continue
        await page.addScriptTag({ path: resolve(root, file) })
    }
    await page.evaluate(async () => {
        await Alakazam.store.ready('browser-fixture')
        Alakazam.store.setSetting('enabled', false)
    })
}

async function minigame(page, name) {
    await page.evaluate(name => {
        const building = Game.Objects[name]
        building.amount = Math.max(building.amount, 1)
        building.highest = Math.max(building.highest, 1)
        building.level = Math.max(building.level, 1)
        Game.LoadMinigames()
    }, name)
    await page.waitForFunction(name => Game.Objects[name].minigameLoaded, name)
    await page.evaluate(name => Game.Objects[name].switchMinigame(1), name)
}

async function researchTooltip(page, name = 'One mind') {
    await page.evaluate(name => {
        const upgrade = Game.Upgrades[name]
        upgrade.unlocked = 1
        Game.UpgradesInStore = [upgrade]
        Game.RebuildUpgrades()
    }, name)
    await page.locator('#upgrade0').hover()
    return page.locator('#tooltip')
}

async function buffTooltip(page, name = 'frenzy') {
    await page.evaluate(name => Game.gainBuff(name, 77, 7), name)
    await page.locator('#buffs .crate').first().hover()
    return page.locator('#tooltip')
}

async function publish(page) {
    return page.evaluate(async () => {
        Game.WriteSave()
        await window.Alakazam?.registry.get('saveWatch').tick()
        return localStorage.getItem(Game.SaveTo)
    })
}

async function lumpReserve(page) {
    await page.evaluate(() => {
        Game.lumps = 102
        Game.lumpsTotal = 200
        for (const [name, level] of Object.entries({
            'Wizard tower': 1,
            Temple: 1,
            Bank: 1,
            Farm: 9,
            Cursor: 12
        })) {
            Game.Objects[name].level = level
        }
        Game.Objects['Wizard tower'].totalCookies = 1e30
    })
    return publish(page)
}

async function stockCapacity(page) {
    await minigame(page, 'Bank')
    const capacity = await page.evaluate(() => {
        const market = Game.Objects.Bank.minigame
        market.officeLevel = 0
        Game.cookies = 1e30
        Game.cookiesPsRawHighest = 100
        for (const good of market.goodsById) {
            good.val = 50
            good.mode = 5
            good.stock = 0
            good.last = 0
        }
        const [full, available] = market.goodsById
        full.building.highest = 81
        full.building.level = 1
        full.val = 1
        full.mode = 3
        full.stock = market.getGoodMaxStock(full)
        available.building.highest = 0
        available.building.level = 1
        available.val = 5
        available.mode = 3
        market.toRedraw = 2
        market.draw()
        return { full: full.stock, availableCapacity: market.getGoodMaxStock(available) }
    })
    await publish(page)
    return capacity
}

async function cosmeticChange(page, saved = [1, 2, 3, 1, 2, 4, 5], live = [2, 3, 4, 2, 3, 6, 7]) {
    await page.evaluate(saved => {
        Game.Objects.You.amount = 1
        Game.YouCustomizer.load(saved.join(','))
    }, saved)
    const raw = await publish(page)
    await page.evaluate(live => Game.YouCustomizer.load(live.join(',')), live)
    return { saved, live, raw }
}

async function transition(page, stage) {
    // Drive the game's own transitions, shortening only their animation tail.
    await page.evaluate(stage => {
        if (stage === 'ascend-prompt') Game.Ascend()
        else if (stage === 'intro') {
            Game.ClosePrompt()
            Game.Ascend(1)
        } else if (stage === 'ascending') {
            Game.AscendTimer = Game.AscendDuration
            Game.UpdateAscendIntro()
        } else if (stage === 'reincarnate-prompt') Game.Reincarnate()
        else if (stage === 'reincarnating') {
            Game.ClosePrompt()
            Game.Reincarnate(1)
        } else if (stage === 'playing') {
            Game.ReincarnateTimer = Game.ReincarnateDuration
            Game.UpdateReincarnateIntro()
        } else throw new Error('Unknown transition stage: ' + stage)
    }, stage)
}

const test = base.extend({
    game: async ({ page, context }, use) => {
        await localOnly(context)
        await openGame(page)
        await loadAlakazam(page)
        await use(page)
    }
})
module.exports = {
    test,
    expect,
    root,
    manifest,
    origin,
    localOnly,
    openGame,
    loadAlakazam,
    minigame,
    researchTooltip,
    buffTooltip,
    publish,
    lumpReserve,
    stockCapacity,
    cosmeticChange,
    transition
}
