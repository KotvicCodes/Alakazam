const { test } = require('node:test')
const assert = require('node:assert')
const { boot, sleep, waitFor } = require('./harness')
const fx = require('./fixtures')
const { El } = require('./dom')

const HOUR = 3600e3

//! Store controls

test('sumPrice matches the game to within rounding', () => {
    const h = boot({ game: { bank: 1e9 } })
    const g = h.game
    for (const [i, n] of [
        [0, 1],
        [0, 10],
        [0, 100],
        [2, 10],
        [5, 100]
    ]) {
        const est = h.A.act.store.sumPrice(g.unitPrice(i), n)
        const real = g.sumPrice(i, n)
        assert.ok(
            Math.abs(est - real) / real < 0.02,
            `${g.BUILDINGS[i][0]} x${n}: estimated ${est}, real ${real}`
        )
    }
})

test('withBulk restores the store even when the body throws', async () => {
    const h = boot({ game: { bank: 1e6 } })
    const store = h.A.act.store
    assert.equal(store.currentMode(), 'buy')
    assert.equal(store.currentAmount(), 1)

    await assert.rejects(
        store.withBulk('sell', 100, () => {
            assert.equal(store.currentMode(), 'sell')
            assert.equal(store.currentAmount(), 100)
            throw new Error('boom')
        })
    )

    assert.equal(store.currentMode(), 'buy')
    assert.equal(store.currentAmount(), 1)
    assert.equal(h.game.state.mode, 'buy')
    assert.equal(h.game.state.amount, 1)
})

test('a bulk buy over budget is refused rather than made', async () => {
    const h = boot({ game: { bank: 1e6 } })
    const products = h.A.live.readProducts()
    const result = await h.A.act.store.buy(products[1], 100, 500)
    assert.equal(result.bought, false)
    assert.match(result.reason, /budget/)
    assert.equal(h.A.act.store.currentAmount(), 1)
})

test('without bulk controls, buying one still works and bulk is refused', async () => {
    const h = boot({ game: { bank: 1e6 } })
    for (const id of [
        'storeBulkBuy',
        'storeBulkSell',
        'storeBulk1',
        'storeBulk10',
        'storeBulk100',
        'storeBulkMax'
    ]) {
        const el = h.game.doc.getElementById(id)
        el.parent.children = el.parent.children.filter(x => x !== el)
    }
    assert.equal(h.A.act.store.available(), false)
    const products = h.A.live.readProducts()
    assert.equal((await h.A.act.store.buy(products[0], 1, Infinity)).bought, true)
    assert.equal((await h.A.act.store.buy(products[0], 10, Infinity)).bought, false)
})

test('selling works and leaves the store back in buy mode', async () => {
    const h = boot({ game: { bank: 1e6, owned: [50, 0, 0, 0, 0, 0, 0, 0] } })
    const products = h.A.live.readProducts()
    await h.A.act.store.sell(products[0], 10)
    assert.equal(h.game.state.owned[0], 40)
    assert.equal(h.A.act.store.currentMode(), 'buy')
})

//! Live measurement

test('the live pass reads prices without touching the tooltip', () => {
    const h = boot({ game: { bank: 5000, cps: 42, owned: [10, 5, 1, 0, 0, 0, 0, 0] } })
    const snap = h.A.live.snapshot()
    assert.equal(snap.cookies, 5000)
    assert.equal(snap.cps, 42)
    assert.equal(snap.products[0].name, 'Cursor')
    assert.equal(snap.products[0].index, 0)
    assert.equal(h.game.tooltip.innerText, '', 'live measurement must not populate the tooltip')
})

