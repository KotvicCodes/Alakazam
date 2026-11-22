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

test('PLOT_LIMITS and isTileUnlocked match farm levels 1 through 9', () => {
    const h = boot({})
    const P = h.A.data.plants
    assert.equal(P.PLOT_LIMITS.length, 9)
    assert.equal(P.isTileUnlocked(2, 2, 0), false)

    const expectedCounts = [4, 6, 9, 12, 16, 20, 25, 30, 36]
    for (let level = 1; level <= 9; level++) {
        let count = 0
        for (let y = 0; y < 6; y++) {
            for (let x = 0; x < 6; x++) {
                if (P.isTileUnlocked(x, y, level)) count++
            }
        }
        assert.equal(count, expectedCounts[level - 1], `farm level ${level}`)

        const levelBoot = boot({
            save: fx.save({
                levels: { 2: level },
                amounts: { 2: 50 },
                minigames: { 2: fx.garden({ unlocked: [0, 1] }) }
            }).raw
        })
        const s = levelBoot.A.garden.state()
        assert.equal(s.plotTiles, expectedCounts[level - 1])
        assert.equal(s.empty.length, expectedCounts[level - 1])
        for (const tile of s.empty) {
            assert.equal(P.isTileUnlocked(tile.x, tile.y, level), true)
        }
        if (level < 8) {
            assert.equal(
                s.empty.some(t => t.x === 0 && t.y === 0),
                false
            )
        }
    }
})

test('plantAt refuses to click a locked tile whose DOM element is hidden', async () => {
    const h = await gardenBoot({ savedEmpty: true, unlocked: [0, 1] })
    h.icon.style.display = 'none'
    h.tile.style.display = 'none'
    assert.equal(h.A.garden.plantAt('bakerWheat', { x: 0, y: 0 }), false)
    assert.equal(h.tile.events.includes('click'), false)
})

test('an immortal blocker cannot trap the garden on an impossible Juicy Queenbeet goal', () => {
    const plants = boot({}).A.data.plants
    const unlocked = plants.PLANTS.flatMap((p, id) =>
        p.key !== 'goldenClover' && p.key !== 'queenbeetLump' ? [id] : []
    )
    const plot = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [0, 0]))
    plot[3][3] = [plants.byKey('elderwort').id + 1, 100]
    const h = boot({
        save: fx.save({
            levels: { 2: 3 },
            amounts: { 2: 1 },
            minigames: { 2: fx.garden({ unlocked, plot }) }
        }).raw
    })
    const state = h.A.garden.state()
    assert.equal(state.plotTiles, 9)
    assert.equal(state.empty.length, 8)
    assert.equal(h.A.garden.nextGoal(state).plant.key, 'goldenClover')
    // Removing the blocker restores a real 3x3 nursery, so the higher chance
    // Juicy Queenbeet recipe becomes eligible again.
    state.empty.push({ x: 3, y: 3 })
    state.occupied = []
    assert.equal(h.A.garden.nextGoal(state).plant.key, 'queenbeetLump')
})

test('nextGoal targets queenbeetLump when queenbeet is unlocked and 9+ tiles exist', () => {
    const allExceptJuicy = Array.from({ length: 34 }, (_, i) => i).filter(i => i !== 21)

    const smallPlot = boot({
        save: fx.save({
            levels: { 2: 2 },
            amounts: { 2: 300 },
            minigames: { 2: fx.garden({ unlocked: allExceptJuicy }) }
        }).raw
    })
    assert.equal(smallPlot.A.garden.state().plotTiles, 6)
    assert.equal(smallPlot.A.garden.nextGoal(smallPlot.A.garden.state()), null)

    const ringPlot = boot({
        save: fx.save({
            levels: { 2: 3 },
            amounts: { 2: 300 },
            minigames: { 2: fx.garden({ unlocked: allExceptJuicy }) }
        }).raw
    })
    const goal = ringPlot.A.garden.nextGoal(ringPlot.A.garden.state())
    assert.ok(goal)
    assert.equal(goal.plant.key, 'queenbeetLump')
    assert.equal(goal.recipe.parents.length, 8)
})

