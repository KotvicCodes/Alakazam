const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./harness')
const fx = require('./fixtures')

const LEVELS = { 0: 12, 1: 1, 2: 9, 5: 1, 6: 1, 7: 2 }
const AMOUNTS = { 0: 10, 1: 10, 2: 10, 5: 10, 6: 10, 7: 10 }
const tick = h => h.A.registry.get('lumps').tick()

async function wizard({ askLumps = true } = {}) {
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