test('shimmer types are read from the class the game actually uses', () => {
    const h = boot({})
    const shimmers = h.game.doc.getElementById('shimmers')
    shimmers.append(
        new El('div', {
            class: 'shimmer goldenCookie',
            style: { backgroundImage: 'url(img/goldCookie.png)' }
        }),
        new El('div', {
            class: 'shimmer goldenCookie',
            style: { backgroundImage: 'url(img/wrathCookie.png)' }
        }),
        new El('div', { class: 'shimmer reindeer', style: { backgroundImage: 'url(img/reindeer.png)' } })
    )
    const read = h.A.live.readShimmers()
    assert.equal(read[0].type, 'goldenCookie')
    assert.equal(read[0].wrath, false)
    assert.equal(read[1].wrath, true, 'a wrath cookie is only distinguishable by its sprite')
    assert.equal(read[2].type, 'reindeer')
})

test('wrinklers are canvas drawn, so there is nothing to find', () => {
    const h = boot({})
    assert.deepEqual(h.A.live.readWrinklers().elements, [])
})

//! Grimoire

test('max magic follows the source formula', () => {
    const G = boot({}).A.grimoire
    assert.equal(G.maxMagic(1, 1), 5)
    assert.equal(G.maxMagic(38, 1), 31)
    assert.equal(G.maxMagic(530, 1), 100)
    assert.ok(G.maxMagic(100, 10) > G.maxMagic(100, 1), 'levels raise capacity')
})

test('spell costs scale with capacity', () => {
    const G = boot({}).A.grimoire
    const fthof = G.SPELLS[1]
    assert.equal(G.spellCost(fthof, 20), 22)
    assert.equal(G.spellCost(fthof, 100), 70)
})

test('magic regenerates faster when the bar is fuller', () => {
    const G = boot({}).A.grimoire
    assert.ok(G.regenPerSecond(90, 100) > G.regenPerSecond(10, 100))
})

test('more wizard towers make the casting cycle longer', () => {
    const G = boot({}).A.grimoire
    assert.ok(G.cycleSeconds(600, 1) > G.cycleSeconds(100, 1))
    assert.match(G.towerAdvice(38, 1).note, /slower/)
})

//! Sugar lumps

function lumpSave(hours, lumps, levels, amounts) {
    return fx.save({
        lumps,
        lumpsTotal: 500,
        lumpT: Date.now() - hours * HOUR,
        lumpType: 2,
        levels,
        amounts
    }).raw
}

const OWNED = { 0: 100, 2: 30, 5: 5, 6: 3, 7: 2 }

test('lump ripeness is derived from the growth timestamp', () => {
    const at = h => h.A.lumps.lumpState()
    assert.equal(at(boot({ save: lumpSave(19, 1, {}, OWNED) })).ripe, false)
    assert.equal(at(boot({ save: lumpSave(21, 1, {}, OWNED) })).mature, true)
    assert.equal(at(boot({ save: lumpSave(21, 1, {}, OWNED) })).ripe, false)
    assert.equal(at(boot({ save: lumpSave(23.5, 1, {}, OWNED) })).ripe, true)
})

test('lumps buy the minigame unlocks first', () => {
    const h = boot({ save: lumpSave(5, 1, {}, OWNED) })
    assert.match(h.A.lumps.nextSpend(1).why, /Grimoire/)
})

test('lumps skip a building that has not been built', () => {
    const h = boot({ save: lumpSave(5, 5, {}, { 0: 100, 2: 30, 5: 5, 6: 3 }) })
    assert.match(h.A.lumps.nextSpend(5).why, /Pantheon/)
})

test('lumps are banked at a hundred rather than spent', () => {
    const done = { 7: 1, 6: 1, 2: 9, 5: 1, 0: 12 }
    assert.equal(boot({ save: lumpSave(5, 60, done, OWNED) }).A.lumps.nextSpend(60), null)
    assert.ok(boot({ save: lumpSave(5, 150, done, OWNED) }).A.lumps.nextSpend(150))
})

//! Garden

test('garden data covers every plant and recipe', () => {
    const P = boot({}).A.data.plants
    assert.equal(P.PLANTS.length, 34)
    assert.equal(P.byKey('bakerWheat').id, 0)
    assert.equal(P.byId(13).key, 'meddleweed')
    assert.ok(P.recipesFor('cronerice').length > 0)
})

