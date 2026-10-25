const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot, waitFor } = require('./harness')
const { El } = require('./dom')
const fx = require('./fixtures')

// Hold a real await at its boundary so races do not depend on wall-clock timing.
function hold(h, ms) {
    const original = h.ctx.setTimeout
    const pending = []
    h.ctx.setTimeout = (fn, delay) => {
        if (delay === ms) {
            pending.push(fn)
            return 0
        }
        return original(fn, delay)
    }
    return {
        pending,
        release() {
            h.ctx.setTimeout = original
            pending.splice(0).forEach(fn => fn())
        }
    }
}

async function ready(opts = {}) {
    const h = boot({ save: fx.save().raw, ...opts })
    await h.A.store.ready(h.A.identity.current().legacyId)
    return h
}

function register(h, name, tick) {
    h.A.registry.register({ name, tick })
    return h.A.registry.get(name)
}

// The game save and extension storage advance independently. Save only when the
// test requests it, including while a temporary cosmetic value is live.
function autosave(h) {
    const { savefile } = h.A
    const sections = savefile.decode(h.ctx.localStorage.getItem(savefile.SAVE_KEY)).split('|')
    const run = sections[2].split(';')
    run[2] = String(Date.now())
    if (h.game.state.bakeryName !== undefined) run[3] = h.game.state.bakeryName
    run[5] = h.game.state.genes.join(',')
    sections[2] = run.join(';')
    const raw = fx.encode(sections.join('|'))
    h.ctx.localStorage = { getItem: key => (key === savefile.SAVE_KEY ? raw : null) }
    return raw
}

for (const cancel of ['pause', 'stop', 'master', 'module']) {
    test(`${cancel} during a bulk redraw cancels spending and restores controls`, async () => {
        const h = await ready({ game: { bank: 1e9 } })
        const barrier = hold(h, 40)
        const product = h.A.live.readProducts()[0]
        const mod = register(h, 'purchase', ctx => h.A.act.store.buy(product, 10, Infinity, ctx.task))
        const work = mod.tick()
        assert.equal(barrier.pending.length, 1)
        if (cancel === 'pause') {
            h.A.scheduler.pause()
            h.A.scheduler.resume()
        }
        if (cancel === 'stop') h.A.scheduler.stop()
        if (cancel === 'master' || cancel === 'module') {
            const key = cancel === 'master' ? 'enabled' : 'purchase'
            h.A.store.setSetting(key, false)
            h.A.store.setSetting(key, true)
        }
        barrier.release()
        await work
        assert.equal(h.game.state.owned[0], 0)
        assert.equal(h.game.state.amount, 1)
        assert.equal(h.game.state.mode, 'buy')
    })
}

test('bulk ownership serializes competing actions and preserves a newer player selection', async () => {
    const h = await ready({ game: { bank: 1e9 } })
    const barrier = hold(h, 40)
    const product = h.A.live.readProducts()[0]
    const first = h.A.act.store.buy(product, 10, Infinity)
    assert.equal((await h.A.act.store.buy(product, 100, Infinity)).bought, false)
    const button = h.game.doc.getElementById('storeBulk100')
    h.game.doc.fire('pointerdown', { isTrusted: true, target: button })
    h.A.input.simulateClick(button)
    barrier.release()
    assert.equal((await first).bought, false)
    assert.equal(h.game.state.amount, 100)
    assert.equal(h.game.state.owned[0], 0)
})

test('mouse movement alone does not strand the store in Sell after cancellation', async () => {
    const h = await ready()
    const barrier = hold(h, 40)
    const mod = register(h, 'purchase', ctx =>
        h.A.act.store.sell(h.A.live.readProducts()[0], 10, ctx.task)
    )
    const work = mod.tick()
    h.game.doc.fire('mousemove', { isTrusted: true, target: h.game.doc.body })
    h.A.scheduler.pause()
    barrier.release()
    await work
    assert.equal(h.game.state.mode, 'buy')
    assert.equal(h.game.state.amount, 1)
})

test('gift work stops at an await and releases its prompt lease', async () => {
    const h = await ready({
        save: fx.save({ heavenlyChipsSpent: 999999 }).raw,
        game: { bank: 1e12, wrappingPaper: true }
    })
    const barrier = hold(h, 350)
    const work = h.A.registry.get('gifts').tick()
    assert.equal(barrier.pending.length, 1)
    h.A.scheduler.pause()
    barrier.release()
    await work
    assert.equal(h.game.state.log.includes('wrapped a gift'), false)
    h.A.scheduler.resume()
    await h.A.registry.get('clones').tick() // another prompt owner can run again
    assert.equal(h.A.safety.acquire('prompt', 'probe') !== null, true)
})

for (const replacement of ['WipeSave', 'SpendLump']) {
    test(`a replacement ${replacement} prompt is never confirmed or dismissed`, async () => {
        const h = await ready({
            save: fx.save({ lumps: 1, lumpsTotal: 1, amounts: { 7: 1 } }).raw,
            game: { askLumps: true }
        })
        const barrier = hold(h, 120)
        const work = h.A.registry.get('lumps').tick()
        assert.equal(h.A.safety.ownsPrompt('lumps', 'SpendLump'), true)
        let answered = 0
        h.game.prompt(replacement, [
            ['Yes', () => answered++],
            ['No', () => answered++]
        ])
        barrier.release()
        await work
        assert.equal(answered, 0)
        assert.equal(h.A.safety.prompt().id, 'promptContent' + replacement)
        assert.equal(
            h.game.state.log.some(line => line.startsWith('levelled')),
            false
        )
    })
}

