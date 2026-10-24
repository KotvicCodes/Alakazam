const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot, sleep } = require('./harness')
const { El } = require('./dom')
const fx = require('./fixtures')

const purchaseTick = h => h.A.registry.get('purchase').tick({ budget: h.A.scheduler.budget(1) })
const click = (h, id) => h.A.input.simulateClick(h.game.doc.getElementById(id))

// hold the rendered store back while the controls already reflect the new mode
function slowStore(h, delay = 160) {
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
    const nodes = h.game.doc.querySelectorAll('.product .price')
    for (const node of nodes) {
        let shown = node.innerText
        Object.defineProperty(node, 'innerText', {
            get: () => shown,
            set: value => {
                setTimeout(() => {
                    shown = value
                    for (const observer of observers) observer.callback([{ target: node }])
                }, delay)
            }
        })
    }
}

test('purchase decisions & restored controls are independent of quantity and mode', async () => {
    let expected
    for (const mode of ['buy', 'sell']) {
        for (const quantity of [1, 10, 100, 'max']) {
            if (mode === 'buy' && quantity === 'max') continue
            const h = boot({
                game: { bank: 5000, crates: [], owned: [9, 0, 0, 0, 0, 0, 0, 0] },
                save: fx.save({ amounts: { 0: 0 } }).raw
            })
            click(h, mode === 'buy' ? 'storeBulkBuy' : 'storeBulkSell')
            click(h, 'storeBulk' + (quantity === 'max' ? 'Max' : quantity))
            await h.A.act.store.withBulk('buy', 1, () => {
                assert.equal(h.A.purchase.buildView().buildings[0].owned, 9)
            })
            await purchaseTick(h)
            const decision = h.debug().decision
            const actual = [
                decision.target.index,
                decision.amount,
                decision.target.price,
                decision.target.owned
            ]
            expected ||= actual
            assert.deepEqual(actual, expected, `${mode}/${quantity}`)
            assert.equal(h.game.state.mode, mode)
            assert.equal(h.game.state.amount, quantity)
        }
    }
})

test('invalid live counts fall back to save; blank owned labels mean zero', () => {
    const h = boot({ save: fx.save({ amounts: { 0: 50 } }).raw })
    const owned = h.game.doc.getElementById('product0').querySelector('.owned')
    for (const text of ['unreadable', '-1', '1.5']) {
        owned.innerText = text
        assert.equal(h.A.purchase.buildView().buildings[0].owned, 50)
    }
    owned.innerText = ''
    assert.equal(h.A.purchase.buildView().buildings[0].owned, 0)
})

test('a purchase updates scoring immediately before autosave', async () => {
    const h = boot({ game: { bank: 5000, crates: [] }, save: fx.save({}).raw })
    await purchaseTick(h)
    const view = h.A.purchase.buildView()
    const index = h.debug().decision.target.index
    assert.equal(view.buildings[index].owned, h.game.state.owned[index])
    assert.ok(view.buildings[index].owned > 0)
    assert.equal(h.A.save.building(index).amount, 0)
    assert.equal(view.buildings[index].price, h.game.unitPrice(index))
})

test('slow redraws cannot turn bulk or sell prices into a unit buy', async () => {
    const h = boot({ game: { bank: 5000, crates: [] } })
    click(h, 'storeBulk10')
    slowStore(h)
    await purchaseTick(h)
    assert.equal(h.debug().decision.target.price, 100)
    assert.equal(h.game.state.amount, 10)
    assert.equal(h.game.state.log.filter(s => /^buy /.test(s)).length, 1)
    await sleep(180)
})

test('transactions exclude competing store operations and cancel after a wait', async () => {
    for (const cancel of ['setting', 'pause', 'stop', 'user']) {
        const h = boot({ game: { bank: 5000, crates: [] } })
        click(h, 'storeBulk10')
        slowStore(h)
        const purchasing = purchaseTick(h)
        await sleep(30)
        const product = h.A.live.readProducts()[0]
        assert.equal(await h.A.act.store.sell(product, 10), false)
        if (cancel === 'setting') h.A.store.setSetting('purchase', false)
        if (cancel === 'pause') h.A.scheduler.pause()
        if (cancel === 'stop') h.A.scheduler.stop()
        if (cancel === 'user') {
            const target = h.game.bulk.storeBulk100
            h.game.doc.fire('pointerdown', { isTrusted: true, target })
            click(h, target.id)
        }
        await purchasing
        assert.equal(h.game.state.owned[0], 0, cancel)
        assert.equal(h.game.state.amount, cancel === 'user' ? 100 : 10, cancel)
        await sleep(180)
    }
})