test('a mutation is only reachable when its parents are unlocked and it fits', () => {
    const P = boot({}).A.data.plants
    const cronerice = P.recipesFor('cronerice')[0]
    assert.equal(P.reachable(cronerice, ['bakerWheat', 'thumbcorn'], 36), true)
    assert.equal(P.reachable(cronerice, ['bakerWheat'], 36), false)
    const everdaisy = P.recipesFor('everdaisy')[0]
    assert.equal(
        P.reachable(
            everdaisy,
            P.PLANTS.map(p => p.key),
            4
        ),
        false,
        'needs six tiles'
    )
})

test('the garden picks the best reachable seed as its goal', () => {
    const h = boot({
        save: fx.save({
            levels: { 2: 1 },
            amounts: { 2: 30 },
            minigames: { 2: fx.garden({ unlocked: [0, 1] }) }
        }).raw
    })
    const state = h.A.garden.state()
    assert.equal(state.unlockedCount, 2)
    assert.equal(h.A.garden.nextGoal(state).plant.key, 'cronerice')
})

test('a complete seed log has no goal left', () => {
    const all = Array.from({ length: 34 }, (_, i) => i)
    const h = boot({
        save: fx.save({
            levels: { 2: 9 },
            amounts: { 2: 30 },
            minigames: { 2: fx.garden({ unlocked: all }) }
        }).raw
    })
    const state = h.A.garden.state()
    assert.equal(state.complete, true)
    assert.equal(h.A.garden.nextGoal(state), null)
})

//! Market

test('the hidden trend mode drives the signal', () => {
    const goods = [
        { val: 5, mode: 3 },
        { val: 50, mode: 4, stock: 10 },
        { val: 50, mode: 5, stock: 10 }
    ]
    const h = boot({
        save: fx.save({ levels: { 5: 10 }, amounts: { 5: 20 }, minigames: { 5: fx.market({ goods }) } })
            .raw
    })
    const s = h.A.market.state()
    assert.equal(s.goods[0].signal, 'strong buy')
    assert.equal(s.goods[1].signal, 'strong sell')
    assert.equal(s.goods[2].signal, 'hold', 'chaotic has no usable bias')
})

test('trading is on by default and can be switched off', () => {
    const h = boot({
        save: fx.save({ levels: { 5: 10 }, amounts: { 5: 20 }, minigames: { 5: fx.market({}) } }).raw
    })
    assert.equal(h.A.market.state().trading, true)
    h.A.store.setSetting('marketTrading', false)
    assert.equal(h.A.market.state().trading, false)
})

test('resting value rises with the bank level', () => {
    const M = boot({}).A.market
    assert.equal(M.restingValue(0, 10), 19)
    assert.equal(M.restingValue(16, 10), 179)
})

//! Scheduler

test('a module that keeps throwing is switched off and the rest keep running', async () => {
    const h = boot({})
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    h.A.registry.register({
        name: 'boom',
        interval: 30,
        tick() {
            throw new Error('kaboom')
        }
    })
    await sleep(400)
    const stats = h.A.scheduler.stats()
    assert.equal(stats.find(m => m.name === 'boom').disabled, true)
    assert.ok(stats.find(m => m.name === 'shimmers').ran > 1)
    h.A.scheduler.stop()
})

test('the master switch stops modules but never the HUD', async () => {
    const h = boot({})
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(150)
    const ranCount = name => h.A.scheduler.stats().find(m => m.name === name).ran

    h.A.store.setSetting('enabled', false)

    // a tick already in flight is allowed to finish, and a drain runs for up to
    // its whole time slice. rather than guess at how long that takes on a loaded
    // machine, wait until the count stops moving.
    let previous = -1
    let current = ranCount('purchase')
    while (current !== previous) {
        previous = current
        await sleep(300)
        current = ranCount('purchase')
    }

    const hudBefore = ranCount('hud')
    await sleep(400)

    assert.equal(ranCount('purchase'), current, 'purchase stays stopped once settled')
    assert.ok(ranCount('hud') > hudBefore, 'the HUD is how you turn everything back on')
    h.A.scheduler.stop()
})