test('cancelling a lump await closes only its own confirmation without spending', async () => {
    const h = await ready({
        save: fx.save({ lumps: 1, lumpsTotal: 1, amounts: { 7: 1 } }).raw,
        game: { askLumps: true }
    })
    const barrier = hold(h, 120)
    const work = h.A.registry.get('lumps').tick()
    h.A.scheduler.pause()
    barrier.release()
    await work
    assert.equal(h.A.safety.prompt(), null)
    assert.equal(
        h.game.state.log.some(line => line.startsWith('levelled')),
        false
    )
})

test('a foreign customizer is not adopted even though its type is expected', async () => {
    const h = await ready({ save: fx.save({ amounts: { 19: 1 } }).raw })
    h.game.openCustomizer()
    const before = h.game.state.genes.slice()
    await h.A.registry.get('clones').tick()
    assert.deepEqual(h.game.state.genes, before)
    assert.equal(h.A.safety.prompt().id, 'promptContentCustomizeYou')
})

test('closed prompt markup is ignored, including when the next prompt has the same type', async () => {
    const h = await ready({ game: { keepClosedPrompts: true } })
    h.A.act.ascend.openLegacy()
    assert.equal(h.A.act.ascend.cancelPrompt('ascend'), true)
    assert.ok(h.game.doc.getElementById('promptContentAscend'))
    assert.equal(h.A.safety.prompt(), null)
    h.game.prompt('Ascend', [['Yes'], ['No']])
    assert.equal(h.A.act.ascend.confirmPrompt('ascend'), false)
})

test('tooltip cancellation releases its lease and hovers off in cleanup', async () => {
    const h = await ready()
    const target = h.A.live.readProducts()[0].element
    const barrier = hold(h, 90)
    const mod = register(h, 'catalog', ctx => h.A.catalog.readTooltip(target, ctx.task))
    const work = mod.tick()
    h.A.scheduler.pause()
    barrier.release()
    await work
    assert.ok(target.events.includes('mouseout'))
    const lease = h.A.safety.acquire('tooltip', 'probe')
    assert.ok(lease)
    lease.release()
})

test('tooltip cleanup leaves a newer user hover alone', async () => {
    const h = await ready()
    const target = h.A.live.readProducts()[0].element
    const barrier = hold(h, 90)
    const work = h.A.catalog.readTooltip(target)
    h.game.doc.fire('mousemove', { isTrusted: true, target: h.game.doc.body })
    barrier.release()
    assert.equal(await work, null)
    assert.equal(target.events.includes('mouseout'), false)
})

test('a cancelled drag releases the mouse away from the target without completing the drop', async () => {
    const h = await ready()
    const source = new El('div')
    const target = new El('div')
    h.game.doc.body.append(source, target)
    let dropped = 0
    target.addEventListener('mouseup', () => dropped++)
    const barrier = hold(h, 60)
    const mod = register(h, 'pantheon', ctx => h.A.act.drag.dragTo(source, target, ctx.task))
    const work = mod.tick()
    h.A.scheduler.pause()
    barrier.release()
    await work
    assert.equal(dropped, 0)
    assert.ok(h.game.doc.body.events.includes('mouseup'))
})

test('pausing during a dragon panel await prevents training and remains paused after cleanup', async () => {
    const h = await ready({
        save: fx.save({ dragonLevel: 5 }).raw,
        game: { bank: 1e9, owned: [300, 0, 0, 0, 0, 0, 0, 0], dragon: { level: 5, trainable: true } }
    })
    const barrier = hold(h, 150)
    const work = h.A.registry.get('dragon').tick()
    assert.ok(await waitFor(() => barrier.pending.length > 0, 2000, 5))
    h.A.scheduler.pause()
    barrier.release()
    await work
    assert.equal(h.game.dragon.level, 5)
    assert.equal(h.A.scheduler.isPaused(), true)
    assert.equal(h.A.act.dragon.panelOpen(), false)
})

for (const paused of [false, true]) {
    test(`a player replacement dragon panel survives the old visit${
        paused ? ' after pause' : ''
    }`, async () => {
        const h = await ready({
            save: fx.save({ dragonLevel: 5 }).raw,
            game: {
                bank: 1e9,
                owned: [300, 0, 0, 0, 0, 0, 0, 0],
                dragon: { level: 5, trainable: true }
            }
        })
        const barrier = hold(h, 150)
        const work = h.A.registry.get('dragon').tick()
        assert.ok(await waitFor(() => barrier.pending.length > 0, 2000, 5))
        const doc = h.game.doc
        const oldPic = doc.getElementById('specialPic')
        const close = doc.querySelector('#specialPopup .close')
        doc.fire('pointerdown', { isTrusted: true, target: close })
        h.A.input.simulateClick(close)
        const canvas = doc.getElementById('backgroundLeftCanvas')
        doc.fire('pointerdown', { isTrusted: true, target: canvas })
        h.A.input.simulateClickAt(canvas, 24, canvas.height - 72)
        const replacement = doc.getElementById('specialPic')
        assert.notEqual(replacement, oldPic)
        if (paused) h.A.scheduler.pause()
        barrier.release()
        await work
        assert.equal(h.A.act.dragon.panelOpen(), true, 'cleanup preserves the player panel')
        assert.equal(doc.getElementById('specialPic'), replacement)
        assert.equal(h.game.dragon.level, 5, 'the old visit never trains the replacement')
        assert.equal(h.game.dragon.pets, 0)
        assert.equal(h.A.scheduler.isPaused(), paused)
    })
}