test('worthHarvesting preserves unlocked mutation parents and harvests them otherwise', async () => {
    const h = await gardenBoot({ id: 8, age: 50, unlocked: [8, 9] })
    const P = h.A.data.plants
    const garden = h.A.garden

    const brownMoldTile = { x: 0, y: 0, plantId: 12, plant: P.byKey('brownMold') }
    const bakeberryTile = { x: 0, y: 0, plantId: 8, plant: P.byKey('bakeberry') }
    const chocorootTile = { x: 0, y: 0, plantId: 9, plant: P.byKey('chocoroot') }

    // chocoroot needs bakerWheat + brownMold: unlocked brownMold is preserved while needed
    const chocorootGoal = { plant: P.byKey('chocoroot'), recipe: P.recipesFor('chocoroot')[0] }
    assert.equal(
        garden.worthHarvesting(brownMoldTile, { unlocked: ['bakerWheat', 'brownMold'] }, chocorootGoal),
        null
    )
    // queenbeet needs bakeberry + chocoroot: both valuable parents stay in the ground
    const queenbeetGoal = { plant: P.byKey('queenbeet'), recipe: P.recipesFor('queenbeet')[0] }
    assert.equal(
        garden.worthHarvesting(bakeberryTile, { unlocked: ['bakeberry', 'chocoroot'] }, queenbeetGoal),
        null
    )
    assert.equal(
        garden.worthHarvesting(chocorootTile, { unlocked: ['bakeberry', 'chocoroot'] }, queenbeetGoal),
        null
    )
    // default goal resolution via nextGoal(s) also preserves active parents
    assert.equal(
        garden.worthHarvesting(bakeberryTile, {
            unlocked: ['bakerWheat', 'thumbcorn', 'bakeberry', 'chocoroot'],
            plotTiles: 36
        }),
        'pays out when harvested'
    )
    assert.equal(
        garden.worthHarvesting(brownMoldTile, {
            unlocked: ['bakerWheat', 'brownMold', 'whiteMildew'],
            plotTiles: 36
        }),
        null
    )

    // when not needed for the current goal, valuable plants and weeds are still harvested
    assert.equal(
        garden.worthHarvesting(bakeberryTile, { unlocked: ['bakeberry'] }, null),
        'pays out when harvested'
    )
    assert.equal(
        garden.worthHarvesting(chocorootTile, { unlocked: ['chocoroot'] }, null),
        'pays out when harvested'
    )
    assert.equal(garden.worthHarvesting(brownMoldTile, { unlocked: ['brownMold'] }, null), 'is a weed')

    // an locked species is always harvested to unlock its seed even if listed as a parent
    assert.equal(
        garden.worthHarvesting(bakeberryTile, { unlocked: ['chocoroot'] }, queenbeetGoal),
        'unlocks its seed'
    )

    // end-to-end tick: mature bakeberry at (0,0) is NOT harvested while queenbeet is the goal
    await h.tick()
    assert.equal(h.live.harvests, 0)
    assert.equal(h.live.id, 8)
})

function fullPlotBoot({ level = 3, unlocked = [0, 1], plot = [] } = {}) {
    let currentPlot = Array.from({ length: 6 }, (_, y) =>
        Array.from({ length: 6 }, (_, x) => (plot[y] && plot[y][x] ? [...plot[y][x]] : [0, 0]))
    )
    const makeSave = () =>
        fx.save({
            levels: { 2: level },
            amounts: { 2: 300 },
            minigames: { 2: fx.garden({ unlocked, plot: currentPlot, soil: 4 }) }
        }).raw

    const localStorage = fx.storage({ CookieClickerGame: makeSave() })
    const h = boot({
        localStorage,
        game: { bank: 1e9, cps: 1000 }
    })

    let now = Date.now()
    h.ctx.Date = class extends Date {
        static now() {
            return now
        }
    }

    const P = h.A.data.plants
    const container = new El('div', { id: 'gardenSeeds' })
    h.game.doc.body.append(container)
    const seedNodes = []
    for (let id = 0; id < P.PLANTS.length; id++) {
        const seed = new El('div', {
            id: `gardenSeed-${id}`,
            class: `gardenSeed${unlocked.includes(id) ? '' : ' locked'}`
        })
        seed.append(
            new El('div', {
                class: 'gardenSeedIcon',
                style: { backgroundPosition: `0px ${-id * 48}px` }
            })
        )
        seed.addEventListener('click', () => {
            if (seed.classList.contains('locked')) return
            const was = seed.classList.contains('on')
            seedNodes.forEach(other => other.classList.remove('on'))
            if (!was) seed.classList.add('on')
        })
        seedNodes.push(seed)
        container.append(seed)
    }

    const planted = []
    for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
            const isUnlocked = P.isTileUnlocked(x, y, level)
            const [rawId, age] = currentPlot[y][x]
            const tile = new El('div', {
                id: `gardenTile-${x}-${y}`,
                class: 'gardenTile',
                style: { display: isUnlocked ? 'block' : 'none' }
            })
            const icon = new El('div', {
                id: `gardenTileIcon-${x}-${y}`,
                class: 'gardenTileIcon',
                style: {
                    display: rawId > 0 ? 'block' : 'none',
                    backgroundPosition: rawId > 0 ? `-48px ${-(rawId - 1) * 48}px` : '0px 0px'
                }
            })
            tile.append(icon)
            tile.addEventListener('click', () => {
                const active = h.game.doc.querySelector('#gardenSeeds .gardenSeed.on')
                if (!active || !isUnlocked || currentPlot[y][x][0] > 0) return
                const seedId = Number(active.id.replace('gardenSeed-', ''))
                currentPlot[y][x] = [seedId + 1, age || 1]
                icon.style.display = 'block'
                icon.style.backgroundPosition = `-48px ${-seedId * 48}px`
                active.classList.remove('on')
                planted.push({ x, y, key: P.byId(seedId).key })
                localStorage.setItem('CookieClickerGame', makeSave())
            })
            h.game.doc.body.append(tile)
        }
    }

    return {
        ...h,
        planted,
        tick: async () => {
            await h.A.registry.get('garden').tick()
            await h.A.registry.get('saveWatch').tick()
        },
        advance: () => (now += 31000)
    }
}

