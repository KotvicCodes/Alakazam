const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./harness')
const { clock } = require('./clock')
const { El } = require('./dom')
const fx = require('./fixtures')

function fixture() {
    const time = clock()
    const h = boot({
        clock: time,
        save: fx.save().raw,
        game: { bank: 1e12, crates: [], bakeryName: 'Player' }
    })
    const click = id => h.A.input.simulateClick(h.game.doc.getElementById(id))
    const observers = new Set()
    const draws = []
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
    // Hold only the rendered prices; real controls, leases and purchase ticks run.
    for (const node of h.game.doc.querySelectorAll('.product .price')) {
        let shown = node.innerText
        Object.defineProperty(node, 'innerText', {
            get: () => shown,
            set: value =>
                draws.push(() => {
                    shown = value
                    for (const observer of observers) observer.callback([{ target: node }])
                })
        })
    }
    function draw() {
        draws.splice(0).forEach(fn => fn())
    }
    async function until(read) {
        for (let i = 0; i < 100; i++) {
            if (read()) return
            await Promise.resolve()
        }
        assert.fail('transaction did not reach its held redraw')
    }
    async function settle(work, redraw = false) {
        let done = false
        const result = Promise.resolve(work).finally(() => (done = true))
        for (let i = 0; i < 200 && !done; i++) {
            await Promise.resolve()
            if (redraw) draw()
            time.advance(25)
        }
        assert.ok(done, 'transaction settled')
        return result
    }
    function foreignPrompt() {
        h.game.doc.fire('keydown', { isTrusted: true, target: h.game.doc.body, key: 'o', ctrlKey: true })
        let answered = 0
        h.game.prompt(
            'ImportSave',
            [
                ['Load', () => answered++],
                ['Cancel', () => answered++]
            ],
            inner => {
                inner.append(new El('textarea', { id: 'textareaPrompt' }))
            }
        )
        const prompt = h.A.safety.prompt()
        const text = h.game.doc.getElementById('textareaPrompt')
        text.value = 'player save text'
        const options = [0, 1].map(i => h.game.doc.getElementById('promptOption' + i))
        return () => {
            assert.equal(h.A.safety.prompt(), prompt)
            assert.equal(text.value, 'player save text')
            assert.equal(h.game.doc.getElementById('textareaPrompt'), text)
            options.forEach((node, i) =>
                assert.equal(h.game.doc.getElementById('promptOption' + i), node)
            )
            assert.equal(answered, 0)
            for (const owner of ['purchase', 'achievements', 'ascend', 'gifts']) {
                assert.equal(h.A.safety.ownsPrompt(owner), false)
            }
        }
    }
    const tick = () => h.A.registry.get('purchase').tick({ budget: h.A.scheduler.budget(1) })
    return { h, time, click, draw, until, settle, foreignPrompt, tick }
}

for (const cancellation of ['player input', 'pause', 'pause & resume']) {
    test(`real purchase restores 1 after ImportSave during bulk 100: ${cancellation}`, async () => {
        const f = fixture()
        const { h } = f
        const bank = h.game.state.bank
        const work = f.tick()
        await f.until(() => h.game.state.amount === 100)
        const task = h.A.safety.scope('purchase')
        const assertPrompt = f.foreignPrompt()
        if (cancellation !== 'player input') h.A.scheduler.pause()
        if (cancellation === 'pause & resume') h.A.scheduler.resume()
        await f.settle(work)
        assert.equal(h.game.state.amount, 1)
        assert.equal(h.game.state.mode, 'buy')
        assert.equal(h.game.state.bank, bank)
        assert.equal(
            h.game.state.owned.every(n => n === 0),
            true
        )
        assertPrompt()
        assert.equal(task.active, false)
        assert.throws(() => task.input('simulateClick', h.game.doc.getElementById('product0')), {
            name: 'CancellationError'
        })

        h.A.scheduler.pause()
        await f.settle(f.tick(), true)
        assert.equal(h.game.state.bank, bank, 'paused work never spends')
        assertPrompt()
        f.click('promptOption1')
        h.A.scheduler.resume()
        await f.settle(f.tick(), true)
        assert.ok(
            h.game.state.owned.some(n => n > 0),
            'a fresh tick recovers after dismissal'
        )
        assert.equal(h.game.state.amount, 1)
        assert.equal(task.active, false, 'resume never revives the interrupted generation')
    })
}

