const { test } = require('node:test')
const assert = require('node:assert')
const { boot } = require('./harness')
const fx = require('./fixtures')

// the ids the temple writes into the save, in its own order
const GODZAMOK = 2
const CYCLIUS = 3
const DOTJEIESS = 5
const MURIDAL = 6
const JEREMY = 7
const MOKALSIUM = 8

const IDLE_RUN = {
    cps: 1e12,
    clickCps: 1e9,
    goldenCps: 1e11,
    buffBonusCps: 5e10,
    prestigeShare: 0.9,
    wrinklerCps: 0,
    promoted: false
}

function pantheonBoot(opts = {}) {
    return boot({
        save: fx.save({
            prestige: 1000,
            dragonAura: opts.dragonAura || 0,
            levels: { 6: opts.templeLevel === undefined ? 1 : opts.templeLevel },
            amounts: { 6: 100 },
            minigames: {
                6: fx.pantheon({
                    slots: opts.slots || [-1, -1, -1],
                    swaps: opts.swaps === undefined ? 3 : opts.swaps
                })
            }
        }).raw,
        game: { bank: 1e9 }
    })
}

async function ready(h) {
    await h.A.store.ready('t')
    await h.A.registry.get('saveWatch').tick()
    return h
}

//* settle
// the income sampler wants a minute of samples before it will let anything be
// scored off it, and a tick is a sample: sixty of them is that minute.
async function settle(h) {
    const income = h.A.registry.get('income')
    for (let i = 0; i < 60; i++) await income.tick()
    return h
}

//! The scorer

test('Holobore is never in a layout, whatever it would pay', () => {
    const S = boot({}).A.strategy.pantheon
    assert.equal(S.usable().indexOf(0), -1)
    assert.ok(S.rank(IDLE_RUN).every(row => row.slots.indexOf(0) === -1))
})

test('production beats clicking once clicking is a rounding error', () => {
    const S = boot({}).A.strategy.pantheon
    const best = S.best(IDLE_RUN)
    assert.equal(best.slots.indexOf(MURIDAL), -1, 'Muridal costs 3% of production for 15% of nothing')
})

test('and clicking wins while clicking is most of the income', () => {
    const S = boot({}).A.strategy.pantheon
    const clicky = { ...IDLE_RUN, cps: 1e9, clickCps: 1e12 }
    assert.equal(S.best(clicky).slots[0], MURIDAL, 'the strongest click bonus takes the diamond')
})

test('the golden cookie penalty is priced, not ignored', () => {
    const S = boot({}).A.strategy.pantheon
    // Jeremy adds 10% production and takes 10% off golden cookie frequency, so on a
    // save that lives off golden cookies he is worth less than the guides say
    const quiet = S.score([JEREMY, MOKALSIUM, DOTJEIESS], { ...IDLE_RUN, goldenCps: 0 })
    const goldenHeavy = S.score([JEREMY, MOKALSIUM, DOTJEIESS], { ...IDLE_RUN, goldenCps: 5e11 })
    assert.ok(goldenHeavy.gain < quiet.gain, 'the same layout is worth less when goldens matter')
})

test('Supreme Intellect promotes every slot, for better and for worse', () => {
    const S = boot({}).A.strategy.pantheon
    // promotion multiplies whatever a slot does, so the best layout gets better
    const quiet = { ...IDLE_RUN, goldenCps: 0 }
    assert.ok(S.best({ ...quiet, promoted: true }).gain > S.best(quiet).gain)

    // and a layout carrying a penalty that scales with the slot gets worse, which is
    // the part a fixed table of presets could never have noticed: Dotjeiess costs
    // 10% of the prestige bonus in jade and 20% of it in ruby
    const layout = [JEREMY, MOKALSIUM, DOTJEIESS]
    assert.ok(S.score(layout, { ...IDLE_RUN, promoted: true }).gain < S.score(layout, IDLE_RUN).gain)
})

test('a spirit that needs something Alakazam does not do is worth nothing', () => {
    const S = boot({}).A.strategy.pantheon
    const godzamok = S.score([GODZAMOK, -1, -1], IDLE_RUN)
    assert.equal(godzamok.gain, 0)
    assert.match(godzamok.terms[0].why, /selling combo/)
})

