const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./harness')
const { clock } = require('./clock')
const { El } = require('./dom')

function roundedStore() {
    const time = clock()
    const h = boot({ clock: time, game: { bank: 1000000, cps: 0, crates: [] } })
    const observers = new Set()
    h.ctx.MutationObserver = class {
        constructor(callback) {
            this.callback = callback
        }
        observe() {
            observers.add(this)
        }
        disconnect() {
            observers.delete(this)
        }
    }
    const product = h.game.doc.getElementById('product0')
    const price = product.querySelector('.price')
    let shown = '1 million'
    Object.defineProperty(price, 'innerText', {
        get: () => shown,
        set: () => {
            for (const observer of observers) observer.callback([{ target: price }])
        }
    })
    for (const other of h.A.live.readProducts().slice(1)) {
        Object.defineProperty(other.priceElement, 'innerText', { get: () => '1 trillion', set() {} })
    }
    const actualPrice = 1000400
    let attempts = 0
    product.listeners.click = [
        () => {
            attempts++
            const cost = actualPrice * h.game.state.amount
            if (h.game.state.bank < cost) return
            h.game.state.bank -= cost
            h.game.state.owned[0] += h.game.state.amount
            h.game.refresh()
        }
    ]
    // Drive real transaction waits and scheduler ticks without wall-clock sleeps.
    async function settle(promise) {
        let done = false
        const result = promise.finally(() => (done = true))
        for (let i = 0; i < 200 && !done; i++) {
            await Promise.resolve()
            time.advance(25)
        }
        assert.ok(done, 'purchase transaction settled')
        return result
    }
    const tick = () => settle(h.A.registry.get('purchase').tick({ budget: h.A.scheduler.budget(1) }))
    const buy = (count = 1, budget = Infinity) =>
        settle(h.A.act.store.buy(h.A.live.readProducts()[0], count, budget))
    return {
        h,
        time,
        product,
        tick,
        buy,
        settle,
        attempts: () => attempts,
        show: value => (shown = value)
    }
}

test('rounded-price refusal stops across ticks & recovers as soon as funds increase', async () => {
    const f = roundedStore()
    await f.tick()
    assert.equal(f.attempts(), 1)
    for (let i = 0; i < 35; i++) {
        f.time.advance(1100)
        await f.tick()
    }
    assert.equal(f.attempts(), 1, 'unchanged funds and prices permit only the first refusal')
    assert.equal(f.h.game.state.owned[0], 0)
    assert.equal(f.h.game.state.bank, 1000000)
    assert.equal(f.h.game.state.mode, 'buy')
    assert.equal(f.h.game.state.amount, 1)

    // Only the bank changes: no product redraw, reload, or bulk change.
    f.h.game.state.bank = 1100000
    f.h.game.doc.getElementById('cookies').innerText = '1100000 cookies'
    await f.tick()
    assert.equal(f.attempts(), 2)
    assert.equal(f.h.game.state.owned[0], 1)
    assert.equal(f.h.game.state.amount, 1)
})

test('automatic mode & quantity restoration does not reset a refusal', async () => {
    const f = roundedStore()
    f.h.A.input.simulateClick(f.h.game.bulk.storeBulkSell)
    f.h.A.input.simulateClick(f.h.game.bulk.storeBulk10)
    await f.tick()
    await f.tick()
    await f.tick()
    assert.equal(f.attempts(), 1)
    assert.equal(f.h.game.state.mode, 'sell')
    assert.equal(f.h.game.state.amount, 10)
})

for (const change of ['price', 'ownership', 'product', 'quantity', 'player controls']) {
    test(`a refused product becomes eligible after changed ${change}`, async () => {
        const f = roundedStore()
        assert.equal((await f.buy()).reason, 'purchase not observed')
        assert.equal((await f.buy()).bought, false)
        assert.equal(f.attempts(), 1)
        let count = 1
        if (change === 'price') f.show('0.9999 million')
        if (change === 'ownership') {
            f.h.game.state.owned[0] = 1
            f.h.game.refresh()
        }
        if (change === 'product') {
            const replacement = new El('div', { id: 'product0', class: 'product unlocked' })
            replacement.append(...f.product.children)
            replacement.listeners.click = f.product.listeners.click
            const parent = f.product.parent
            parent.children[parent.children.indexOf(f.product)] = replacement
            replacement.parent = parent
        }
        if (change === 'quantity') count = 10
        if (change === 'player controls') {
            const target = f.h.game.bulk.storeBulk10
            f.h.game.doc.fire('pointerdown', { isTrusted: true, target })
            f.h.A.input.simulateClick(target)
        }
        assert.equal((await f.buy(count)).reason, 'purchase not observed')
        assert.equal(f.attempts(), 2, 'changed state permits one new attempt')
        await f.buy(count)
        assert.equal(f.attempts(), 2, 'the new refusal is suppressed too')
    })
}

test('successful unchanged-price purchases remain repeatable after a refusal', async () => {
    const f = roundedStore()
    await f.buy()
    f.h.game.state.bank = 5000000
    f.h.game.refresh()
    for (let i = 0; i < 3; i++) {
        assert.equal((await f.buy()).bought, true)
        assert.equal(f.h.game.state.owned[0], i + 1)
    }
    assert.equal(f.attempts(), 4)
})

test('funded recovery still respects pause & transaction ownership', async () => {
    const f = roundedStore()
    await f.buy()
    f.h.game.state.bank = 1100000
    f.h.game.refresh()
    f.h.A.scheduler.pause()
    assert.equal((await f.buy()).bought, false)
    assert.equal(f.attempts(), 1)
    f.h.A.scheduler.resume()
    const lease = f.h.A.transactions.acquire('purchase')
    try {
        assert.equal((await f.buy()).bought, false)
        assert.equal(f.attempts(), 1)
    } finally {
        lease.release()
    }
    assert.equal((await f.buy()).bought, true)
    assert.equal(f.attempts(), 2)
})
