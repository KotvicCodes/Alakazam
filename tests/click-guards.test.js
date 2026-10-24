//! Regressions from the round-two diagnostic, asserting correct behavior
const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { boot } = require('./harness')
const fx = require('./fixtures')

function clock(h, now = Date.now()) {
    h.ctx.testNow = now
    vm.runInContext('Date.now = () => testNow', h.ctx)
    return ms => (h.ctx.testNow += ms)
}

function meter() {
    const h = boot()
    const advance = clock(h)
    let revision = 1
    let current = h.A.savefile.parse(fx.save().text)
    current.run.lastDate = h.ctx.testNow
    let meta = {
        revision,
        savedAt: h.ctx.testNow,
        changedAt: h.ctx.testNow,
        runId: 'run-a',
        trusted: true
    }
    h.A.save.get = () => current
    h.A.save.stats = () => meta
    const tick = () => {
        h.A.registry.get('clicks').tick()
        return h.A.clicks.stats()
    }
    function write(scalars, extra = {}) {
        current = { ...current, scalars: { ...current.scalars, ...scalars } }
        meta = {
            ...meta,
            revision: ++revision,
            savedAt: h.ctx.testNow,
            changedAt: h.ctx.testNow,
            ...extra
        }
        return tick()
    }
    tick()
    return { h, advance, tick, write }
}

for (const atPoint of [false, true]) {
    test(`pointer activation fields and event order${atPoint ? ' at canvas coordinates' : ''}`, () => {
        const h = boot()
        const target = h.game.doc.getElementById('bigCookie')
        const events = []
        const types = [
            'pointermove',
            'mousemove',
            'pointerdown',
            'mousedown',
            'pointerup',
            'mouseup',
            'click'
        ]
        for (const type of types) target.addEventListener(type, event => events.push(event))
        if (atPoint) h.A.input.simulateClickAt(target, 3, 7)
        else h.A.input.simulateClick(target)
        assert.deepEqual(
            events.map(e => e.type),
            types
        )
        assert.deepEqual(
            events.map(e => e.detail),
            [0, 0, 0, 1, 0, 1, 1]
        )
        assert.deepEqual(
            events.map(e => e.buttons),
            [0, 0, 1, 1, 0, 0, 0]
        )
        assert.deepEqual(
            events.map(e => e.button),
            [-1, 0, 0, 0, 0, 0, 0]
        )
        for (const event of events) {
            assert.equal(event.clientX, atPoint ? 3 : 10)
            assert.equal(event.clientY, atPoint ? 7 : 10)
            assert.equal(event.bubbles, true)
            assert.equal(event.cancelable, true)
            assert.equal(event.composed, true)
            assert.equal(event.isTrusted, false)
        }
        assert.equal(events[2].pointerType, 'mouse')
        assert.equal(events[2].pressure, 0.5)
        assert.equal(events[4].pressure, 0)
    })
}

test('keyboard activation preserves detail zero and emits no pointer events', () => {
    const h = boot()
    const target = h.game.doc.getElementById('bigCookie')
    let click
    target.addEventListener('click', e => (click = e))
    h.A.input.simulateClick(target, { source: 'keyboard' })
    assert.deepEqual(target.events, ['click'])
    assert.equal(click.detail, 0)
    assert.equal(click.buttons, 0)
    assert.equal(click.clientX, 0)
    assert.equal(click.clientY, 0)
})

test('mouse-only browsers receive mouse events without fake pointer phases', () => {
    const h = boot()
    h.ctx.PointerEvent = undefined
    const target = h.game.doc.getElementById('bigCookie')
    h.A.input.simulateClick(target)
    assert.deepEqual(target.events, ['mousemove', 'mousedown', 'mouseup', 'click'])
})

test('configured pacing works across frame rates and does not catch up in bursts', () => {
    const h = boot()
    const advance = clock(h)
    h.A.store.setSetting('clicksPerSecond', 10)
    const target = h.game.doc.getElementById('bigCookie')
    const tick = () => h.A.registry.get('autoclick').tick()
    for (let i = 0; i < 100; i++) tick()
    assert.equal(target.events.filter(e => e === 'click').length, 1)
    advance(99)
    tick()
    assert.equal(target.events.filter(e => e === 'click').length, 1)
    advance(1)
    tick()
    advance(10000)
    tick()
    assert.equal(target.events.filter(e => e === 'click').length, 3)
    h.A.store.setSetting('clicksPerSecond', 0)
    advance(10000)
    tick()
    assert.equal(target.events.filter(e => e === 'click').length, 3)
})