test('tick plants only missing parents, stops once all parents are present, and keeps empty space', async () => {
    const plot = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [0, 0]))
    // bakerWheat (id 0) already planted at (2, 2) on a level-1 (2x2) plot
    plot[2][2] = [1, 10]
    const h = fullPlotBoot({ level: 1, unlocked: [0, 1], plot })
    await h.A.store.ready('t')

    await h.tick()
    assert.equal(h.planted.length, 1)
    assert.equal(h.planted[0].key, 'thumbcorn')
    assert.ok(
        Math.abs(h.planted[0].x - 2) <= 1 && Math.abs(h.planted[0].y - 2) <= 1,
        'missing parent is planted adjacent to the existing parent'
    )

    // once both parents are in the plot, later ticks must not fill the remaining empty tiles
    h.advance()
    await h.tick()
    assert.equal(h.planted.length, 1)
    assert.equal(h.A.garden.state().empty.length, 2)

    // when only 1 empty tile remains on a plot, tick refuses to plant into the last empty tile
    const almostFull = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [0, 0]))
    almostFull[2][2] = [9, 10]
    almostFull[3][2] = [9, 10]
    almostFull[2][3] = [9, 10]
    const lastEmpty = fullPlotBoot({ level: 1, unlocked: [0, 1, 8], plot: almostFull })
    await lastEmpty.A.store.ready('t')
    assert.equal(lastEmpty.A.garden.state().empty.length, 1)
    await lastEmpty.tick()
    assert.equal(lastEmpty.planted.length, 0)
    assert.equal(lastEmpty.A.garden.state().empty.length, 1)

    // when two parents sit at opposite corners with no shared empty neighbor,
    // planPlanting still plants the missing partner adjacent to a viable nursery
    const nonAdjacent = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => [0, 0]))
    nonAdjacent[0][0] = [1, 10]
    nonAdjacent[5][5] = [2, 10]
    const split = fullPlotBoot({ level: 9, unlocked: [0, 1], plot: nonAdjacent })
    await split.A.store.ready('t')
    await split.tick()
    assert.equal(split.planted.length, 1)
    assert.equal(split.planted[0].key, 'thumbcorn')
    assert.ok(
        Math.abs(split.planted[0].x - 0) <= 2 && Math.abs(split.planted[0].y - 0) <= 2,
        'partner is planted around a shared empty nursery near (0,0)'
    )

    // excess parent instances beyond what the chosen nursery uses are still harvested
    const distantMold = { x: 5, y: 5, plantId: 12, plant: split.A.data.plants.byKey('brownMold') }
    const nearWheat = { x: 0, y: 0, plantId: 0, plant: split.A.data.plants.byKey('bakerWheat') }
    const nearMold = { x: 1, y: 0, plantId: 12, plant: split.A.data.plants.byKey('brownMold') }
    const chocorootGoal = {
        plant: split.A.data.plants.byKey('chocoroot'),
        recipe: split.A.data.plants.recipesFor('chocoroot')[0]
    }
    const moldState = {
        unlocked: ['bakerWheat', 'brownMold'],
        occupied: [nearWheat, nearMold, distantMold],
        empty: [{ x: 0, y: 1 }]
    }
    assert.equal(split.A.garden.worthHarvesting(nearMold, moldState, chocorootGoal), null)
    assert.equal(split.A.garden.worthHarvesting(distantMold, moldState, chocorootGoal), 'is a weed')
})

test('tick never plants into the last empty tile and leaves the 3x3 center open for queenbeetLump', async () => {
    const allExceptJuicy = Array.from({ length: 34 }, (_, i) => i).filter(i => i !== 21)
    const h = fullPlotBoot({ level: 3, unlocked: allExceptJuicy })
    await h.A.store.ready('t')

    await h.tick()
    assert.equal(h.planted.length, 8)
    assert.equal(
        h.planted.every(p => p.key === 'queenbeet'),
        true
    )
    assert.equal(
        h.planted.some(p => p.x === 3 && p.y === 3),
        false,
        'center of the 3x3 ring stays empty for juicy queenbeet to spawn'
    )
    const s = h.A.garden.state()
    assert.equal(s.empty.length, 1)
    assert.equal(s.empty[0].x, 3)
    assert.equal(s.empty[0].y, 3)

    h.advance()
    await h.tick()
    assert.equal(h.planted.length, 8)
    const after = h.A.garden.state()
    assert.equal(after.empty.length, 1)
    assert.equal(after.empty[0].x, 3)
    assert.equal(after.empty[0].y, 3)
})