//! The store's upgrade sections

const SECTIONED_CRATES = [
    { name: 'Reinforced index finger', price: 100, body: 'clicking gains +1% of your CpS' },
    {
        name: 'Specialized chocolate chips',
        price: 200,
        body: 'cookie production multiplier +1%',
        section: 'techUpgrades'
    },
    {
        name: 'Elder Pledge',
        price: 300,
        body: 'pledge to the elders, ends the grandmapocalypse',
        section: 'toggleUpgrades'
    },
    {
        name: 'Vaulted thing',
        price: 400,
        body: 'the player put this one away on purpose',
        section: 'vaultUpgrades'
    }
]

test('research upgrades are part of the store, toggles and the vault are not', () => {
    // #techUpgrades was never read, so research was invisible: not catalogued,
    // not scored, never bought, however long a run went on
    const h = boot({ game: { crates: SECTIONED_CRATES } })
    const crates = h.A.live.readUpgradeCrates()

    const ids = crates.map(c => c.key).sort()
    assert.deepEqual(ids, ['id:0', 'id:1'], 'the buyable sections are #upgrades and #techUpgrades')
})

test('crates are keyed by the game id, which is unique across sections', () => {
    // element ids restart at upgrade0 in every section, so #upgrades and
    // #techUpgrades each contain one. keying on that would collapse the two into
    // a single catalog entry and price one of them wrong.
    const h = boot({ game: { crates: SECTIONED_CRATES } })
    const crates = h.A.live.readUpgradeCrates()

    assert.equal(crates.length, 2)
    assert.equal(crates[0].element.id, 'upgrade0')
    assert.equal(crates[1].element.id, 'upgrade0', 'both sections number their crates from zero')
    assert.notEqual(crates[0].key, crates[1].key, 'but they must not share a catalog key')
})

test('the grandmapocalypse is never started by accident', () => {
    const c = boot({}).A.catalog
    // a plain research multiplier
    assert.equal(
        c.classifyUpgrade('cookie production multiplier +1%', 'Specialized chocolate chips'),
        'buy'
    )
    // the three that change what game is being played
    for (const name of ['One mind', 'Communal brainsweep', 'Elder Pact']) {
        assert.equal(
            c.classifyUpgrade('grandmas are twice as efficient', name),
            'skip',
            `${name} must not be bought on its own`
        )
    }
})

test('a research upgrade gets catalogued and bought like any other', async () => {
    const h = boot({ game: { bank: 1e5, crates: SECTIONED_CRATES } })
    await h.A.store.ready('t')
    await h.A.scheduler.start()

    const bought = () => h.game.state.log.filter(l => l.indexOf('buy upgrade') === 0)
    await waitFor(() => bought().some(l => l.indexOf('Specialized chocolate chips') !== -1))
    h.A.scheduler.stop()

    const log = bought()
    assert.ok(
        log.some(l => l.indexOf('Specialized chocolate chips') !== -1),
        `research should have been bought, log was ${JSON.stringify(log)}`
    )
    assert.equal(
        log.some(l => l.indexOf('Elder Pledge') !== -1 || l.indexOf('Vaulted thing') !== -1),
        false,
        'neither a toggle nor a vaulted upgrade may ever be bought'
    )
})

//! HUD

test('dragging the panel ignores the autoclicker synthetic events', async () => {
    const h = boot({})
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(120)

    const panel = h.game.doc.getElementById('alakazam-hud')
    const head = h.game.doc.getElementById('alakazam-hud-head')
    assert.ok(panel && head, 'the panel should have been built')

    const trusted = (type, x, y) => {
        const e = {
            type,
            pointerId: 1,
            button: 0,
            isTrusted: true,
            clientX: x,
            clientY: y,
            preventDefault() {}
        }
        head.dispatchEvent(e)
        return e
    }

    trusted('pointerdown', 700, 400)
    trusted('pointermove', 720, 420)
    const placed = panel.style.left

    // the autoclicker fires untrusted pointer events constantly; they must not move it
    head.dispatchEvent({
        type: 'pointermove',
        pointerId: 1,
        button: 0,
        isTrusted: false,
        clientX: 5,
        clientY: 5
    })
    assert.equal(panel.style.left, placed, 'synthetic moves must not drag the panel')

    trusted('pointerup', 720, 420)
    await h.A.store.flush()
    assert.ok(h.disk['legacy:t'].hudPosition, 'the position should stick')
    h.A.scheduler.stop()
})