for (const mode of ['buy', 'sell']) {
    for (const amount of [1, 10, 100, 'max']) {
        test(`foreign prompt cleanup preserves prior ${mode}/${amount}`, async () => {
            const f = fixture()
            const { h } = f
            f.click(mode === 'buy' ? 'storeBulkBuy' : 'storeBulkSell')
            f.click('storeBulk' + (amount === 'max' ? 'Max' : amount))
            f.draw()
            const requested = amount === 100 ? 10 : 100
            const work = h.A.act.store.buy(h.A.live.readProducts()[0], requested, Infinity)
            await f.until(() => h.game.state.mode === 'buy' && h.game.state.amount === requested)
            const assertPrompt = f.foreignPrompt()
            await f.settle(work)
            assert.equal(h.game.state.mode, mode)
            assert.equal(h.game.state.amount, amount)
            assert.equal(
                h.game.state.owned.every(n => n === 0),
                true
            )
            assertPrompt()
        })
    }
}

for (const selection of ['sell/max', 'buy/100']) {
    test(`foreign prompt cleanup preserves newer player ${selection} controls`, async () => {
        const f = fixture()
        const { h } = f
        const work = f.tick()
        await f.until(() => h.game.state.amount === 100)
        const id = selection === 'sell/max' ? 'storeBulkSell' : 'storeBulk100'
        h.game.doc.fire('pointerdown', { isTrusted: true, target: h.game.doc.getElementById(id) })
        f.click(id)
        if (selection === 'sell/max') f.click('storeBulkMax')
        const assertPrompt = f.foreignPrompt()
        await f.settle(work)
        assert.equal(h.game.state.mode, selection === 'sell/max' ? 'sell' : 'buy')
        assert.equal(h.game.state.amount, selection === 'sell/max' ? 'max' : 100)
        assert.equal(
            h.game.state.owned.every(n => n === 0),
            true
        )
        assertPrompt()
    })
}

test('bulk cleanup preserves another automation owner and its prompt text', async () => {
    const f = fixture()
    const { h } = f
    const work = f.tick()
    await f.until(() => h.game.state.amount === 100)
    const owner = h.A.safety.context('achievements')
    owner.input('simulateClick', h.game.doc.getElementById('bakeryName'))
    const prompt = h.A.safety.prompt()
    const input = h.game.doc.getElementById('bakeryNameInput')
    input.value = 'unfinished name'
    h.A.transactions.cancel()
    await f.settle(work)
    assert.equal(h.game.state.amount, 1)
    assert.equal(h.A.safety.prompt(), prompt)
    assert.equal(h.A.safety.ownsPrompt('achievements', 'NameBakery'), true)
    assert.equal(input.value, 'unfinished name')
    assert.equal(h.game.state.bakeryName, 'Player')
})

test('cancelled cleanup cannot perform arbitrary actions behind a player prompt', () => {
    const f = fixture()
    const { h } = f
    const ctx = h.A.safety.context('purchase')
    const assertPrompt = f.foreignPrompt()
    ctx.cancel()
    const product = h.game.doc.getElementById('product0')
    const option = h.game.doc.getElementById('promptOption0')
    const text = h.game.doc.getElementById('textareaPrompt')
    const bulk = h.game.doc.getElementById('storeBulk10')
    const arbitrary = new El('div', { id: 'storeBulkBuyAll' })
    h.game.doc.body.append(arbitrary)
    for (const [method, ...args] of [
        ['simulateClick', product],
        ['simulateClickAt', product, 1, 1],
        ['simulateClick', option],
        ['simulateClick', bulk],
        ['typeInto', text, 'overwritten'],
        ['hoverOn', product],
        ['restoreStoreControl', product],
        ['restoreStoreControl', option],
        ['restoreStoreControl', arbitrary],
        ['restoreStoreControl', new El('div', { id: 'storeBulk10' })],
        ['restoreStoreControl', bulk, { source: 'keyboard' }]
    ]) {
        assert.throws(
            () => ctx.cleanup(() => ctx.input(method, ...args)),
            {
                name: 'CancellationError'
            },
            method
        )
    }
    assert.equal(
        h.game.state.owned.every(n => n === 0),
        true
    )
    assert.equal(product.events.length, 0)
    assert.equal(arbitrary.events.length, 0)
    assert.equal(h.game.state.amount, 1)
    assertPrompt()
})

test('bulk restoration capability requires cleanup even on an active context', () => {
    const f = fixture()
    const { h } = f
    const ctx = h.A.safety.context('purchase')
    const node = h.game.doc.getElementById('storeBulk10')
    assert.throws(() => ctx.input('restoreStoreControl', node), { name: 'CancellationError' })
    assert.equal(h.game.state.amount, 1)
})