test('a cancelled switch restored before redraw does not stall subsequent purchases', async () => {
    const h = boot({ game: { bank: 5000, crates: [] } })
    click(h, 'storeBulk10')
    slowStore(h)
    const purchasing = purchaseTick(h)
    await sleep(30)
    h.A.scheduler.pause()
    await purchasing
    await sleep(180)
    assert.equal(h.game.state.amount, 10)
    h.A.scheduler.resume()
    await purchaseTick(h)
    assert.equal(h.debug().decision.target.price, 100)
    assert.equal(h.game.state.log.filter(s => /^buy /.test(s)).length, 1)
    assert.equal(h.game.state.amount, 10)
    await sleep(180)
})

test('player controls changed between transactions replace the pending restoration redraw', async () => {
    for (const settled of [false, true]) {
        const h = boot({ game: { bank: 1e6, crates: [] } })
        click(h, 'storeBulkSell')
        click(h, 'storeBulk10')
        slowStore(h, 40)
        await purchaseTick(h)
        await sleep(60)
        assert.equal(h.game.state.mode, 'sell')
        assert.equal(h.game.state.amount, 10)

        click(h, 'storeBulkBuy')
        click(h, 'storeBulk1')
        if (settled) await sleep(60)
        const purchases = () => h.game.state.log.filter(s => /^buy /.test(s)).length
        const before = purchases()
        await purchaseTick(h)
        assert.equal(purchases(), before + 1)
        await purchaseTick(h)
        assert.equal(purchases(), before + 2)
        assert.equal(h.game.state.mode, 'buy')
        assert.equal(h.game.state.amount, 1)
        await sleep(60)
    }
})

test('the available balance is checked again after changing purchase quantity', async () => {
    const h = boot({ game: { bank: 5000, crates: [] } })
    slowStore(h)
    const buying = h.A.act.store.buy(h.A.live.readProducts()[0], 10, 5000)
    await sleep(30)
    h.game.state.bank = 1
    h.game.refresh()
    const result = await buying
    assert.equal(result.bought, false)
    assert.match(result.reason, /budget/)
    assert.equal(h.game.state.owned[0], 0)
    assert.equal(h.game.state.amount, 1)
    await sleep(180)
})

test('a refused purchase is not counted, and partial fills report observed quantity', async () => {
    for (const partial of [0, 3]) {
        const h = boot({ game: { bank: 5000, crates: [] } })
        const product = h.A.live.readProducts()[0]
        product.element.listeners.click = [
            () => {
                h.game.state.owned[0] += partial
                h.game.refresh()
            }
        ]
        const result = await h.A.act.store.buy(product, 10, 5000)
        assert.equal(result.bought, partial > 0)
        assert.equal(result.amount, partial)
        assert.equal(h.game.state.amount, 1)
    }
})

const DONE = { 0: 12, 2: 9, 5: 1, 6: 1, 7: 1, 1: 1 }
const AMOUNTS = { 0: 10, 1: 10, 2: 10, 5: 10, 6: 10, 7: 10 }
function lumpsBoot({ lumps = 102, levels = DONE, askLumps = false, delay = 0, onPrompt } = {}) {
    const h = boot({
        save: fx.save({ lumps, lumpsTotal: 500, levels, amounts: AMOUNTS }).raw,
        game: {
            lumps,
            levels: Array.from({ length: 8 }, (_, i) => levels[i] || 0),
            askLumps,
            lumpPromptDelay: delay,
            onLumpPrompt: onPrompt
        }
    })
    // make Grandma the highest producer, eligible for a two-lump post-plan upgrade
    h.A.save.get().buildings[1].totalCookies = 1e12
    return h
}
const lumpTick = h => h.A.registry.get('lumps').tick()

test('102 lumps permits one two-lump post-plan upgrade, before autosave', async () => {
    for (const askLumps of [false, true]) {
        const h = lumpsBoot({ askLumps })
        await lumpTick(h)
        await lumpTick(h)
        await lumpTick(h)
        assert.equal(h.game.state.lumps, 100)
        assert.equal(h.game.state.levels[1], 2)
        assert.equal(h.A.save.get().scalars.lumps, 102)
        assert.equal(h.game.state.log.filter(s => /^levelled/.test(s)).length, 1)
    }
})

test('pending lump spends remain reserved when live counters are missing', async () => {
    const h = lumpsBoot()
    const node = h.game.doc.getElementById('lumpsAmount')
    node.parent.children = node.parent.children.filter(n => n !== node)
    await lumpTick(h)
    await lumpTick(h)
    assert.equal(h.game.state.lumps, 100)
    assert.equal(h.game.state.levels[1], 2)
})

