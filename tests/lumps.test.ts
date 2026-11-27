const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./harness')
const fx = require('./fixtures')

const LEVELS = { 0: 12, 1: 1, 2: 9, 5: 1, 6: 1, 7: 2 }
const AMOUNTS = { 0: 10, 1: 10, 2: 10, 5: 10, 6: 10, 7: 10 }
const tick = h => h.A.registry.get('lumps').tick()

async function wizard({ askLumps = true }: Record<string, any> = {}) {
    const scene = fx.autosaves({ lumps: 103, lumpsTotal: 103, levels: LEVELS, amounts: AMOUNTS })
    const h = boot({
        localStorage: scene.localStorage,
        game: {
            lumps: 103,
            levels: Array.from({ length: 8 }, (_, i) => LEVELS[i] || 0),
            askLumps
        }
    })
    await h.A.store.ready(h.A.identity.current())
    const rank = () => (h.A.save.get().buildings[7].totalCookies = 1e12)
    rank()
    return { h, scene, rank }
}

// Hold delivery after the real waiter has observed the real SpendLump prompt.
function holdResult(h) {
    const original = h.A.transactions.until
    let release
    let reached
    const ready = new Promise(resolve => (reached = resolve))
    h.A.transactions.until = async (...args) => {
        const result = await original(...args)
        h.A.transactions.until = original
        reached()
        await new Promise(resolve => (release = resolve))
        return result
    }
    return { ready, release: () => release() }
}

for (const cancellation of ['pause', 'No', 'Import save']) {
    test(`cancelled cost-three Wizard confirmation recovers after ${cancellation}`, async () => {
        const { h, scene, rank } = await wizard()
        const proposal = () => h.A.lumps.nextSpend(103)
        assert.equal(proposal().index, 7)
        assert.equal(proposal().cost, 3)
        assert.equal(proposal().reserve, 100)
        const barrier = holdResult(h)
        const work = tick(h)
        await barrier.ready
        assert.equal(h.A.safety.prompt().id, 'promptContentSpendLump')
        if (cancellation === 'pause') h.A.scheduler.pause()
        else {
            const no = h.game.doc.getElementById('promptOption1')
            h.game.doc.fire('pointerdown', { isTrusted: true, target: no })
            h.A.input.simulateClick(no)
            if (cancellation === 'Import save') h.game.prompt('ImportSave', [['Load'], ['Cancel']])
        }
        barrier.release()
        await work
        assert.equal(h.game.state.lumps, 103)
        assert.equal(h.game.state.levels[7], 2)
        if (cancellation === 'Import save') {
            assert.equal(h.A.safety.prompt().id, 'promptContentImportSave')
            h.A.input.simulateClick(h.game.doc.getElementById('promptOption1'))
        } else assert.equal(h.A.safety.prompt(), null)
        h.A.scheduler.resume()
        assert.equal(proposal()?.cost, 3, 'cancellation must leave no planned level')
        scene.publish()
        await h.A.registry.get('saveWatch').tick()
        rank()
        assert.equal(proposal()?.cost, 3, 'a normal unchanged save must stay actionable')
        await tick(h)
        await tick(h)
        assert.equal(h.game.state.lumps, 100)
        assert.equal(h.game.state.levels[7], 3)
        assert.equal(h.game.state.log.filter(line => /^levelled/.test(line)).length, 1)
    })
}

test('an immediate spend stays reserved when its result is delivered after pause', async () => {
    const { h } = await wizard({ askLumps: false })
    const barrier = holdResult(h)
    const work = tick(h)
    await barrier.ready
    assert.equal(h.game.state.lumps, 100)
    h.A.scheduler.pause()
    barrier.release()
    await work
    h.A.scheduler.resume()
    await tick(h)
    await tick(h)
    assert.equal(h.game.state.lumps, 100)
    assert.equal(h.game.state.levels[7], 3)
    assert.equal(h.game.state.log.filter(line => /^levelled/.test(line)).length, 1)
})

test('an unreadable immediate spend cannot repeat after pause before autosave', async () => {
    const { h, scene, rank } = await wizard({ askLumps: false })
    const amount = h.game.doc.getElementById('lumpsAmount')
    amount.parent.children = amount.parent.children.filter(node => node !== amount)
    Object.defineProperty(h.game.levelBadges[7], 'innerText', {
        get: () => '',
        set: () => {}
    })
    const original = h.A.transactions.until
    h.A.transactions.until = (lease, read) => original(lease, read, 0)
    const barrier = holdResult(h)
    const work = tick(h)
    await barrier.ready
    h.A.scheduler.pause()
    barrier.release()
    await work
    h.A.scheduler.resume()
    await tick(h)
    await tick(h)
    assert.equal(h.game.state.lumps, 100)
    assert.equal(h.game.state.levels[7], 3)
    assert.equal(h.game.state.log.filter(line => /^levelled/.test(line)).length, 1)

    scene.change({ lumps: 100, levels: { ...LEVELS, 7: 3 }, lastDate: Date.now() + 1 })
    scene.publish()
    await h.A.registry.get('saveWatch').tick()
    rank()
    await tick(h)
    assert.equal(h.game.state.lumps, 100)
    assert.equal(h.game.state.log.filter(line => /^levelled/.test(line)).length, 1)
})