test('startup estimates follow configuration and never claim measured registration', () => {
    const h = boot()
    assert.equal(h.A.clicks.measured(), false)
    assert.equal(h.A.clicks.clicksPerSecond(), 15)
    assert.equal(h.A.clicks.stats().registeredPerSecond, null)
    h.A.store.setSetting('clicksPerSecond', 9)
    assert.equal(h.A.clicks.clicksPerSecond(), 9)
    h.A.store.setSetting('autoclick', false)
    assert.equal(h.A.clicks.clicksPerSecond(), 0)
})

test('registration uses saved time even when observation is delayed', () => {
    const m = meter()
    const start = m.h.ctx.testNow
    m.advance(90000)
    const stats = m.write({ cookieClicks: 600, handmadeCookies: 600000 }, { savedAt: start + 60000 })
    assert.equal(stats.clickCps, 10000)
    assert.equal(stats.registeredPerSecond, 10)
    assert.equal(stats.cookiesPerClick, 1000)
    assert.equal(stats.samples, 1)
    assert.equal(stats.dispatchedPerSecond, 0)
    assert.equal(m.h.A.clicks.effectiveCps(200), 10200)
})

for (const transition of [
    'counter decrease',
    'new run with higher counters',
    'import',
    'backward save time'
]) {
    test(`all run estimates reset after ${transition}`, () => {
        const m = meter()
        m.advance(60000)
        m.write({ cookieClicks: 600, handmadeCookies: 600000 })
        m.h.A.clicks.record(30)
        m.advance(1000)
        assert.ok(m.tick().dispatchedPerSecond > 0)
        m.advance(1000)
        const next =
            transition === 'counter decrease'
                ? { cookieClicks: 0, handmadeCookies: 0 }
                : { cookieClicks: 1200, handmadeCookies: 1200000 }
        const meta =
            transition === 'new run with higher counters' || transition === 'import'
                ? { runId: transition }
                : transition === 'backward save time'
                  ? { savedAt: m.h.ctx.testNow - 30000 }
                  : {}
        const stats = m.write(next, meta)
        assert.equal(stats.clickCps, 0)
        assert.equal(stats.registeredPerSecond, null)
        assert.ok(Number.isNaN(stats.cookiesPerClick))
        assert.equal(stats.samples, 0)
        assert.equal(stats.measured, false)
        assert.equal(stats.dispatchedPerSecond, 0)
        assert.equal(m.h.A.clicks.effectiveCps(200), 200)
    })
}

test('cached polling does not imply inactivity; a newly saved zero interval does', () => {
    const m = meter()
    m.advance(60000)
    m.write({ cookieClicks: 600, handmadeCookies: 600000 })
    m.advance(60000)
    assert.equal(m.tick().clickCps, 10000)
    const stats = m.write({ cookieClicks: 600, handmadeCookies: 600000 })
    assert.equal(stats.clickCps, 0)
    assert.equal(stats.registeredPerSecond, 0)
    assert.equal(stats.measured, true)
    assert.ok(Number.isNaN(stats.cookiesPerClick))
    assert.equal(m.h.A.clicks.clicksPerSecond(), 0)
    m.advance(60000)
    assert.equal(m.write({ cookieClicks: 600, handmadeCookies: 600000 }).clickCps, 0)
})

test('ten minutes without a new save invalidates stale income, then recovers', () => {
    const m = meter()
    m.advance(60000)
    m.write({ cookieClicks: 600, handmadeCookies: 600000 })
    m.advance(600000)
    const expired = m.tick()
    assert.equal(expired.clickCps, 0)
    assert.equal(expired.measured, false)
    assert.equal(m.h.A.clicks.clicksPerSecond(), 0)
    assert.match(expired.reason, /expired/)
    m.write({ cookieClicks: 600, handmadeCookies: 600000 })
    m.advance(60000)
    assert.equal(m.write({ cookieClicks: 600, handmadeCookies: 600000 }).registeredPerSecond, 0)
})

test('untrusted saves immediately invalidate all previous estimates', () => {
    const m = meter()
    m.advance(60000)
    m.write({ cookieClicks: 600, handmadeCookies: 600000 })
    const stats = m.write({}, { trusted: false })
    assert.equal(stats.clickCps, 0)
    assert.equal(stats.measured, false)
    assert.ok(Number.isNaN(stats.cookiesPerClick))
    assert.equal(m.h.A.clicks.clicksPerSecond(), 0)
})