for (const paused of [false, true]) {
    test(`an automatic dragon redraw preserves the visit${paused ? ' cleanup after pause' : ''}`, async () => {
        const h = await ready({
            save: fx.save({ dragonLevel: 5 }).raw,
            game: {
                bank: 1e9,
                owned: [300, 0, 0, 0, 0, 0, 0, 0],
                dragon: { level: 5, trainable: true }
            }
        })
        const barrier = hold(h, 150)
        const work = h.A.registry.get('dragon').tick()
        assert.ok(await waitFor(() => barrier.pending.length > 0, 2000, 5))
        const pic = h.game.doc.getElementById('specialPic')
        // Game.ToggleSpecialMenu rebuilds the contents every three seconds, with no
        // player interaction and without replacing the shared popup container.
        h.game.drawDragon()
        assert.notEqual(h.game.doc.getElementById('specialPic'), pic)
        if (paused) h.A.scheduler.pause()
        barrier.release()
        await work
        assert.equal(h.game.dragon.level, paused ? 5 : 15)
        assert.equal(h.A.act.dragon.panelOpen(), false, 'the owned panel was closed')
        assert.equal(h.A.scheduler.isPaused(), paused)
        // a later operation can open the panel, rather than being stranded by an
        // already-open panel that nobody can claim.
        if (paused) h.A.scheduler.resume()
        assert.equal(await h.A.act.dragon.open(), true)
        assert.equal(h.A.act.dragon.train(), true)
        assert.equal(h.game.dragon.level, paused ? 6 : 16)
        assert.equal(await h.A.act.dragon.close(), true)
    })
}

test('dragon actors retain ownership across an automatic redraw after opening', async () => {
    const h = await ready({ game: { dragon: { level: 5, trainable: true } } })
    assert.equal(await h.A.act.dragon.open(), true)
    h.game.drawDragon()
    assert.equal(h.A.act.dragon.ownsPanel(), true)
    assert.equal(h.A.act.dragon.pet(), true)
    assert.equal(h.A.act.dragon.train(), true)
    assert.equal(h.game.dragon.level, 6)
    assert.equal(h.game.dragon.pets, 1)
    assert.equal(await h.A.act.dragon.close(), true)
})

for (const takeover of ['trusted input', 'replacement popup']) {
    test(`dragon actors refuse ${takeover} after opening`, async () => {
        const h = await ready({ game: { dragon: { level: 5, trainable: true } } })
        assert.equal(await h.A.act.dragon.open(), true)
        if (takeover === 'trusted input') {
            h.game.doc.fire('pointerdown', {
                isTrusted: true,
                target: h.game.doc.getElementById('specialPic')
            })
            h.game.drawDragon()
        } else {
            const popup = h.game.specialPopup
            const replacement = new El('div', { id: 'specialPopup' })
            replacement.append(...popup.children)
            h.game.doc.body.children = h.game.doc.body.children.map(node =>
                node === popup ? replacement : node
            )
        }
        const pic = h.game.doc.getElementById('specialPic')
        assert.equal(h.A.act.dragon.train(), false)
        assert.equal(h.A.act.dragon.pet(), false)
        assert.equal(await h.A.act.dragon.setAura(1, 0), false)
        assert.equal(await h.A.act.dragon.close(), false)
        assert.equal(await h.A.act.dragon.open(), false, 'open cannot adopt the player panel')
        assert.equal(h.game.doc.getElementById('specialPic'), pic)
        assert.equal(h.game.dragon.level, 5)
        assert.equal(h.game.dragon.pets, 0)
        assert.equal(h.A.safety.prompt(), null)
    })
}

for (const waitNumber of [1, 2]) {
    test(`dragon aura selection survives an automatic redraw at wait ${waitNumber}`, async () => {
        const h = await ready({
            game: { owned: [10, 0, 0, 0, 0, 0, 0, 0], dragon: { level: 27 } }
        })
        await h.A.act.dragon.open()
        const barrier = hold(h, 150)
        const work = h.A.act.dragon.setAura(15, 0)
        assert.equal(barrier.pending.length, 1)
        if (waitNumber === 2) {
            barrier.pending.shift()()
            assert.ok(await waitFor(() => barrier.pending.length === 1, 1000, 5))
        }
        h.game.drawDragon()
        barrier.release()
        assert.equal(await work, true)
        assert.equal(h.game.dragon.aura, 15)
        assert.equal(h.game.state.owned[0], 9)
        assert.equal(await h.A.act.dragon.close(), true)
    })

    test(`dragon aura work & cancellation preserve a takeover at wait ${waitNumber}`, async () => {
        const h = await ready({
            game: { owned: [10, 0, 0, 0, 0, 0, 0, 0], dragon: { level: 27 } }
        })
        await h.A.act.dragon.open()
        const barrier = hold(h, 150)
        const work = h.A.act.dragon.setAura(15, 0)
        assert.equal(barrier.pending.length, 1)
        if (waitNumber === 2) {
            barrier.pending.shift()()
            assert.ok(await waitFor(() => barrier.pending.length === 1, 1000, 5))
        }
        const prompt = h.A.safety.prompt()
        h.game.doc.fire('pointerdown', {
            isTrusted: true,
            target: h.game.doc.getElementById('specialPic')
        })
        barrier.release()
        assert.equal(await work, false)
        assert.equal(await h.A.act.dragon.cancel(), false)
        assert.equal(await h.A.act.dragon.close(), false)
        assert.equal(h.A.safety.prompt(), prompt)
        assert.equal(h.game.dragon.aura, 0)
        assert.equal(h.game.state.owned[0], 10)
        assert.equal(h.A.act.dragon.panelOpen(), true)
    })
}

