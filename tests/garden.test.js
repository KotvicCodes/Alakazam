const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./harness')
const { El } = require('./dom')
const fx = require('./fixtures')

// from minigameGarden.js: sprite rows diverge from plant ids after chocoroot.
// the simulator decides rewards from age, independently of Alakazam's reading.
const SPECIES = {
    0: { row: 0, mature: 35 },
    1: { row: 1, mature: 20 },
    2: { row: 2, mature: 55 },
    8: { row: 8, mature: 50 },
    13: { row: 29, mature: 50 },
    21: { row: 18, mature: 85 }
}

async function gardenBoot({ id = 8, age = 1, unlocked = [], savedEmpty = false } = {}) {
    const h = boot({
        save: fx.save({
            levels: { 2: 9 },
            amounts: { 2: 300 },
            minigames: {
                2: fx.garden({ unlocked, plot: savedEmpty ? [] : [[[id + 1, age]]] })
            }
        }).raw,
        game: { bank: 1e9, cps: 1000 }
    })
    await h.A.store.ready('t')

    let now = Date.now()
    h.ctx.Date = class extends Date {
        static now() {
            return now
        }
    }
    const live = { id, age, unlocked: new Set(unlocked), harvests: 0, lumps: 0 }
    const tile = new El('div', {
        id: 'gardenTile-0-0',
        class: 'gardenTile',
        style: { display: 'block' }
    })
    const icon = new El('div', { id: 'gardenTileIcon-0-0', class: 'gardenTileIcon' })
    tile.append(icon)
    h.game.doc.body.append(tile)

    for (const [plantId, species] of Object.entries(SPECIES)) {
        const seed = new El('div', {
            id: `gardenSeed-${plantId}`,
            class: `gardenSeed${live.unlocked.has(Number(plantId)) ? '' : ' locked'}`
        })
        seed.append(
            new El('div', {
                class: 'gardenSeedIcon',
                style: { backgroundPosition: `0px ${-species.row * 48}px` }
            })
        )
        h.game.doc.body.append(seed)
    }

    function render() {
        icon.style.display = live.id === null ? 'none' : 'block'
        if (live.id === null) return // the game leaves the old position on empty tiles
        const species = SPECIES[live.id]
        const stage =
            live.age >= species.mature
                ? 4
                : live.age >= species.mature * 0.666
                  ? 3
                  : live.age >= species.mature * 0.333
                    ? 2
                    : 1
        icon.style.backgroundPosition = `${-stage * 48}px ${-species.row * 48}px`
    }
    function replace(plantId, plantAge) {
        live.id = plantId
        live.age = plantAge
        render()
    }
    render()

    // actual hover events populate the catalog's tooltip, including the prose
    // that caused the original bug. The new sprite reader need not hover at all.
    tile.addEventListener('mouseover', () => {
        const stage = -Number.parseInt(icon.style.backgroundPosition) / 48
        h.game.tooltip.innerText =
            `${h.A.data.plants.byId(live.id)?.name || 'Empty tile'}\n` +
            `Stage: ${['bud', 'sprout', 'bloom', 'mature'][stage - 1]}\n` +
            'Mature in about 30 minutes\nHarvest when mature for +30 minutes of CpS.'
    })
    tile.addEventListener('click', () => {
        if (live.id === null) return
        const species = SPECIES[live.id]
        if (live.age >= species.mature) {
            live.unlocked.add(live.id)
            live.harvests++
            if (live.id === 8) {
                h.game.state.bank += Math.min(h.game.state.bank * 0.03, h.game.state.cps * 1800)
            }
            if (live.id === 21) live.lumps++
        }
        replace(null, 0)
    })

    return {
        ...h,
        live,
        tile,
        icon,
        replace,
        tick: () => h.A.registry.get('garden').tick(),
        advance: () => (now += 31000)
    }
}

for (const [stage, age] of [
    ['bud', 1],
    ['sprout', 20],
    ['bloom', 40],
    ['bloom near maturity', 49.99]
]) {
    test(`a bakeberry ${stage} survives maturity-related tooltip prose`, async () => {
        const h = await gardenBoot({ age })
        const bank = h.game.state.bank
        await h.tick()
        assert.equal(h.live.id, 8)
        assert.equal(h.live.age, age)
        assert.equal(h.live.harvests, 0)
        assert.equal(h.live.unlocked.has(8), false)
        assert.equal(h.game.state.bank, bank)
        assert.equal(h.tile.events.includes('click'), false)
        assert.equal(h.A.store.get('gardenHarvests', 0), 0)
    })
}