test('the existing save watcher also detects zero activity through saved timestamps', () => {
    const h = boot()
    const advance = clock(h)
    let raw
    h.ctx.localStorage.getItem = key => (key === 'CookieClickerGame' ? raw : null)
    function write(clicks, handmade, resets = 0) {
        const sections = fx
            .save({ cookieClicks: clicks, handmadeCookies: handmade, resets })
            .text.split('|')
        const run = sections[2].split(';')
        run[2] = h.ctx.testNow
        sections[2] = run.join(';')
        raw = fx.encode(sections.join('|'))
        h.A.registry.get('saveWatch').tick()
        h.A.registry.get('clicks').tick()
        return h.A.clicks.stats()
    }
    write(1000, 1e6)
    advance(60000)
    assert.equal(write(1600, 1.6e6).clickCps, 10000)
    advance(1000)
    assert.equal(write(0, 0, 1).measured, false)
    advance(60000)
    assert.equal(write(0, 0, 1).registeredPerSecond, 0)
})

test('French research tooltips cannot bypass canonical upgrade policy', async () => {
    const h = boot({
        game: {
            crates: [
                {
                    id: 69,
                    name: 'Esprit unique',
                    price: 500,
                    body: 'Chaque grand-mère...',
                    section: 'techUpgrades'
                },
                {
                    id: 71,
                    name: 'Nettoyage de cerveau communal',
                    price: 500,
                    body: '',
                    section: 'techUpgrades'
                },
                {
                    id: 73,
                    name: 'Pacte avec les anciennes',
                    price: 500,
                    body: '',
                    section: 'techUpgrades'
                }
            ]
        }
    })
    for (let i = 0; i < 3; i++) await h.A.registry.get('catalog').tick()
    for (const crate of h.A.live.readUpgradeCrates()) {
        const entry = h.A.catalog.upgradeFor(crate.key)
        assert.equal(entry.kind, 'skip')
        assert.match(entry.blocked, /policy/)
    }
    assert.equal(h.A.catalog.classifyUpgrade('', 'One mind', 69), 'skip')
    assert.equal(h.A.catalog.classifyUpgrade('', 'Esprit unique', 69), 'skip')
    assert.equal(h.A.catalog.classifyUpgrade('', 'Esprit unique'), 'skip')
    // translated prose does not decide identity, including safe research.
    assert.equal(h.A.catalog.classifyUpgrade('vault', 'Chips spécialisés', 68), 'buy')
    for (const id of [69, 71, 73, 74, 84, 85, 452]) {
        assert.equal(h.A.catalog.classifyUpgrade('', 'arbitrary translation', id), 'skip')
    }
})

test('missing canonical upgrade ids suspend upgrade buying with an explanation', async () => {
    const h = boot({ game: { buyAll: true, crates: [{ name: 'Unbekannt', price: 1, body: '' }] } })
    h.A.store.set('runStartedAt', Date.now())
    const crate = h.A.live.readUpgradeCrates()[0]
    crate.element.setAttribute('data-id', '')
    await h.A.registry.get('catalog').tick()
    const refreshed = h.A.live.readUpgradeCrates()[0]
    assert.equal(h.A.catalog.upgradeFor(refreshed.key).kind, 'skip')
    assert.match(h.A.catalog.stats().blocked, /canonical upgrade id/)
    assert.equal(h.A.purchase.buyAll(), false)
    crate.element.setAttribute('data-id', '9007199254740993')
    assert.match(h.A.catalog.purchaseSafety(), /canonical upgrade id/)
    assert.equal(h.A.purchase.buyAll(), false)
})

for (const name of [
    'Frenzy',
    'Frénésie',
    'Dragonflight',
    'Vol de dragon',
    'Deduplication',
    'Pouvoir de Toi !'
]) {
    test(`${name} has a protected canonical identity`, async () => {
        const h = boot()
        h.game.gainBuff(name)
        await h.A.registry.get('buffs').tick()
        const buff = h.A.buffs.active()[0]
        assert.ok(buff.effect)
        assert.equal(h.A.buffs.blocksAscension(), true)
        assert.equal(h.A.buffs.guardStatus().blocked, false)
    })
}

test('unknown translated effects suspend ascension and spells after identification', async () => {
    const h = boot({
        save: fx.save({
            levels: { 7: 1 },
            amounts: { 7: 100 },
            minigames: { 7: fx.grimoire({ magic: 100 }) }
        }).raw
    })
    h.game.gainBuff('Unbekannter Effekt')
    await h.A.registry.get('buffs').tick()
    assert.equal(h.A.buffs.blocksAscension(), true)
    assert.match(h.A.buffs.guardStatus().reason, /Unbekannter Effekt/)
    h.A.registry.get('grimoire').tick()
    assert.match(h.debug().grimoire.blocked, /suspended/)
    assert.equal(h.A.store.get('spellsCast', 0), 0)
})