test('a dragon visit never adopts a panel the player already opened', async () => {
    const h = await ready({
        save: fx.save({ dragonLevel: 5 }).raw,
        game: { owned: [300, 0, 0, 0, 0, 0, 0, 0], dragon: { level: 5, trainable: true } }
    })
    const canvas = h.game.leftCanvas
    h.A.input.simulateClickAt(canvas, 24, canvas.height - 72)
    const pic = h.game.doc.getElementById('specialPic')
    await h.A.registry.get('dragon').tick()
    assert.equal(h.game.doc.getElementById('specialPic'), pic)
    assert.equal(h.game.dragon.level, 5)
    assert.equal(h.game.dragon.pets, 0)
})

function seeds(h) {
    const soil = new El('div', { id: 'gardenSoil-0', class: 'gardenSeed gardenSoil on' })
    const container = new El('div', { id: 'gardenSeeds' })
    h.game.doc.body.append(soil, container)
    const nodes = [0, 1].map(id => new El('div', { id: 'gardenSeed-' + id, class: 'gardenSeed' }))
    for (const node of nodes) {
        node.addEventListener('click', () => {
            const was = node.classList.contains('on')
            nodes.forEach(other => other.classList.remove('on'))
            if (!was) node.classList.add('on')
        })
        container.append(node)
    }
    h.A.input.simulateClick(nodes[1])
    return nodes
}

test('garden harvesting runs with active soil and no seed selected', async () => {
    const h = await ready()
    const nodes = seeds(h)
    h.A.input.simulateClick(nodes[1])
    const soil = h.game.doc.getElementById('gardenSoil-0')
    const tile = new El('div', { id: 'gardenTile-0-0' })
    h.game.doc.body.append(tile)
    let harvested = 0
    tile.addEventListener('click', () => harvested++)

    assert.equal(
        h.A.garden.withSeed(null, () => h.A.input.simulateClick(tile)),
        true
    )
    assert.equal(harvested, 1)
    assert.equal(h.game.doc.querySelector('#gardenSeeds .gardenSeed.on'), null)
    assert.equal(soil.classList.contains('on'), true)
    assert.equal(soil.events.includes('click'), false)
})

test('garden harvesting deselects the active seed and restores it even on failure', async () => {
    const h = await ready()
    const nodes = seeds(h)
    assert.throws(
        () =>
            h.A.garden.withSeed(null, () => {
                assert.equal(h.game.doc.querySelector('#gardenSeeds .gardenSeed.on'), null)
                throw new Error('tile failed')
            }),
        /tile failed/
    )
    assert.equal(h.game.doc.querySelector('#gardenSeeds .gardenSeed.on'), nodes[1])
})

test('garden cleanup respects a player selection and planting preserves an already selected seed', async () => {
    const h = await ready()
    const nodes = seeds(h)
    h.A.garden.withSeed(nodes[1], () => {
        assert.equal(h.game.doc.querySelector('#gardenSeeds .gardenSeed.on'), nodes[1])
        h.A.input.simulateClick(nodes[1]) // planting consumes the selection
        return true
    })
    assert.equal(h.game.doc.querySelector('#gardenSeeds .gardenSeed.on'), nodes[1])
    h.A.garden.withSeed(null, () => {
        h.game.doc.fire('pointerdown', { isTrusted: true, target: nodes[0] })
        h.A.input.simulateClick(nodes[0])
    })
    assert.equal(h.game.doc.querySelector('#gardenSeeds .gardenSeed.on'), nodes[0])
})

function nameRoutine(h) {
    return register(h, 'achievements', () => h.A.achievements.godComplex()).tick()
}

test('God complex restores the live name rather than the old autosave or branding', async () => {
    const h = await ready({
        save: fx.save({ bakeryName: 'Old saved name' }).raw,
        game: { bakeryName: 'My live bakery' }
    })
    await nameRoutine(h)
    assert.equal(h.game.state.bakeryName, 'My live bakery')
    assert.ok(h.A.store.get('bakeryNameRecovery', null), 'the save still has the old name')
    autosave(h)
    h.A.achievements.recoverName()
    assert.equal(h.A.store.get('bakeryNameRecovery', null), null)
    assert.equal(h.A.safety.prompt(), null)
})

for (const delay of [350, 600]) {
    test(`God complex cancellation during its ${delay}ms await restores the original`, async () => {
        const h = await ready({ game: { bakeryName: 'My bakery' } })
        const barrier = hold(h, delay)
        const work = nameRoutine(h)
        assert.ok(await waitFor(() => barrier.pending.length > 0, 2000, 5))
        h.A.scheduler.pause()
        barrier.release()
        await work
        assert.equal(h.game.state.bakeryName, 'My bakery')
        assert.equal(h.A.safety.prompt(), null)
    })
}

test('a deliberate newer bakery name survives completion and recovery', async () => {
    const h = await ready({ game: { bakeryName: 'Original' } })
    const barrier = hold(h, 600)
    const work = nameRoutine(h)
    assert.ok(await waitFor(() => barrier.pending.length > 0, 2000, 5))
    h.game.state.bakeryName = 'New deliberate name'
    barrier.release()
    await work
    assert.equal(h.game.state.bakeryName, 'New deliberate name')
    assert.equal(h.A.store.get('bakeryNameRecovery', null), null)
})