//! Achievement hunt

function achievementUI(h, { stats = true, log = true, bakery = true, tiny = true, slot = true } = {}) {
    const d = h.game.doc
    const mk = (id, cls) => {
        const e = new El('div', { id, class: cls || '' })
        d.body.append(e)
        return e
    }
    if (stats) {
        const b = mk('statsButton')
        b.append(new El('div'))
        const general = mk('statsGeneral')
        if (tiny) {
            const listing = new El('div', { class: 'listing' })
            const price = new El('div', { class: 'price' })
            price.append(new El('div', { class: 'tinyCookie' }))
            listing.append(price)
            general.append(listing)
        }
        if (slot) {
            const s = new El('div', { class: 'achievement' })
            s.setAttribute('data-id', '204')
            d.body.append(s)
        }
    }
    if (log) {
        const b = mk('logButton')
        b.append(new El('div'))
        const olden = mk('oldenDays')
        olden.append(new El('div', { class: 'icon' }))
    }
    if (bakery) {
        mk('bakeryName')
        mk('bakeryNameInput')
        mk('promptOption0')
    }
    mk('commentsText1')
}

test('a routine that finds nothing does not reopen the menu every tick', async () => {
    const disk = {}
    // the stats menu is there but has neither the tiny cookie nor the slot
    const h = boot({ disk })
    achievementUI(h, { tiny: false, slot: false })
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(4000)
    h.A.scheduler.stop()

    // it ran, so it counts, but the cooldown means it ran once rather than
    // once every three seconds
    assert.equal(h.A.achievements.attempts('statsPanel'), 1)
})

test('a routine that finds its target is retired immediately', async () => {
    const h = boot({})
    achievementUI(h)
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(3000)
    h.A.scheduler.stop()
    assert.equal(h.A.achievements.giveUp('statsPanel'), true, 'no reason to ever run it again')
})

test('a routine whose menu is not drawn yet costs nothing and is retried', async () => {
    const disk = {}
    let h = boot({ disk })
    achievementUI(h, { stats: false })
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(1500)
    assert.equal(h.A.achievements.attempts('statsPanel'), 0, 'never opened, so never attempted')
    h.A.scheduler.stop()
    await h.A.store.flush()

    h = boot({ disk })
    achievementUI(h)
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(3000)
    assert.ok(h.A.achievements.attempts('statsPanel') > 0, 'runs once the menu exists')
    h.A.scheduler.stop()
})

test('a routine is given up on after a few real attempts', async () => {
    const disk = { 'legacy:t': { 'attempts:statsPanel': 4 } }
    const h = boot({ disk })
    achievementUI(h)
    await h.A.store.ready('t')
    assert.equal(h.A.achievements.giveUp('statsPanel'), true)
    await h.A.scheduler.start()
    await sleep(300)
    assert.ok(!h.debug().achievements || !h.debug().achievements.waiting.includes('statsPanel'))
    h.A.scheduler.stop()
})

test('ticker clicks are only counted when the news actually changes', async () => {
    const h = boot({})
    const d = h.game.doc
    const comments = new El('div', { id: 'comments' })
    const text = new El('div', { id: 'commentsText' })
    const layer1 = new El('div', { id: 'commentsText1', class: 'commentsText', text: 'news 0' })
    text.append(layer1)
    comments.append(text)
    d.body.append(comments)

    // the game advances the news on a registered click, and only one per item
    let item = 0
    let lastAt = 0
    comments.addEventListener('click', () => {
        const now = Date.now()
        if (now - lastAt < 100) return // a second click on the same item does nothing
        lastAt = now
        item++
        layer1.text = 'news ' + item
    })

    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(3000)
    h.A.scheduler.stop()

    const counted = h.A.store.get('tickerClicks', 0)
    assert.ok(counted > 0, 'should have registered some clicks')
    assert.equal(counted, item, `counted ${counted} but the game advanced ${item} times`)
})

