const { test } = require('node:test')
const assert = require('node:assert')
const { boot } = require('./harness')
const fx = require('./fixtures')

const SPENT = 999999
const BILLION = 1e9

function giftBoot(opts = {}) {
    return boot({
        save: fx.save({
            heavenlyChipsSpent: opts.spent === undefined ? SPENT : opts.spent,
            resets: 1,
            version: opts.version
        }).raw,
        game: {
            bank: opts.bank === undefined ? BILLION : opts.bank,
            wrappingPaper: opts.wrappingPaper !== false,
            giftCode: opts.giftCode,
            validCode: opts.validCode
        }
    })
}

async function sendGift(h, ticks = 6) {
    await h.A.store.ready('t')
    const mod = h.A.registry.get('gifts')
    for (let i = 0; i < ticks; i++) await mod.tick()
    return h.game.state
}

test('a gift is wrapped and the code is kept', async () => {
    const h = giftBoot({ giftCode: 'TESTCODE123456' })
    const state = await sendGift(h)
    assert.ok(state.log.indexOf('wrapped a gift') !== -1)
    assert.equal(h.A.gifts.heldCode().code, 'TESTCODE123456')
    assert.equal(h.debug().gifts.code, 'TESTCODE123456')
})

test('the options menu is not left open afterwards', async () => {
    const h = giftBoot()
    await sendGift(h)
    assert.equal(h.game.doc.getElementById('prefsButton').classList.contains('selected'), false)
})

test('only one code is generated while one is still fresh', async () => {
    const h = giftBoot()
    await sendGift(h, 12)
    assert.equal(h.game.state.log.filter(l => l === 'wrapped a gift').length, 1)
})

test('an expired code is dropped so a new one can be made', async () => {
    const h = giftBoot()
    await h.A.store.ready('t')
    h.A.store.set('giftCode', { code: 'OLD', at: Date.now() - 25 * 3600e3 })
    assert.equal(h.A.gifts.heldCode(), null)
    assert.equal(h.A.gifts.eligible(), true)
})

test('a bank under a billion cannot gift', async () => {
    const h = giftBoot({ bank: 1e8 })
    const state = await sendGift(h)
    assert.equal(state.log.indexOf('wrapped a gift'), -1)
    assert.equal(h.A.gifts.eligible(), false)
})

test('a save that cannot have bought wrapping paper is never looked at', async () => {
    const h = giftBoot({ spent: 1000 })
    await h.A.store.ready('t')
    assert.equal(h.A.gifts.eligible(), false)
    await sendGift(h)
    // and the options menu was never opened to find that out
    assert.equal(h.game.doc.getElementById('prefsButton').classList.contains('selected'), false)
})

test('without the upgrade it looks once and then leaves it alone for a while', async () => {
    const h = giftBoot({ wrappingPaper: false })
    const state = await sendGift(h, 8)
    assert.equal(state.log.indexOf('wrapped a gift'), -1)
    assert.ok(h.A.store.get('giftCheckedAt') > 0)
    assert.equal(h.A.gifts.eligible(), false)
    assert.equal(h.game.doc.getElementById('prefsButton').classList.contains('selected'), false)
})

test('a recent gift blocks another one, since the game does too', async () => {
    const h = giftBoot()
    await h.A.store.ready('t')
    h.game.gainBuff('Gifted out', 0.1)
    await h.A.registry.get('buffs').tick()
    assert.equal(h.A.gifts.eligible(), false)
})

test('a challenge run has no gifting at all', async () => {
    const h = boot({
        save: fx.save({ heavenlyChipsSpent: SPENT, ascensionMode: 1 }).raw,
        game: { bank: BILLION, wrappingPaper: true }
    })
    await h.A.store.ready('t')
    assert.equal(h.A.gifts.eligible(), false)
})