test('name recovery defers around a foreign prompt then restores after reload with a new seed', async () => {
    const disk = {}
    const h = await ready({ disk, game: { bakeryName: 'Original' } })
    const id = h.A.identity.current().legacyId
    h.A.store.set('bakeryNameRecovery', { legacyId: id, original: 'Original', expected: 'Orteil' })
    await h.A.store.flush()
    const reloaded = await ready({
        disk,
        save: fx.save({ seed: 'newseed' }).raw,
        game: { bakeryName: 'Orteil' }
    })
    assert.equal(reloaded.A.identity.current().legacyId, id)
    reloaded.game.prompt('WipeSave', [['Yes'], ['No']])
    assert.equal(reloaded.A.achievements.recoverName(), false)
    assert.ok(reloaded.A.store.get('bakeryNameRecovery', null))
    reloaded.A.input.simulateClick(reloaded.game.doc.getElementById('promptOption1'))
    reloaded.A.store.setSetting('achievements', false)
    reloaded.A.registry.get('achievements').setup()
    assert.equal(reloaded.game.state.bakeryName, 'Original')
})

test('a foreign prompt during the rename await is not answered', async () => {
    const h = await ready({ game: { bakeryName: 'Original' } })
    const barrier = hold(h, 350)
    const work = nameRoutine(h)
    h.game.prompt('WipeSave', [['Yes', () => assert.fail('confirmed foreign prompt')], ['No']])
    barrier.release()
    await work
    assert.equal(h.game.state.bakeryName, 'Original')
    assert.equal(h.A.safety.prompt().id, 'promptContentWipeSave')
})

test('clone styling restores the exact live snapshot, even when the save records a different look', async () => {
    const live = [4, 5, 6, 1, 2, 3, 4]
    const h = await ready({
        save: fx.save({ amounts: { 19: 1 }, appearance: '0,1,0,0,0,0,0' }).raw,
        game: { genes: live }
    })
    await h.A.registry.get('clones').tick()
    assert.deepEqual(h.game.state.genes, live)
    assert.equal(h.game.state.likenessWon, true)
    assert.equal(h.A.store.get('clonesStyled', false), true)
    assert.ok(h.A.store.get('cloneRecovery', null), 'the restored look is not saved yet')
    autosave(h)
    await h.A.clones.recover()
    assert.equal(h.A.store.get('cloneRecovery', null), null)
})

test('cancellation during a clone journal await restores a partial walk', async () => {
    const live = [4, 5, 6, 1, 2, 3, 4]
    const h = await ready({
        save: fx.save({ amounts: { 19: 1 }, appearance: live.join(',') }).raw,
        game: { genes: live }
    })
    const flush = h.A.store.flush
    let writes = 0
    h.A.store.flush = async () => {
        const persisted = await flush()
        if (++writes === 5) h.A.scheduler.pause()
        return persisted
    }
    await h.A.registry.get('clones').tick()
    assert.deepEqual(h.game.state.genes, live)
    assert.equal(h.A.store.get('clonesStyled', false), false)
    assert.equal(h.A.store.get('cloneRecovery', null), null)
    assert.equal(h.A.safety.prompt(), null)
})

for (const changed of [false, true]) {
    test(`clone reload recovery ${changed ? 'respects a newer user look' : 'restores the live original despite a changed seed'}`, async () => {
        const original = [4, 5, 6, 1, 2, 3, 4]
        const temporary = [9, 1, 1, 3, 7, 3, 0]
        const newer = [2, 4, 1, 0, 3, 5, 7]
        const disk = {}
        const first = await ready({ disk })
        const id = first.A.identity.current().legacyId
        first.A.store.set('cloneRecovery', {
            legacyId: id,
            original,
            expected: temporary,
            previous: temporary,
            earned: true
        })
        await first.A.store.flush()
        const h = await ready({
            disk,
            save: fx.save({ seed: 'fresh', amounts: { 19: 1 }, appearance: original.join(',') }).raw,
            game: { genes: changed ? newer : temporary }
        })
        h.A.store.setSetting('clones', false)
        await h.A.registry.get('clones').setup()
        assert.deepEqual(h.game.state.genes, changed ? newer : original)
        assert.equal(h.A.store.get('cloneRecovery', null), null)
    })
}

async function ascent(opts = {}) {
    const base = boot({}).A.strategy.ascend.cookiesFor(365)
    const h = await ready({
        save: fx.save({ cookiesEarned: base, ...opts.save }).raw,
        game: { officeLevel: 5, ...opts.game },
        disk: opts.disk
    })
    await h.A.registry.get('ascend').setup()
    return h
}

async function advance(h, n = 1) {
    for (let i = 0; i < n; i++) await h.A.registry.get('ascend').tick()
}

test('valuable live hoard visibly blocks loans and ascent even when autosave says zero', async () => {
    const h = await ascent()
    h.game.state.wrinklers = 8
    h.game.state.wrinklerHoard = 5e15
    await advance(h, 4)
    assert.equal(h.game.state.loansTaken.length, 0)
    assert.equal(h.A.act.ascend.onAscendScreen(), false)
    assert.equal(h.debug().ascend.hoardBlocked, true)
    assert.match(h.debug().ascend.blocked, /Collect/)
    assert.equal(h.debug().ascend.wrinklerHoard, 5e15)
    assert.equal(h.A.safety.prompt(), null)
})

test('a fresh export proving the hoard was collected releases the gate despite stale saved hoard', async () => {
    const h = await ascent({ save: { wrinklers: 8, wrinklerHoard: 5e15 } })
    await advance(h)
    assert.equal(h.debug().ascend.hoardBlocked, true)
    h.game.state.wrinklers = 0
    h.game.state.wrinklerHoard = 0
    await advance(h, 2)
    assert.equal(h.game.state.loansTaken.length, 1)
    assert.equal(h.A.save.get().scalars.wrinklersAmount, 5e15)
})

test('a hoard appearing after the decision is checked again before the first loan', async () => {
    const h = await ascent()
    await advance(h)
    h.game.state.wrinklers = 1
    h.game.state.wrinklerHoard = 1e12
    await advance(h)
    assert.equal(h.game.state.loansTaken.length, 0)
    assert.equal(h.debug().ascend.hoardBlocked, true)
})