test('unobserved lump spends are reserved until autosave reconciles them', async () => {
    const h = lumpsBoot()
    const amount = h.game.doc.getElementById('lumpsAmount')
    amount.parent.children = amount.parent.children.filter(n => n !== amount)
    const badge = h.game.levelBadges[1]
    Object.defineProperty(badge, 'innerText', { get: () => '', set: () => {} })
    await lumpTick(h)
    await lumpTick(h)
    assert.equal(h.game.state.lumps, 100)
    assert.equal(h.game.state.log.filter(s => /^levelled/.test(s)).length, 1)
    // autosave acknowledges the reservation; newly earned lumps become usable
    const saved = h.A.save.get()
    saved.buildings[1].level = 2
    saved.scalars.lumps = 103
    h.game.state.lumps = 103
    await lumpTick(h)
    assert.equal(h.game.state.log.filter(s => /^levelled/.test(s)).length, 2)
    assert.equal(h.game.state.lumps, 100)
})

test('autosave releases a lump ceiling left below the balance by harvesting and spending', async () => {
    const h = lumpsBoot()
    const saved = h.A.save.get()
    saved.scalars.lumpT = Date.now() - 23.5 * 3600000
    // Harvesting changes the game balance before its next displayed update.
    h.game.doc.getElementById('lumps').listeners.click = [() => h.game.state.lumps++]
    await lumpTick(h)
    assert.equal(h.game.state.lumps, 101)
    assert.equal(h.game.state.levels[1], 2)

    h.game.state.lumps = 104
    h.game.doc.getElementById('lumpsAmount').innerText = '104'
    await lumpTick(h)
    assert.equal(h.game.state.levels[1], 2, 'unacknowledged spends remain reserved')
    saved.buildings[1].level = 2
    saved.scalars.lumps = 104
    await lumpTick(h)
    assert.equal(h.game.state.levels[1], 3)
    assert.equal(h.game.state.lumps, 101)
})

test('early minigame unlocks may intentionally spend below the reserve', async () => {
    const h = lumpsBoot({ lumps: 1, levels: {} })
    await lumpTick(h)
    assert.equal(h.game.state.lumps, 0)
    assert.equal(h.game.state.levels[7], 1)
})

test('lump confirmation rechecks changed balances, levels, costs and settings', async () => {
    for (const change of ['balance', 'level', 'cost', 'setting', 'prompt']) {
        const h = lumpsBoot({
            askLumps: true,
            delay: 150,
            onPrompt: doc => {
                if (change === 'cost')
                    doc.getElementById('promptContentSpendLump').innerText = 'Spend 3 lumps?'
                if (change === 'prompt') h.game.openCustomizer()
            }
        })
        const spending = lumpTick(h)
        await sleep(40)
        if (change === 'balance') {
            h.game.state.lumps = 101
            h.game.doc.getElementById('lumpsAmount').innerText = '101'
        }
        if (change === 'level') {
            h.game.state.levels[1] = 2
            h.game.levelBadges[1].innerText = 'lvl 2'
        }
        if (change === 'setting') h.A.store.setSetting('lumps', false)
        await spending
        await sleep(180)
        assert.equal(h.game.state.log.filter(s => /^levelled/.test(s)).length, 0, change)
        if (change === 'prompt') assert.ok(h.game.doc.getElementById('promptContentCustomizeYou'))
    }
})

function marketBoot(goods, { hoverRedraw = false } = {}) {
    const h = boot({
        save: fx.save({
            rawCps: 10,
            levels: { 5: 1 },
            amounts: { 5: 10 },
            minigames: { 5: fx.market({ goods }) }
        }).raw,
        game: { bank: 1e6 }
    })
    goods.forEach((good, id) => {
        const row = new El('div', { id: `bankGood-${id}` })
        h.game.doc.body.append(row)
        const add = (suffix, text) => {
            const node = new El('div', { id: `bankGood-${id}${suffix}`, text: String(text) })
            row.append(node)
            return node
        }
        let held = good.stock || 0
        const stock = add('-stock', held)
        add('-stockMax', '/' + (good.capacity || 10))
        add('-val', '$' + good.val)
        const draw = () => {
            stock.innerText = String(held)
        }
        if (hoverRedraw) {
            // The real market only draws changed holdings when its graph is dirty.
            // Start hovered so a repeated mouseover alone cannot request a redraw.
            let hovered = true
            row.addEventListener('mouseout', () => {
                hovered = false
            })
            row.addEventListener('mouseover', () => {
                if (!hovered) setTimeout(draw, good.delay || 25)
                hovered = true
            })
        }
        const execute = selling => {
            h.game.state.log.push(`attempt ${selling ? 'sell' : 'buy'} ${id}`)
            if (good.refused) return
            const quantity = selling ? -held : Math.min(good.fill ?? 100, good.capacity - held)
            held += quantity
            if (hoverRedraw) return
            if (good.delay) setTimeout(draw, good.delay)
            else draw()
        }
        add('_100', '100').addEventListener('click', () => execute(false))
        add('_-All', 'All').addEventListener('click', () => execute(true))
    })
    return h
}
const marketTick = h => h.A.registry.get('market').tick()