test('the ticker gives up if no click ever registers', async () => {
    const h = boot({ disk: { 'legacy:t': { tickerTries: 500, tickerClicks: 0 } } })
    const comments = new El('div', { id: 'comments', text: 'static' })
    h.game.doc.body.append(comments)
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(1200)
    h.A.scheduler.stop()
    assert.equal(comments.events.filter(e => e === 'click').length, 0, 'should have stopped poking it')
})

//! Version reporting

test('no version number is hardcoded into the popup markup', () => {
    const fs = require('fs')
    const path = require('path')
    const root = path.join(__dirname, '..')
    const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8')
    // it used to say "v1.0" forever, ten releases after that stopped being true
    assert.equal(/v\d+\.\d+/.test(html), false, 'the popup must read its version from the manifest')
    assert.match(fs.readFileSync(path.join(root, 'popup.js'), 'utf8'), /getManifest\(\)/)
})

test('the manifest and package versions stay in step', () => {
    const fs = require('fs')
    const path = require('path')
    const root = path.join(__dirname, '..')
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    assert.equal(manifest.version, pkg.version)
})

//! Click measurement

test('every module survives the manifest load order', async () => {
    // the clicks module once read the parsed save but was listed before the file
    // that defines it, so it threw on every tick and the scheduler switched it
    // off. Nothing surfaced except a zero in the panel.
    const h = boot({})
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(1200)
    const broken = h.A.scheduler.stats().filter(m => m.disabled || m.failures > 0)
    assert.deepEqual(
        broken.map(m => `${m.name}: ${m.lastError}`),
        [],
        'no module may fail on a clean boot'
    )
    h.A.scheduler.stop()
})

test('click income comes from the game totals, not from guessing at the bank', async () => {
    // two saves a minute apart: 600 clicks earning 6000 cookies
    const first = fx.save({ cookieClicks: 1000, handmadeCookies: 10000 }).raw
    const second = fx.save({ cookieClicks: 1600, handmadeCookies: 16000 }).raw

    let current = first
    const h = boot({})
    h.ctx.localStorage.getItem = key => (key === 'CookieClickerGame' ? current : null)

    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(1200)
    assert.equal(h.A.clicks.measured(), false, 'one reading is not a rate')

    current = second
    const measured = await waitFor(() => h.A.clicks.measured())
    h.A.scheduler.stop()

    assert.equal(measured, true, 'the second save should have produced a sample')
    // 6000 cookies over roughly three seconds of wall clock in the test
    assert.ok(h.A.clicks.clickCps() > 0, 'income should be measured')
    // 6000 cookies across 600 clicks, whatever the elapsed time was
    assert.ok(
        Math.abs(h.A.clicks.cookiesPerClick() - 10) < 0.001,
        `cookies per click was ${h.A.clicks.cookiesPerClick()}`
    )
})

test('clicking upgrades are valued off the registered rate, not the dispatched one', () => {
    const S = boot({}).A.strategy
    const base = {
        cps: 1000,
        cookies: 1e6,
        buildings: [{ name: 'Cursor', owned: 10, price: 100, perUnitCps: 1, baseCps: 1 }],
        upgrades: []
    }
    const upgrade = { description: 'Clicking gains +1% of your CpS.' }

    // three registered clicks a second: 3 x 1000 x 1%
    assert.equal(S.upgradeDeltaCps(upgrade, { ...base, clicksPerSecond: 3 }), 30)
    // the dispatched figure would have valued the same upgrade a thousand times higher
    assert.equal(S.upgradeDeltaCps(upgrade, { ...base, clicksPerSecond: 3000 }), 30000)
})