test('a hoard appearing before confirmation cancels the owned ascent prompt', async () => {
    const h = await ascent({ game: { officeLevel: 0 } })
    await advance(h, 2)
    assert.equal(h.A.safety.prompt().id, 'promptContentAscend')
    h.game.state.wrinklers = 1
    h.game.state.wrinklerHoard = 1e12
    await advance(h)
    assert.equal(h.debug().ascend.hoardBlocked, true)
    assert.equal(h.A.act.ascend.onAscendScreen(), false)
    assert.equal(h.A.safety.prompt(), null)
})

test('discard is explicit, scoped to the displayed decision, and never survives reload', async () => {
    const disk = {}
    const h = await ascent({
        disk,
        save: { wrinklers: 2, wrinklerHoard: 9e12 },
        game: { officeLevel: 0 }
    })
    await advance(h)
    const decision = h.debug().ascend.decisionId
    assert.equal(h.A.ascend.discardHoard('obsolete'), false)
    assert.equal(h.A.ascend.discardHoard(decision), true)
    await advance(h, 3)
    assert.equal(h.A.act.ascend.onAscendScreen(), true)
    await h.A.store.flush()
    const reloaded = await ascent({
        disk,
        save: { wrinklers: 2, wrinklerHoard: 9e12 },
        game: { officeLevel: 0 }
    })
    await advance(reloaded, 3)
    assert.equal(reloaded.A.act.ascend.onAscendScreen(), false)
    assert.equal(reloaded.debug().ascend.hoardBlocked, true)
})

test('unknown, old, or foreign export data cannot authorize loans or ascent', async () => {
    for (const value of ['bad data', fx.save({ fullDate: 123 }).raw, fx.save({ lastDate: 1000 }).raw]) {
        const h = await ascent()
        h.game.state.exportSave = () => value
        await advance(h, 3)
        assert.equal(h.game.state.loansTaken.length, 0)
        assert.equal(h.debug().ascend.hoardBlocked, true)
        assert.equal(h.A.safety.prompt(), null)
    }
})

test('stable namespace migration retains previous automation state', async () => {
    const fixture = fx.save().raw
    const id = boot({ save: fixture }).A.identity.current()
    const disk = { ['legacy:' + id.previousLegacyId]: { tickerClicks: 23, clonesStyled: true } }
    const h = boot({ save: fixture, disk })
    await h.A.store.ready(id.legacyId, id.previousLegacyId)
    assert.equal(h.A.store.get('tickerClicks'), 23)
    assert.equal(h.A.store.get('clonesStyled'), true)
    await h.A.store.flush()
    assert.ok(disk['legacy:' + id.legacyId])
})

test('cosmetic routines refuse to mutate without a durable undo record', async () => {
    const h = await ready({ game: { bakeryName: 'Original' } })
    h.ctx.chrome.storage.local.set = () => {
        throw new Error('storage unavailable')
    }
    await nameRoutine(h)
    assert.equal(h.game.state.bakeryName, 'Original')
    const live = [4, 5, 6, 1, 2, 3, 4]
    const clones = await ready({ save: fx.save({ amounts: { 19: 1 } }).raw, game: { genes: live } })
    clones.ctx.chrome.storage.local.set = () => {
        throw new Error('storage unavailable')
    }
    await clones.A.registry.get('clones').tick()
    assert.deepEqual(clones.game.state.genes, live)
    assert.equal(clones.A.store.get('clonesStyled', false), false)
})

test('an incomplete clone restoration retains its journal and retries before marking success', async () => {
    const original = [4, 5, 6, 1, 2, 3, 4]
    const h = await ready({
        save: fx.save({ amounts: { 19: 1 }, appearance: original.join(',') }).raw,
        game: { genes: original }
    })
    const flush = h.A.store.flush
    let blocked = false
    let calls = 0
    h.A.store.flush = async () => {
        const mark = h.A.store.get('cloneRecovery', null)
        if (mark?.earned && !blocked) {
            blocked = true
            return false
        }
        calls++
        return flush()
    }
    await h.A.registry.get('clones').tick()
    assert.ok(calls > 1)
    assert.ok(h.A.store.get('cloneRecovery', null))
    assert.equal(h.A.store.get('clonesStyled', false), false)
    h.A.store.flush = flush
    await h.A.registry.get('clones').tick()
    assert.deepEqual(h.game.state.genes, original)
    assert.equal(h.A.store.get('clonesStyled', false), true)
    assert.equal(h.A.store.get('cloneRecovery', null), null)
})

test('a deliberate name input matching the temporary name supersedes recovery', async () => {
    const h = await ready({ game: { bakeryName: 'Orteil' } })
    const id = h.A.identity.current().legacyId
    h.A.store.set('bakeryNameRecovery', { legacyId: id, original: 'Original', expected: 'Orteil' })
    h.A.input.simulateClick(h.game.doc.getElementById('bakeryName'))
    const input = h.game.doc.getElementById('bakeryNameInput')
    h.game.doc.fire('input', { isTrusted: true, target: input })
    h.A.input.simulateClick(h.game.doc.getElementById('promptOption0'))
    h.A.achievements.recoverName()
    assert.equal(h.game.state.bakeryName, 'Orteil')
    assert.equal(h.A.store.get('bakeryNameRecovery', null), null)
})