test('a mature target unlocks its seed through a real tile click', async () => {
    const h = await gardenBoot({ id: 2, age: 55 })
    await h.tick()
    assert.equal(h.live.id, null)
    assert.equal(h.live.unlocked.has(2), true)
    assert.equal(h.live.harvests, 1)
    assert.equal(h.tile.events.filter(e => e === 'click').length, 1)
    assert.equal(h.A.store.get('gardenHarvests', 0), 1)
})

test('an already unlocked bakeberry at age 50 pays out on harvest', async () => {
    const h = await gardenBoot({ age: 50, unlocked: [8] })
    const bank = h.game.state.bank
    await h.tick()
    assert.equal(h.live.id, null)
    assert.equal(h.live.harvests, 1)
    assert.equal(h.game.state.bank - bank, 1800000)
})

test('a mature juicy queenbeet uses its actual sprite row and awards a lump', async () => {
    const h = await gardenBoot({ id: 21, age: 85, unlocked: [21] })
    await h.tick()
    assert.equal(h.live.id, null)
    assert.equal(h.live.lumps, 1)
})

test('growth is reread without waiting for a cached immature stage to expire', async () => {
    const h = await gardenBoot()
    for (const age of [1, 20, 40, 49.99]) {
        h.replace(8, age)
        await h.tick()
        assert.equal(h.live.id, 8)
    }
    h.replace(8, 50)
    await h.tick()
    assert.equal(h.live.harvests, 1)
    assert.equal(h.live.unlocked.has(8), true)
})

for (const [description, replacement, age] of [
    ['the same species replanted young', 8, 1],
    ['another mature species', 21, 85],
    ['an empty tile retaining its old sprite position', null, 0]
]) {
    test(`a stale save cannot reuse readiness for ${description}`, async () => {
        const h = await gardenBoot({ age: 50, unlocked: [8] })
        await h.tick()
        assert.equal(h.live.harvests, 1)
        h.replace(replacement, age)
        h.advance() // past the action cooldown, still inside the former stage TTL
        const clicks = h.tile.events.filter(e => e === 'click').length
        await h.tick()
        assert.equal(h.live.id, replacement)
        assert.equal(h.live.harvests, 1)
        assert.equal(h.tile.events.filter(e => e === 'click').length, clicks)
    })
}

for (const [description, change] of [
    ['missing stage', h => (h.icon.style.backgroundPosition = '')],
    ['unknown stage column', h => (h.icon.style.backgroundPosition = '-240px -384px')],
    ['percentage sprite coordinates', h => (h.icon.style.backgroundPosition = '80% 0%')],
    ['unrecognized species row', h => (h.icon.style.backgroundPosition = '-192px -385px')],
    ['missing seed reference', h => (h.game.doc.getElementById('gardenSeed-8').children = [])],
    ['hidden tile', h => (h.tile.style.display = 'none')],
    ['hidden garden', h => (h.tile.getBoundingClientRect = () => ({ width: 0, height: 0 }))],
    ['detached tile', h => (h.tile.isConnected = false)],
    ['icon outside the tile', h => (h.tile.children = [])]
]) {
    test(`${description} defers even when the tooltip says mature`, async () => {
        const h = await gardenBoot({ age: 50 })
        change(h)
        h.game.tooltip.innerText = 'Stage: mature\nClick to harvest.'
        await h.tick()
        assert.equal(h.live.id, 8)
        assert.equal(h.tile.events.includes('click'), false)
    })
}

test('localized prose needs no interpretation when the live sprite is verified', async () => {
    const h = await gardenBoot({ age: 50 })
    h.game.tooltip.innerText = 'Stade : mûre\nCliquer pour récolter.'
    await h.tick()
    assert.equal(h.live.harvests, 1)
})

test('uninterpretable localized text without a verified sprite defers', async () => {
    const h = await gardenBoot({ age: 50 })
    h.game.tooltip.innerText = 'Stade : mûre\nCliquer pour récolter.'
    h.icon.style.backgroundPosition = ''
    await h.tick()
    assert.equal(h.live.id, 8)
    assert.equal(h.live.harvests, 0)
})

test('planting into a stale saved empty tile cannot unearth a new bud', async () => {
    const h = await gardenBoot({ savedEmpty: true, unlocked: [0, 1] })
    await h.tick()
    assert.equal(h.live.id, 8)
    assert.equal(h.tile.events.includes('click'), false)
})