for (const cancelled of [false, true]) {
    test(`a refused badge click recovers after a fresh save (cancelled: ${cancelled})`, async () => {
        const { h, scene, rank } = await wizard({ askLumps: false })
        const badge = h.game.levelBadges[7]
        const handlers = badge.listeners.click
        badge.listeners.click = []
        let clicks = 0
        badge.addEventListener('click', () => clicks++)
        // Run the real waiter with an immediate deadline for the unreadable result.
        const original = h.A.transactions.until
        h.A.transactions.until = (lease, read) => original(lease, read, 0)
        const barrier = holdResult(h)
        const work = tick(h)
        await barrier.ready
        if (cancelled) h.A.scheduler.pause()
        barrier.release()
        await work
        h.A.scheduler.resume()
        await tick(h)
        assert.equal(clicks, 1, 'an unknown click cannot be repeated before autosave')
        assert.equal(h.game.state.lumps, 103)
        assert.equal(h.game.state.levels[7], 2)

        scene.change({ lastDate: Date.now() + 1 })
        scene.publish()
        await h.A.registry.get('saveWatch').tick()
        rank()
        assert.equal(h.A.lumps.nextSpend(103)?.cost, 3, 'refusal is not a planned level')
        badge.listeners.click = handlers
        h.A.transactions.until = original
        await tick(h)
        await tick(h)
        assert.equal(h.game.state.lumps, 100)
        assert.equal(h.game.state.levels[7], 3)
    })
}

test('a refused confirmation is not treated as an observed spend', async () => {
    const { h, scene, rank } = await wizard()
    const original = h.A.transactions.until
    h.A.transactions.until = (lease, read) => original(lease, read, 0)
    const barrier = holdResult(h)
    const work = tick(h)
    await barrier.ready
    h.game.doc.getElementById('promptOption0').listeners.click = []
    barrier.release()
    await work
    assert.equal(h.game.state.lumps, 103)
    assert.equal(h.game.state.levels[7], 2)
    assert.equal(h.A.safety.prompt(), null)
    await tick(h)
    assert.equal(h.A.safety.prompt(), null, 'an unsettled click must not be retried')
    scene.change({ lastDate: Date.now() + 1 })
    scene.publish()
    await h.A.registry.get('saveWatch').tick()
    rank()
    assert.equal(h.A.lumps.nextSpend(103)?.cost, 3)
    h.A.transactions.until = original
    await tick(h)
    await tick(h)
    assert.equal(h.game.state.lumps, 100)
    assert.equal(h.game.state.levels[7], 3)
})

test('post-plan spending unlocks level 10 achievements, then Cursor 20, then top producer', async () => {
    const { h } = await wizard()
    const buildings = h.A.save.get().buildings
    buildings[7].totalCookies = 1e12
    buildings[1].totalCookies = 1e11

    // while the top producer is below level 10, level it toward 10 with the 100-lump reserve
    buildings[7].level = 9
    h.game.levelBadges[7].innerText = 'lvl 9'
    assert.equal(h.A.lumps.nextSpend(109), null)
    assert.deepEqual(
        { ...h.A.lumps.nextSpend(110) },
        {
            index: 7,
            name: 'Wizard tower',
            cost: 10,
            reserve: 100,
            why: 'level 10 achievement'
        }
    )

    // once the top producer reaches level 10, move to the next owned building below level 10
    buildings[7].level = 10
    h.game.levelBadges[7].innerText = 'lvl 10'
    assert.equal(h.A.lumps.nextSpend(101), null)
    assert.deepEqual(
        { ...h.A.lumps.nextSpend(102) },
        {
            index: 1,
            name: 'Grandma',
            cost: 2,
            reserve: 100,
            why: 'level 10 achievement'
        }
    )

    // Aura gloves alone stops improving clicks at Cursor 10. Until Luminous
    // gloves is bought, surplus lumps should continue helping the top producer.
    for (const id of [1, 2, 5, 6, 7]) {
        buildings[id].level = 10
        h.game.levelBadges[id].innerText = 'lvl 10'
    }
    const upgrades = h.A.save.get().upgrades
    upgrades[719] = { id: 719, bought: 1 }
    for (const luminous of [undefined, { id: 720, unlocked: 1, bought: 0 }]) {
        upgrades[720] = luminous
        const spend = h.A.lumps.nextSpend(113)
        assert.equal(spend.index, 7)
        assert.equal(spend.why, 'highest producing building')
        assert.equal(spend.cost, 11)
    }
    // Once both gloves are owned, Cursor 13-20 adds the intended click bonus.
    upgrades[720] = { id: 720, bought: 1 }
    assert.equal(h.A.lumps.nextSpend(112), null)
    assert.deepEqual(
        { ...h.A.lumps.nextSpend(113) },
        {
            index: 0,
            name: 'Cursor',
            cost: 13,
            reserve: 100,
            why: 'Luminous gloves click bonus'
        }
    )

    // once Cursor reaches level 20, resume levelling the highest-producing building
    buildings[0].level = 20
    h.game.levelBadges[0].innerText = 'lvl 20'
    assert.equal(h.A.lumps.nextSpend(110), null)
    assert.deepEqual(
        { ...h.A.lumps.nextSpend(111) },
        {
            index: 7,
            name: 'Wizard tower',
            cost: 11,
            reserve: 100,
            why: 'highest producing building'
        }
    )
})