test('pausing before a permanent upgrade confirmation leaves the slot unassigned', async () => {
    const h = await ascent({
        game: {
            officeLevel: 0,
            chips: 1000,
            heavenly: [{ id: 5, name: 'Permanent upgrade slot I', cost: 100, slot: true }],
            permanentChoices: [{ id: 90, name: 'Kitten helpers', price: 1000 }]
        }
    })
    await advance(h, 4) // enter the tree without starting its async shopping pass
    const barrier = hold(h, 250)
    let waits = 0
    const originalTimer = h.ctx.setTimeout
    h.ctx.setTimeout = (fn, ms) => {
        if (ms === 250 && ++waits === 2) h.A.scheduler.pause()
        return originalTimer(fn, ms)
    }
    const work = h.A.registry.get('ascend').tick()
    assert.ok(await waitFor(() => barrier.pending.length > 0, 2000, 5))
    // let the purchase redraw finish, then stop before its picker confirmation
    const first = barrier.pending.shift()
    first()
    assert.ok(await waitFor(() => barrier.pending.length > 0, 2000, 5))
    barrier.release()
    await work
    assert.equal(h.game.state.permanent, null)
    assert.equal(h.A.safety.prompt(), null)
})

test('a throwing cleanup handler still releases the store lease', async () => {
    const h = await ready()
    const back = h.game.doc.getElementById('storeBulk1')
    back.addEventListener('click', () => {
        throw new Error('cleanup handler failed')
    })
    await assert.rejects(
        h.A.act.store.withBulk('sell', 10, () => true),
        /cleanup handler failed/
    )
    const lease = h.A.safety.acquire('store', 'probe')
    assert.ok(lease)
    lease.release()
})

test('withdrawing auto-ascension invalidates discard consent for the old decision', async () => {
    const h = await ascent({ save: { wrinklers: 1, wrinklerHoard: 9e12 } })
    await advance(h)
    const oldDecision = h.debug().ascend.decisionId
    assert.equal(h.A.ascend.discardHoard(oldDecision), true)
    h.A.store.setSetting('ascend', false)
    h.A.store.setSetting('ascend', true)
    await advance(h)
    assert.equal(h.debug().ascend.hoardBlocked, true)
    assert.notEqual(h.debug().ascend.decisionId, oldDecision)
    assert.equal(h.A.ascend.discardHoard(oldDecision), false)
    assert.equal(h.game.state.loansTaken.length, 0)
})

for (const fromSlot of [false, true]) {
    for (const waitNumber of [1, 2]) {
        test(`drag cancellation at wait ${waitNumber} preserves swaps and a spirit from ${fromSlot ? 'a slot' : 'the roster'}`, async () => {
            const h = await ready()
            const source = new El('div', { id: 'templeGodDrag0' })
            const original = new El('div', { id: 'templeSlot1' })
            const target = new El('div', { id: 'templeSlot0' })
            h.game.doc.body.append(original, target)
            ;(fromSlot ? original : h.game.doc.body).append(source)
            let dragging = false
            let slotHovered = -1
            let equipped = fromSlot ? 1 : -1
            let swaps = 3
            source.addEventListener('mousedown', () => (dragging = true))
            const drop = () => {
                if (!dragging) return
                if (slotHovered !== -1 && slotHovered !== equipped) swaps--
                equipped = slotHovered
                dragging = false
            }
            // Pantheon remembers mouseover/mouseout independently of coordinates
            // and drops from its document mouseup handler. The fake DOM does not
            // bubble, so attach that handler at each possible release target.
            for (const [node, slot] of [
                [original, 1],
                [target, 0]
            ]) {
                node.addEventListener('mouseover', () => (slotHovered = slot))
                node.addEventListener('mouseout', () => (slotHovered = -1))
                node.addEventListener('mouseup', drop)
            }
            h.game.doc.body.addEventListener('mouseup', drop)
            const barrier = hold(h, 60)
            const mod = register(h, 'pantheon', ctx => h.A.act.drag.dragTo(source, target, ctx.task))
            const work = mod.tick()
            if (waitNumber === 2) {
                barrier.pending.shift()()
                assert.ok(await waitFor(() => barrier.pending.length === 1, 1000, 5))
                assert.equal(slotHovered, 0)
            }
            h.A.scheduler.pause()
            barrier.release()
            await work
            assert.equal(swaps, 3)
            assert.equal(equipped, fromSlot ? 1 : -1)
            assert.equal(dragging, false)
        })
    }
}

for (const cancel of ['pause', 'stop', 'module']) {
    test(`${cancel} dismisses the owned GiftRedeem prompt without redeeming`, async () => {
        const h = await ready({
            save: fx.save({ heavenlyChipsSpent: 999999 }).raw,
            game: { bank: 1e12, wrappingPaper: true }
        })
        h.A.store.set('giftCode', { code: 'TESTCODE123456', at: Date.now() - 2 * 3600e3 })
        const barrier = hold(h, 350)
        const work = h.A.registry.get('gifts').tick()
        barrier.pending.shift()() // Options is open; now open Redeem.
        assert.ok(await waitFor(() => barrier.pending.length === 1, 1000, 5))
        assert.equal(h.A.safety.prompt()?.id, 'promptContentGiftRedeem')
        assert.equal(h.game.doc.getElementById('promptOption1'), null)
        if (cancel === 'module') h.A.store.setSetting('gifts', false)
        else h.A.scheduler[cancel]()
        barrier.release()
        await work
        assert.equal(h.A.safety.prompt(), null)
        assert.equal(h.game.state.log.includes('redeemed a gift'), false)
        assert.ok(h.A.gifts.heldCode())
        const lease = h.A.safety.acquire('prompt', 'probe')
        assert.ok(lease)
        lease.release()
    })
}