test('a menu the player opened is left alone', async () => {
    const h = giftBoot({ spent: 1000 })
    await h.A.store.ready('t')
    // the player opens Options for their own reasons
    h.game.doc.getElementById('prefsButton').classList.add('selected')
    await h.A.registry.get('gifts').tick()
    await h.A.registry.get('gifts').tick()
    assert.equal(h.game.doc.getElementById('prefsButton').classList.contains('selected'), true)
})

test('gift codes are a module the master switch can stop', () => {
    const h = boot({})
    const mod = h.A.registry.get('gifts')
    assert.ok(mod)
    assert.equal(mod.setting, 'gifts')
    assert.equal(h.A.store.DEFAULTS.gifts, true)
})

//! Redeeming
// The other half. Sending puts the "Gifted out" buff up for an hour, so a held code
// waits for that hour or for an ascension, whichever comes first.

const HELD = { code: 'TESTCODE123456', at: Date.now() - 2 * 3600e3 }

async function heldBoot(opts = {}) {
    const h = giftBoot(opts)
    await h.A.store.ready('t')
    h.A.store.set('giftCode', { ...HELD, ...(opts.held || {}) })
    return h
}

async function ticks(h, n = 4) {
    const mod = h.A.registry.get('gifts')
    for (let i = 0; i < n; i++) await mod.tick()
    return h.game.state
}

test('a code held from before the hour is redeemed', async () => {
    const h = await heldBoot({ validCode: 'TESTCODE123456' })
    const state = await ticks(h)
    assert.ok(state.log.indexOf('redeemed a gift') !== -1)
    assert.ok(h.A.store.get('giftRedeemedAt') > 0)
    assert.equal(h.A.gifts.heldCode(), null, 'and the code is not kept afterwards')
})

test('a code wrapped moments ago waits out the hour', async () => {
    const h = await heldBoot({ held: { at: Date.now() } })
    assert.equal(h.A.gifts.redeemable(), false)
    const state = await ticks(h)
    assert.equal(state.log.indexOf('redeemed a gift'), -1)
    assert.equal(h.game.doc.getElementById('prefsButton').classList.contains('selected'), false)
})

test('an ascension lifts the wait early, because buffs do not survive one', async () => {
    const h = await heldBoot({ held: { at: Date.now(), runId: 'a-previous-run' } })
    assert.equal(h.A.gifts.redeemable(), true)
    const state = await ticks(h)
    assert.ok(state.log.indexOf('redeemed a gift') !== -1)
})

test('the game is the judge of the code, and a bad one is dropped', async () => {
    const h = await heldBoot({ validCode: 'SOMETHINGELSE' })
    const state = await ticks(h)
    assert.equal(state.log.indexOf('redeemed a gift'), -1, 'the button stayed disabled')
    assert.equal(h.A.gifts.heldCode(), null, 'so the code is thrown away rather than retried')
    assert.equal(h.A.store.get('giftRedeemedAt', 0), 0)
})

test('a code is typed into the field rather than assumed into it', async () => {
    const h = await heldBoot({ validCode: 'TESTCODE123456' })
    const mod = h.A.registry.get('gifts')
    await mod.tick() // opens the options menu
    await mod.tick() // clicks Redeem
    const input = h.game.doc.getElementById('giftCode')
    assert.ok(input, 'the prompt is up')
    await mod.tick()
    assert.equal(h.game.state.log.indexOf('redeemed a gift') !== -1, true)
})

test('a redeem already done is never done again', async () => {
    const h = await heldBoot({ validCode: 'TESTCODE123456' })
    await ticks(h)
    const first = h.game.state.log.filter(l => l === 'redeemed a gift').length
    h.A.store.set('giftCode', HELD)
    await ticks(h)
    assert.equal(h.game.state.log.filter(l => l === 'redeemed a gift').length, first)
})

test('the buff the game puts up after a redeem is respected', async () => {
    const h = await heldBoot({ validCode: 'TESTCODE123456' })
    h.game.gainBuff('Gifted out', 0.5)
    await h.A.registry.get('buffs').tick()
    assert.equal(h.A.gifts.redeemable(), false)
})
