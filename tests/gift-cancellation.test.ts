const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot, waitFor } = require('./harness')
const { El } = require('./dom')
const fx = require('./fixtures')

const CODE = 'PRIVATE-GENERATED-GIFT'

async function ready() {
    const h = boot({
        save: fx.save({ heavenlyChipsSpent: 999999 }).raw,
        game: { bank: 1e9, wrappingPaper: true, giftCode: CODE }
    })
    await h.A.save.connect()
    await h.A.store.flush()
    return h
}

// Keep the real sequence at each menu wait, especially the wait after Wrap.
function menuWaits(h) {
    const original = h.ctx.setTimeout
    const pending = []
    h.ctx.setTimeout = (fn, ms) => {
        if (ms !== 350) return original(fn, ms)
        pending.push(fn)
        return 0
    }
    return {
        pending,
        async next() {
            assert.ok(await waitFor(() => pending.length > 0, 1000, 1))
            pending.shift()()
        },
        release() {
            h.ctx.setTimeout = original
            pending.splice(0).forEach(fn => fn())
        }
    }
}

async function wrapped(h) {
    const waits = menuWaits(h)
    const work = h.A.registry.get('gifts').tick()
    await waits.next() // Options -> Send
    await waits.next() // Send -> Wrap
    assert.ok(await waitFor(() => waits.pending.length === 1, 1000, 1))
    assert.equal(h.A.safety.ownsPrompt('gifts', 'GiftSendReady'), true)
    assert.equal(h.game.state.log.filter(line => line === 'wrapped a gift').length, 1)
    return { waits, work }
}

function durable(h, who = h.A.identity.current()) {
    return h.disk[h.A.store.fieldKey('legacy:' + who.familyId, 'giftCode')]?.value
}

function replaceSave(h, opts) {
    const raw = fx.save({ heavenlyChipsSpent: 999999, ...opts }).raw
    h.ctx.localStorage = { getItem: key => (key === 'CookieClickerGame' ? raw : null) }
    return h.A.identity.current()
}

for (const cancel of ['pause', 'stop', 'master', 'module']) {
    test(`${cancel} immediately after Wrap preserves the completed code durably`, async () => {
        const h = await ready()
        const who = h.A.identity.current()
        const { waits, work } = await wrapped(h)
        if (cancel === 'pause') {
            h.A.scheduler.pause()
            h.A.scheduler.resume()
        } else if (cancel === 'stop') h.A.scheduler.stop()
        else {
            const setting = cancel === 'master' ? 'enabled' : 'gifts'
            h.A.store.setSetting(setting, false)
            h.A.store.setSetting(setting, true)
        }
        waits.release()
        await work
        assert.equal(h.A.gifts.heldCode()?.code, CODE)
        assert.equal(durable(h, who)?.code, CODE)
        assert.equal(durable(h, who)?.runId, who.runId)
        assert.equal(h.A.safety.prompt(), null)
        assert.equal(h.game.state.log.includes('redeemed a gift'), false)
        const lease = h.A.safety.acquire('prompt', 'probe')
        assert.ok(lease, 'cancelled work released its UI lease')
        lease.release()
        const reload = boot({ disk: h.disk })
        await reload.A.store.ready(who)
        assert.equal(reload.A.gifts.heldCode()?.code, CODE)
    })
}

test('Done waits for a successful storage callback even when cancellation happens during the write', async () => {
    const h = await ready()
    const { waits, work } = await wrapped(h)
    const deferred = h.storage.deferNextSet()
    waits.release()
    const commit = await deferred
    assert.equal(h.A.safety.ownsPrompt('gifts', 'GiftSendReady'), true)
    assert.equal(durable(h), undefined)
    h.A.scheduler.pause()
    commit()
    await work
    assert.equal(durable(h)?.code, CODE)
    assert.equal(h.A.safety.prompt(), null)
})

for (const failure of ['rejected', 'unavailable']) {
    test(`${failure} storage leaves the generated code visible for recovery`, async () => {
        const h = await ready()
        const { waits, work } = await wrapped(h)
        if (failure === 'rejected') h.storage.failNext('set')
        else h.ctx.chrome = undefined
        h.A.scheduler.pause()
        waits.release()
        await work
        assert.equal(h.A.gifts.heldCode()?.code, CODE)
        assert.equal(durable(h), undefined)
        assert.equal(h.A.safety.ownsPrompt('gifts', 'GiftSendReady'), true)
        assert.equal(h.game.doc.getElementById('giftCode').value, CODE)
        if (failure === 'rejected') {
            h.A.scheduler.resume()
            await h.A.registry.get('gifts').tick()
            assert.equal(durable(h)?.code, CODE)
            assert.equal(h.A.safety.prompt(), null)
            assert.equal(h.game.state.log.filter(line => line === 'wrapped a gift').length, 1)
        }
    })
}