test('market trades request a holdings redraw before retrying or starting cooldown', async () => {
    for (const selling of [false, true]) {
        const h = marketBoot(
            [
                { val: 1, mode: selling ? 4 : 3, stock: selling ? 8 : 0, capacity: 1000 },
                { val: 5, mode: 3, stock: 0, capacity: 10 }
            ],
            { hoverRedraw: true }
        )
        await marketTick(h)
        assert.deepEqual(h.game.state.log, [`attempt ${selling ? 'sell' : 'buy'} 0`])
        assert.equal(h.game.doc.getElementById('bankGood-0-stock').innerText, selling ? '0' : '100')
        await marketTick(h)
        assert.equal(h.game.state.log.length, 1, 'the observed fill starts cooldown')
    }
})

test('full Cereals at 91/91 cannot starve Chocolate at 0/10', async () => {
    const h = marketBoot([
        { val: 1, mode: 3, stock: 91, capacity: 91 },
        { val: 5, mode: 3, stock: 0, capacity: 10 }
    ])
    await marketTick(h)
    assert.deepEqual(h.game.state.log, ['attempt buy 1'])
    assert.equal(h.game.doc.getElementById('bankGood-1-stock').innerText, '10')
    await marketTick(h)
    assert.equal(h.game.state.log.length, 1, 'successful partial fill starts cooldown')
})

test('a zero fill tries the next candidate; zero fills do not start cooldown', async () => {
    const h = marketBoot([
        { val: 1, mode: 3, stock: 0, capacity: 10, refused: true },
        { val: 5, mode: 3, stock: 0, capacity: 10, refused: true }
    ])
    await marketTick(h)
    assert.deepEqual(h.game.state.log, ['attempt buy 0', 'attempt buy 1'])
    await marketTick(h)
    assert.equal(h.game.state.log.length, 4)
    const second = h.game.doc.getElementById('bankGood-1_100')
    second.listeners.click = [
        () => {
            h.game.doc.getElementById('bankGood-1-stock').innerText = '4'
        }
    ]
    await marketTick(h)
    assert.equal(h.game.state.log.at(-1), 'attempt buy 0')
    const count = h.game.state.log.length
    await marketTick(h)
    assert.equal(h.game.state.log.length, count)
})

test('market retries are bounded and unavailable, unaffordable candidates are filtered', async () => {
    const h = marketBoot(
        Array.from({ length: 8 }, () => ({ val: 1, mode: 3, capacity: 10, refused: true }))
    )
    await marketTick(h)
    assert.equal(h.game.state.log.length, 3)
    h.game.state.log.length = 0
    h.game.state.bank = 0
    h.game.refresh()
    await marketTick(h)
    assert.equal(h.game.state.log.length, 0)
})

test('slow market redraws are verified before cooldown', async () => {
    const h = marketBoot([
        { val: 20, mode: 4, stock: 8, capacity: 10, delay: 180 },
        { val: 5, mode: 3, stock: 0, capacity: 10 }
    ])
    const selling = marketTick(h)
    await sleep(40)
    assert.equal(h.game.state.log.length, 1)
    await selling
    assert.equal(h.game.doc.getElementById('bankGood-0-stock').innerText, '0')
    await marketTick(h)
    assert.equal(h.game.state.log.length, 1)
})

test('refused sells try another candidate and partial sells start cooldown', async () => {
    const h = marketBoot([
        { val: 20, mode: 4, stock: 8, capacity: 10, refused: true },
        { val: 30, mode: 4, stock: 8, capacity: 10 }
    ])
    const second = h.game.doc.getElementById('bankGood-1_-All')
    second.listeners.click = [
        () => {
            h.game.doc.getElementById('bankGood-1-stock').innerText = '5'
        }
    ]
    await marketTick(h)
    assert.deepEqual(h.game.state.log, ['attempt sell 0'])
    assert.equal(h.game.doc.getElementById('bankGood-1-stock').innerText, '5')
    await marketTick(h)
    assert.equal(h.game.state.log.length, 1)
})

test('user changes while verifying a market fill stop further attempts', async () => {
    const h = marketBoot([
        { val: 1, mode: 3, capacity: 10, refused: true },
        { val: 5, mode: 3, capacity: 10 }
    ])
    const trading = marketTick(h)
    await sleep(40)
    h.A.store.setSetting('marketTrading', false)
    await trading
    assert.equal(h.game.state.log.length, 1)
})