test('ascension protection and spell combo triggers have different policies', async () => {
    const h = boot()
    h.game.gainBuff('Frénésie')
    await h.A.registry.get('buffs').tick()
    assert.equal(h.A.buffs.hasProductionBuff(), true)
    assert.equal(h.A.buffs.hasSpellComboBuff(), true)
    h.game.gainBuff('Dragonflight')
    await h.A.registry.get('buffs').tick()
    assert.equal(h.A.buffs.blocksAscension(), true)
    assert.equal(h.A.buffs.hasSpellComboBuff(), false)
    h.game.loseBuff('Frénésie')
    assert.equal(h.A.buffs.hasProductionBuff(), false)
    h.game.loseBuff('Dragonflight')
    h.game.gainBuff('Prêt 2')
    await h.A.registry.get('buffs').tick()
    assert.equal(h.A.buffs.named(/^loan 2$/i).length, 1)
    assert.equal(h.A.buffs.blocksAscension(), false)
    assert.equal(h.A.buffs.hasProductionBuff(), true)
})

test('reused buff instance ids do not retain a previous node identity', async () => {
    const h = boot()
    h.game.gainBuff('Clot')
    await h.A.registry.get('buffs').tick()
    h.game.loseBuff('Clot')
    const next = h.game.gainBuff('Frénésie')
    next.element.id = 'buff0'
    assert.equal(h.A.buffs.blocksAscension(), true)
    assert.equal(h.A.buffs.guardStatus().blocked, true)
    await h.A.registry.get('buffs').tick()
    assert.equal(h.A.buffs.hasProductionBuff(), true)
})

test('lifecycle reset hook clears estimates before the next measurement tick', () => {
    const m = meter()
    m.advance(60000)
    m.write({ cookieClicks: 600, handmadeCookies: 600000 })
    m.h.A.clicks.reset()
    assert.equal(m.h.A.clicks.stats().samples, 0)
    assert.equal(m.h.A.clicks.clickCps(), 0)
    assert.ok(Number.isNaN(m.h.A.clicks.cookiesPerClick()))
})

test('every supported positive building special protects the run', () => {
    const effects = boot().A.data.effects
    const names = [
        'High-five',
        'Congregation',
        'Luxuriant harvest',
        'Ore vein',
        'Oiled-up',
        'Juicy profits',
        'Fervent adoration',
        'Manabloom',
        'Delicious lifeforms',
        'Breakthrough',
        'Righteous cataclysm',
        'Golden ages',
        'Extra cycles',
        'Solar flare',
        'Winning streak',
        'Macrocosm',
        'Refactoring',
        'Cosmic nursery',
        'Brainstorm',
        'Deduplication'
    ]
    for (const name of names) {
        assert.equal(effects.identify(name).protect, true, name)
        assert.equal(effects.identify(name).production, true, name)
    }
    for (const name of ['Clot', 'Gifted out', 'Sugar blessing', 'Loan 1 (interest)', 'Clone strike']) {
        assert.equal(effects.identify(name).protect, false, name)
    }
    assert.equal(effects.identify('Definitely a Frenzy in some descriptive prose'), null)
})

test('corrected measured rates feed upgrade, aura, and spirit strategy without a three-click cap', () => {
    function measured(rate) {
        const m = meter()
        m.h.A.clicks.record(1000000)
        m.advance(60000)
        m.write({ cookieClicks: rate * 60, handmadeCookies: rate * 60 * 100 })
        return m.h
    }
    const slow = measured(3)
    const corrected = measured(15)
    const clicks = corrected.A.clicks.stats()
    assert.equal(clicks.registeredPerSecond, 15)
    assert.ok(clicks.dispatchedPerSecond > 10000)
    assert.equal(corrected.A.purchase.buildView().clicksPerSecond, 15)
    const base = {
        cps: 1000,
        goldenCps: 0,
        buffBonusCps: 0,
        prestigeShare: 0.9,
        wrinklerCps: 0,
        promoted: false,
        level: 27,
        buffedShare: 0.2
    }
    const before = { ...base, clickCps: slow.A.clicks.clickCps() }
    const after = { ...base, clickCps: corrected.A.clicks.clickCps() }
    const score = corrected.A.strategy
    for (const aura of ['Dragonflight', 'Dragon Cursor']) {
        const previous = score.dragon.scoreAuras(before).find(a => a.name === aura)
        const current = score.dragon.scoreAuras(after).find(a => a.name === aura)
        assert.ok(Math.abs(current.gain / previous.gain - 5) < 1e-9, aura)
    }
    assert.equal(score.pantheon.best(before).slots[1], 6, 'Muridal uses ruby at the old rate')
    assert.equal(score.pantheon.best(after).slots[0], 6, 'Muridal uses diamond at the corrected rate')
})