for (const change of ['run', 'family', 'unknown']) {
    test(`a replacement ${change} keeps the code in its original family and retains the prompt`, async () => {
        const h = await ready()
        const before = h.A.identity.current()
        const { waits, work } = await wrapped(h)
        const next =
            change === 'unknown'
                ? ((h.ctx.localStorage = { getItem: () => null }), h.A.identity.current())
                : replaceSave(h, change === 'family' ? { fullDate: 1760000000000 } : { seed: 'next' })
        h.A.safety.invalidate()
        await h.A.store.ready(next)
        h.debug().identity = next
        h.A.store.set('replacementSentinel', true)
        waits.release()
        await work
        assert.equal(durable(h, before)?.code, CODE)
        assert.equal(durable(h, before)?.runId, before.runId)
        assert.equal(h.A.safety.ownsPrompt('gifts', 'GiftSendReady'), true)
        assert.equal(h.A.store.get('replacementSentinel'), true)
        if (change !== 'run') assert.equal(h.A.gifts.heldCode(), null)
        else assert.equal(h.A.gifts.heldCode()?.runId, before.runId)
        if (next.known && change === 'family') assert.equal(durable(h, next), undefined)
    })
}

test('a run change during the durable write cannot authorize Done in the replacement run', async () => {
    const h = await ready()
    const before = h.A.identity.current()
    const { waits, work } = await wrapped(h)
    const deferred = h.storage.deferNextSet()
    waits.release()
    const commit = await deferred
    const next = replaceSave(h, { seed: 'replacement-during-write' })
    assert.notEqual(next.runId, before.runId)
    h.A.safety.invalidate()
    commit()
    await work
    assert.equal(durable(h, before)?.runId, before.runId)
    assert.equal(h.A.safety.ownsPrompt('gifts', 'GiftSendReady'), true)
})

test('a replacement stored code during persistence cannot authorize Done or be overwritten', async () => {
    const h = await ready()
    const { waits, work } = await wrapped(h)
    const deferred = h.storage.deferNextSet()
    waits.release()
    const commit = await deferred
    const replacement = { code: 'NEWER-CODE', at: Date.now(), runId: h.A.identity.current().runId }
    h.A.store.set('giftCode', replacement)
    commit()
    await work
    assert.equal(h.A.store.get('giftCode').code, replacement.code)
    assert.equal(h.A.safety.ownsPrompt('gifts', 'GiftSendReady'), true)
    await h.A.store.flush()
    assert.equal(durable(h)?.code, replacement.code)
})

test('a run change before Wrap prevents gifting in that replacement run', async () => {
    const h = await ready()
    const waits = menuWaits(h)
    const work = h.A.registry.get('gifts').tick()
    await waits.next()
    assert.ok(await waitFor(() => waits.pending.length === 1, 1000, 1))
    replaceSave(h, { seed: 'replacement-before-wrap' })
    waits.release()
    await work
    assert.equal(h.game.state.log.includes('wrapped a gift'), false)
    assert.equal(h.A.gifts.heldCode(), null)
})

for (const name of ['GiftSend', 'GiftSendReady']) {
    test(`a player's ${name} prompt is never wrapped, captured or dismissed`, async () => {
        const h = await ready()
        h.A.input.simulateClick(h.game.doc.getElementById('prefsButton'))
        h.A.input.simulateClick(h.game.doc.querySelector('#giftStuff a.option'))
        if (name === 'GiftSendReady') h.A.input.simulateClick(h.game.doc.getElementById('promptOption0'))
        const node = h.A.safety.prompt()
        const count = h.game.state.log.length
        await h.A.registry.get('gifts').tick()
        h.A.scheduler.pause()
        await h.A.registry.get('gifts').tick()
        assert.equal(h.A.safety.prompt(), node)
        assert.equal(h.A.gifts.heldCode(), null)
        assert.equal(h.game.state.log.length, count)
    })
}

for (const takeover of ['trusted input', 'replacement prompt', 'edited code']) {
    test(`${takeover} during persistence prevents dismissal of the player's prompt`, async () => {
        const h = await ready()
        const { waits, work } = await wrapped(h)
        const deferred = h.storage.deferNextSet()
        waits.release()
        const commit = await deferred
        const node = h.A.safety.prompt()
        assert.ok(node, 'Done must wait until persistence finishes')
        if (takeover === 'trusted input')
            h.game.doc.fire('pointerdown', { isTrusted: true, target: node })
        else if (takeover === 'replacement prompt') {
            const replacement = new El('div', { id: 'promptContentGiftSendReady' })
            h.game.doc.getElementById('promptContent').children[0] = replacement
        } else node.querySelector('#giftCode').value = 'PLAYER-EDIT'
        h.A.scheduler.pause()
        commit()
        await work
        assert.ok(h.A.safety.prompt(), 'the prompt must remain open')
        assert.equal(durable(h)?.code, CODE)
    })
}

test('capture reads only the owned result field and does not log the gift code', async () => {
    const h = await ready()
    const decoy = new El('input', { id: 'giftCode' })
    decoy.value = 'UNRELATED-PRIVATE-FIELD'
    h.game.doc.body.insertBefore(decoy, h.game.doc.body.firstChild)
    const logs = []
    h.ctx.console = {
        log: (...args) => logs.push(args.join(' ')),
        warn: (...args) => logs.push(args.join(' '))
    }
    const { waits, work } = await wrapped(h)
    h.A.scheduler.pause()
    waits.release()
    await work
    assert.equal(durable(h)?.code, CODE)
    assert.equal(
        logs.some(line => line.includes(CODE) || line.includes(decoy.value)),
        false
    )
})