test('Cyclius is scored at its current phase but never chosen', () => {
    const S = boot({}).A.strategy.pantheon
    const row = S.score([CYCLIUS, -1, -1], IDLE_RUN)
    assert.equal(row.moving, true)
    assert.ok(Math.abs(row.gain) <= 0.15 * IDLE_RUN.cps + 1)
    // chasing a sine wave costs a swap every few hours and there are three a day
    assert.equal(S.usable().indexOf(CYCLIUS), -1)
    assert.ok(S.rank(IDLE_RUN).every(r => r.slots.indexOf(CYCLIUS) === -1))
})

test('an empty slot contributes nothing rather than throwing', () => {
    const S = boot({}).A.strategy.pantheon
    assert.equal(S.score([-1, -1, -1], IDLE_RUN).gain, 0)
})

//! The module

test('an unlocked temple with an empty pantheon is filled in one pass', async () => {
    const h = await ready(pantheonBoot({ slots: [-1, -1, -1], swaps: 3 }))
    const s = h.A.pantheon.state()
    assert.equal(s.wrong.length, 3)
    assert.equal(s.swaps, 3)
})

test('a locked minigame is left alone entirely', async () => {
    const h = await ready(pantheonBoot({ templeLevel: 0 }))
    assert.equal(h.A.pantheon.state(), null)
})

test('an unsettled measurement reports no gain and spends nothing', async () => {
    const h = await ready(pantheonBoot({ slots: [MURIDAL, JEREMY, MOKALSIUM], swaps: 3 }))
    const s = h.A.pantheon.state()
    assert.equal(s.settled, false)
    assert.equal(s.gain, 0)
    assert.equal(s.worthIt, false)
    assert.match(s.why, /waiting on measurements/)
})

test('a layout barely better than the one slotted does not spend a swap', async () => {
    const h = await settle(await ready(pantheonBoot({ swaps: 3 })))
    const inputs = h.A.pantheon.scoringState()
    const S = h.A.strategy.pantheon
    const best = S.best(inputs)
    // the best layout against itself is worth nothing more, which is the case the
    // reluctance is there for
    const same = S.score(best.slots, inputs)
    assert.equal(best.gain - same.gain, 0)
    assert.equal(same.moving, false, 'and nothing in it is a moving target')
})

test('what the temple is wearing is scored the same way as what it could wear', async () => {
    const h = await settle(await ready(pantheonBoot({ slots: [MURIDAL, JEREMY, MOKALSIUM], swaps: 3 })))
    const s = h.A.pantheon.state()
    assert.equal(s.settled, true)
    assert.ok(s.wrong.length > 0, 'the old clicker preset is not what the scorer wants')
    assert.ok(s.gain > 0, 'and the difference is quantified rather than assumed')
})

test('Supreme Intellect in the save is noticed by the temple', async () => {
    const plain = await ready(pantheonBoot({}))
    assert.equal(plain.A.pantheon.scoringState().promoted, false)
    const promoted = await ready(pantheonBoot({ dragonAura: 20 }))
    assert.equal(promoted.A.pantheon.scoringState().promoted, true)
})

test('the temple is dragged, not clicked', async () => {
    const h = await ready(pantheonBoot({ slots: [-1, -1, -1] }))
    const doc = h.game.doc
    // the drag handles the game gives each spirit, and the three sockets
    const drag = new (require('./dom').El)('div', { id: 'templeGodDrag' + JEREMY })
    const socket = new (require('./dom').El)('div', { id: 'templeSlot0' })
    doc.body.append(drag, socket)

    assert.equal(await h.A.pantheon.slot(JEREMY, 0), true)
    // mousedown on the spirit, the release on the socket: a click would do nothing
    assert.ok(drag.events.indexOf('mousedown') !== -1)
    assert.ok(socket.events.indexOf('mouseup') !== -1)
    assert.equal(drag.events.indexOf('click'), -1)
})

test('missing temple controls are reported rather than dragged at', async () => {
    const h = await ready(pantheonBoot({ slots: [-1, -1, -1] }))
    assert.equal(await h.A.pantheon.slot(JEREMY, 0), false)
})

test('explain prints the ranking and hands back the state', async () => {
    const h = await ready(pantheonBoot({ slots: [MURIDAL, JEREMY, MOKALSIUM] }))
    const out = h.A.pantheon.explain()
    assert.ok(out)
    assert.equal(out.current[0], MURIDAL)
})