test('a temporary name autosave remains recoverable after live restoration and reload', async () => {
    const disk = {}
    const h = await ready({
        disk,
        save: fx.save({ bakeryName: 'Original' }).raw,
        game: { bakeryName: 'Original' }
    })
    const barrier = hold(h, 600)
    const work = nameRoutine(h)
    assert.ok(await waitFor(() => barrier.pending.length === 1, 2000, 5))
    assert.equal(h.game.state.bakeryName, 'Orteil')
    const saved = autosave(h)
    barrier.release()
    await work
    assert.equal(h.game.state.bakeryName, 'Original')
    assert.ok(h.A.store.get('bakeryNameRecovery', null))
    const promptCount = h.game.state.log.filter(line => line === 'prompt NameBakery').length
    h.A.achievements.recoverName()
    assert.equal(h.game.state.log.filter(line => line === 'prompt NameBakery').length, promptCount)
    await h.A.store.flush()

    const reloaded = await ready({ disk, save: saved, game: { bakeryName: 'Orteil' } })
    reloaded.A.store.setSetting('achievements', false)
    reloaded.A.registry.get('achievements').setup()
    assert.equal(reloaded.game.state.bakeryName, 'Original')
    assert.ok(reloaded.A.store.get('bakeryNameRecovery', null))
    autosave(reloaded)
    reloaded.A.achievements.recoverName()
    await reloaded.A.store.flush()
    assert.equal(reloaded.A.store.get('bakeryNameRecovery', null), null)
    assert.equal(disk['legacy:' + reloaded.A.identity.current().legacyId].bakeryNameRecovery, undefined)
})

test('a temporary clone autosave remains recoverable after the routine completes', async () => {
    const original = [4, 5, 6, 1, 2, 3, 4]
    const disk = {}
    const h = await ready({
        disk,
        save: fx.save({ amounts: { 19: 1 }, appearance: original.join(',') }).raw,
        game: { genes: original }
    })
    const flush = h.A.store.flush
    let writes = 0
    let saved
    let temporary
    h.A.store.flush = async () => {
        const ok = await flush()
        if (++writes === 4) {
            temporary = h.game.state.genes.slice()
            saved = autosave(h)
        }
        return ok
    }
    await h.A.registry.get('clones').tick()
    assert.notDeepEqual(temporary, original)
    assert.deepEqual(h.game.state.genes, original)
    assert.ok(h.A.store.get('cloneRecovery', null))
    const promptCount = h.game.state.log.filter(line => line === 'prompt CustomizeYou').length
    await h.A.registry.get('clones').tick()
    assert.equal(h.game.state.log.filter(line => line === 'prompt CustomizeYou').length, promptCount)
    await flush()

    const reloaded = await ready({ disk, save: saved, game: { genes: temporary } })
    reloaded.A.store.setSetting('clones', false)
    await reloaded.A.registry.get('clones').setup()
    assert.deepEqual(reloaded.game.state.genes, original)
    assert.equal(reloaded.A.store.get('clonesStyled', false), true)
    assert.ok(reloaded.A.store.get('cloneRecovery', null))
    autosave(reloaded)
    await reloaded.A.clones.recover()
    await reloaded.A.store.flush()
    assert.equal(reloaded.A.store.get('cloneRecovery', null), null)
    assert.equal(disk['legacy:' + reloaded.A.identity.current().legacyId].cloneRecovery, undefined)
})

test('interrupted clone recovery recognizes an autosave several journal steps behind', async () => {
    const original = [4, 5, 6, 1, 2, 3, 4]
    const h = await ready({
        save: fx.save({ amounts: { 19: 1 }, appearance: original.join(',') }).raw,
        game: { genes: original }
    })
    const flush = h.A.store.flush
    let writes = 0
    let saved
    let temporary
    let disk
    let resume
    h.A.store.flush = async () => {
        const ok = await flush()
        if (++writes === 3) {
            temporary = h.game.state.genes.slice()
            saved = autosave(h)
        }
        if (writes === 9) {
            disk = structuredClone(h.disk)
            await new Promise(resolve => (resume = resolve))
        }
        return ok
    }
    const work = h.A.registry.get('clones').tick()
    assert.ok(await waitFor(() => !!resume, 1000, 5))
    try {
        const mark = disk['legacy:' + h.A.identity.current().legacyId].cloneRecovery
        assert.notDeepEqual(temporary, mark.expected)
        assert.notDeepEqual(temporary, mark.previous)
        const reloaded = await ready({ disk, save: saved, game: { genes: temporary } })
        await reloaded.A.registry.get('clones').setup()
        assert.deepEqual(reloaded.game.state.genes, original)
        assert.equal(reloaded.A.store.get('clonesStyled', false), false)
    } finally {
        h.A.scheduler.pause()
        resume()
        await work
    }
})

test('a player edit matching an earlier clone step supersedes the retained journal', async () => {
    const original = [4, 5, 6, 1, 2, 3, 4]
    const disk = {}
    const h = await ready({
        disk,
        save: fx.save({ amounts: { 19: 1 } }).raw,
        game: { genes: original }
    })
    await h.A.registry.get('clones').tick()
    const mark = h.A.store.get('cloneRecovery', null)
    const chosen = Array.from(mark.history[1])
    assert.notDeepEqual(chosen, original)
    h.game.openCustomizer()
    const prompt = h.game.doc.getElementById('promptContentCustomizeYou')
    h.game.doc.fire('pointerdown', { isTrusted: true, target: prompt })
    h.game.state.genes = chosen
    const saved = autosave(h)
    await h.A.store.flush()
    const reloaded = await ready({ disk, save: saved, game: { genes: chosen } })
    await reloaded.A.registry.get('clones').setup()
    assert.deepEqual(reloaded.game.state.genes, chosen)
    assert.equal(reloaded.A.store.get('cloneRecovery', null), null)
})
