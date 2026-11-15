const { test } = require('node:test')
const assert = require('node:assert')
const { boot } = require('./harness')
const fx = require('./fixtures')

// a mature save: the dragon knows Radiant Appetite and everything below it
function dragonBoot(opts = {}) {
    const level = opts.level === undefined ? 19 : opts.level
    return boot({
        save: fx.save({
            dragonLevel: level,
            dragonAura: opts.aura || 0,
            dragonAura2: opts.aura2 || 0,
            prestige: opts.prestige || 1000,
            amounts: opts.amounts || {},
            wrinklers: opts.wrinklers || 0
        }).raw,
        game: {
            bank: opts.bank === undefined ? 1e9 : opts.bank,
            owned: opts.owned,
            dragon: opts.dragon === null ? undefined : { level, ...(opts.dragon || {}) }
        }
    })
}

async function ready(h) {
    await h.A.store.ready('t')
    // one save tick so the parsed save is on the shared handle
    await h.A.registry.get('saveWatch').tick()
    return h
}

//! The reference data

test('the training ladder matches the game, rung for rung', () => {
    const D = boot({}).A.data.dragon
    // the eggs cost cookies, doubling each time
    assert.deepEqual(D.levelFor(0), { level: 0, kind: 'cookies', amount: 1e6, trainsAura: null })
    assert.equal(D.levelFor(4).amount, 16e6)
    assert.equal(D.levelFor(4).trainsAura, 1)
    // then a hundred of one building per rung, walking up the store
    assert.deepEqual(D.levelFor(5), {
        level: 5,
        kind: 'building',
        amount: 100,
        building: 0,
        trainsAura: 2
    })
    assert.equal(D.levelFor(18).building, 13, 'Radiant Appetite is trained with prisms')
    assert.equal(D.levelFor(18).trainsAura, 15)
    assert.equal(D.levelFor(24).building, 19, 'the last aura costs a hundred Yous')
    assert.deepEqual(D.levelFor(25).amount, 50)
    assert.deepEqual(D.levelFor(26).amount, 200)
    assert.equal(D.levelFor(27).kind, 'none')
})

test('an aura is only selectable four levels past the one that trains it', () => {
    const D = boot({}).A.data.dragon
    assert.equal(D.selectable(15, 18), false, 'training Radiant Appetite is not having it')
    assert.equal(D.selectable(15, 19), true)
    assert.equal(D.trainedAuras(19).length, 16, 'no aura, plus the fifteen trained')
    assert.equal(D.trainedAuras(19).indexOf(16), -1, "Dragon's Fortune is one rung further on")
    assert.equal(D.trainedAuras(0).length, 0, 'an egg knows nothing, not even no aura')
    assert.equal(D.trainedAuras(4).join(','), '0', 'a hatchling knows only how to wear nothing')
})

test('the petting window is the quarter of the hour', () => {
    const D = boot({}).A.data.dragon
    const at = m => new Date(2026, 0, 1, 12, m).getTime()
    assert.equal(D.dropWindow(at(0)), 0)
    assert.equal(D.dropWindow(at(14)), 0)
    assert.equal(D.dropWindow(at(15)), 1)
    assert.equal(D.dropWindow(at(59)), 3)
})

//! Scoring

const MID_RUN = {
    level: 27,
    slot2: false,
    cps: 1e12,
    clickCps: 1e10,
    goldenCps: 2e11,
    buffBonusCps: 1e11,
    buffMult: 7,
    buffedShare: 0.2,
    goldensOnScreen: 0.001,
    grandmaShare: 0.05,
    otherBuildingTypes: 19,
    prestigeShare: 0.9,
    wrinklerCps: 0
}

test('Radiant Appetite wins on a mid-run save, and by a distance', () => {
    const S = boot({}).A.strategy.dragon
    const table = S.scoreAuras(MID_RUN)
    assert.equal(table[0].name, 'Radiant Appetite')
    assert.equal(table[0].gain, MID_RUN.cps)
    // doubling production is worth about twice everything, so the score is near 2
    assert.ok(table[0].score > 1.9, `score was ${table[0].score}`)
    assert.ok(table[1].gain < table[0].gain / 4, 'and nothing else is close')
})

test("Dragon's Fortune is nearly worthless because goldens are clicked at once", () => {
    const S = boot({}).A.strategy.dragon
    const row = S.scoreAuras(MID_RUN).find(r => r.name === "Dragon's Fortune")
    assert.ok(row.score < 1.01, `score was ${row.score}`)
    assert.match(row.why, /clicked at once/)

    // a player who leaves them on screen gets what the guides promise
    const patient = S.scoreAuras({ ...MID_RUN, goldensOnScreen: 0.9 })
    assert.equal(patient[0].name, "Dragon's Fortune")
})

test('a click aura only wins when clicking is most of the income', () => {
    const S = boot({}).A.strategy.dragon
    const clicky = { ...MID_RUN, cps: 1e6, clickCps: 1e12 }
    const table = S.scoreAuras(clicky)
    const cursor = table.find(r => r.name === 'Dragon Cursor')
    const radiant = table.find(r => r.name === 'Radiant Appetite')
    assert.ok(cursor.gain > radiant.gain, 'clicking dominates, so the click aura leads')
})

test('Reality Bending is worth a tenth of everything else', () => {
    const S = boot({}).A.strategy.dragon
    const table = S.scoreAuras(MID_RUN)
    const bending = table.find(r => r.name === 'Reality Bending')
    const rest = table.filter(r => r.name !== 'Reality Bending').reduce((sum, r) => sum + r.gain, 0)
    assert.ok(Math.abs(bending.gain - rest * 0.1) < rest * 1e-9)
})

test('an untrained aura is never offered, and the two slots never match', () => {
    const S = boot({}).A.strategy.dragon
    const young = S.chooseAuras({ ...MID_RUN, level: 19, slot2: false })
    assert.equal(young.secondary, 0, 'one slot means no second aura')
    assert.ok(S.scoreAuras({ ...MID_RUN, level: 19 }).every(r => r.aura <= 15))

    const grown = S.chooseAuras({ ...MID_RUN, level: 27, slot2: true })
    assert.notEqual(grown.primary, grown.secondary)
    assert.equal(grown.primary, 15)
})

test('an assumption is flagged as one', () => {
    const S = boot({}).A.strategy.dragon
    const milk = S.scoreAuras(MID_RUN).find(r => r.name === 'Breath of Milk')
    assert.equal(milk.assumed, true)
    assert.match(milk.why, /assumed/)
})

test('Elder Battalion counts non-grandma building units and un-boosts an active aura', () => {
    const S = boot({}).A.strategy.dragon
    // 5,000 non-grandma buildings (+5,000%) on a 5% unboosted grandma share adds 2.5x cps
    const unequipped = S.chooseAuras({
        ...MID_RUN,
        slot2: true,
        grandmaShare: 0.05,
        otherBuildings: 5000
    })
    assert.equal(unequipped.primary, 3, 'Elder Battalion leads once non-grandma units are counted')
    assert.equal(unequipped.secondary, 15, 'Radiant Appetite takes the second slot')
    const battalion = unequipped.table.find(r => r.aura === 3)
    assert.ok(Math.abs(battalion.gain - 2.5 * MID_RUN.cps) < 1)

    // once Elder Battalion is equipped, grandma output in the tooltip is 51x higher,
    // raising measured grandmaShare from 0.05 to (51 * 0.05) / (0.95 + 51 * 0.05)
    const boostedShare = (51 * 0.05) / (0.95 + 51 * 0.05)
    const equipped = S.chooseAuras({
        ...MID_RUN,
        slot2: true,
        aura: 3,
        aura2: 15,
        grandmaShare: boostedShare,
        otherBuildings: 5000
    })
    const activeBattalion = equipped.table.find(r => r.aura === 3)
    assert.ok(
        Math.abs(activeBattalion.gain - battalion.gain) < 1,
        'an already-equipped Elder Battalion is not multiplied by its own boost a second time'
    )
    assert.equal(equipped.primary, 3)
    assert.equal(equipped.secondary, 15)
})

test('income.shares sums non-grandma building units from the store and falls back to the save', async () => {
    const h = await ready(
        dragonBoot({
            amounts: { 0: 10, 1: 20, 2: 30 },
            owned: [400, 350, 250, 150, 0, 0, 0, 0]
        })
    )
    const liveShares = h.A.income.shares()
    assert.equal(liveShares.otherBuildings, 400 + 250 + 150, 'grandmas at index 1 are excluded')
    assert.equal(liveShares.otherBuildingTypes, 3)

    // when no store products are rendered, shares() falls back to the parsed save buildings
    const productsEl = h.game.doc.getElementById('products')
    productsEl.children = []
    const saveShares = h.A.income.shares()
    assert.equal(saveShares.otherBuildings, 10 + 30)
})

//! Reaching the panel

test('the dragon tab is clicked where it is drawn, whatever the zoom', async () => {
    for (const scale of [1, 2]) {
        const h = await ready(dragonBoot({ dragon: { scale } }))
        const canvas = h.game.leftCanvas
        const point = h.A.act.dragon.tabPoint(canvas)
        // the tab is the last one, 72 canvas pixels up from the bottom
        assert.equal(point.x, 24 * scale)
        assert.equal(point.y, (canvas.height - 72) * scale)
        assert.equal(await h.A.act.dragon.open(), true, `scale ${scale}`)
    }
})

test('santa in front of the dragon does not move the tab', async () => {
    const h = await ready(dragonBoot({ dragon: { santa: true } }))
    assert.equal(await h.A.act.dragon.open(), true)
})

test('a click the game credits to something else does not open the panel', async () => {
    const h = await ready(dragonBoot())
    const canvas = h.game.leftCanvas
    const { x, y } = h.A.act.dragon.tabPoint(canvas)
    // the autoclicker's own click, which lands on the big cookie and leaves the
    // game's lastClickedEl pointing at it
    canvas.dispatchEvent({
        type: 'click',
        clientX: x,
        clientY: y,
        target: h.game.doc.getElementById('bigCookie')
    })
    assert.equal(h.A.act.dragon.panelOpen(), false)
})

test('a missing egg means no panel, and open says so rather than pretending', async () => {
    const h = await ready(dragonBoot({ dragon: null }))
    assert.equal(await h.A.act.dragon.open(), false)
    assert.equal(h.A.act.dragon.nextStep(), null)
})

//! Training

test('the greyed out cost is what stops a training click', async () => {
    const h = await ready(dragonBoot({ level: 5, dragon: { level: 5, trainable: false } }))
    await h.A.act.dragon.open()
    const step = h.A.act.dragon.nextStep()
    assert.equal(step.affordable, false)
    assert.match(step.label, /Train/)
    assert.equal(h.A.act.dragon.train(), false)
    assert.equal(h.game.dragon.level, 5, 'and the dragon has not moved')
})

test('a rung the game says is paid for is climbed', async () => {
    const h = await ready(dragonBoot({ level: 5, dragon: { level: 5, trainable: true } }))
    await h.A.act.dragon.open()
    assert.equal(h.A.act.dragon.train(), true)
    assert.equal(h.game.dragon.level, 6)
    assert.ok(h.game.state.log.indexOf('trained dragon') !== -1)
})

test('what the next rung costs is read from the store face, not the lagging save', async () => {
    // the save is written on autosave and is up to a minute behind, so reading
    // building counts from it meant waiting out that minute on every single rung
    const h = await ready(dragonBoot({ level: 5, amounts: { 0: 0 }, owned: [300, 0, 0, 0, 0, 0, 0, 0] }))
    const dragon = h.A.dragon
    assert.equal(dragon.affordable(h.A.data.dragon.levelFor(5)), true, '300 cursors are on screen')
    assert.equal(dragon.affordable(h.A.data.dragon.levelFor(6)), false, 'no grandmas at all')
    assert.equal(dragon.affordable(h.A.data.dragon.levelFor(27)), false, 'nothing left to pay for')

    // and the save is still there for when the face cannot be read
    const blind = await ready(dragonBoot({ level: 5, amounts: { 0: 300 }, owned: undefined }))
    assert.equal(blind.A.dragon.affordable(blind.A.data.dragon.levelFor(5)), false)
})

//! Auras

test('an aura is identified by what the crate would call, not by its position', async () => {
    // with Dragon Cursor in the second slot, the picker for the first leaves it out,
    // so the nth crate is not aura n
    const h = await ready(dragonBoot({ level: 27, aura: 0, aura2: 2, dragon: { level: 27, aura2: 2 } }))
    await h.A.act.dragon.open()
    const crate = h.A.act.dragon.auraCrate(0)
    assert.ok(crate, 'the first slot has a crate')
    h.A.input.simulateClick(crate)
    const choices = h.A.act.dragon.choices()
    assert.ok(choices.length > 20)
    assert.equal(
        choices.every(c => c.aura !== 2),
        true,
        'the other slot is not on offer'
    )
    assert.equal(choices.find(c => c.aura === 15).slot, 0)
})

test('setting an aura confirms only the picker it opened, and pays for it', async () => {
    const h = await ready(
        dragonBoot({ level: 27, dragon: { level: 27 }, owned: [10, 10, 10, 10, 0, 0, 0, 0] })
    )
    await h.A.act.dragon.open()
    const before = h.game.state.owned.slice()
    assert.equal(await h.A.act.dragon.setAura(15, 0), true)
    assert.equal(h.game.dragon.aura, 15)
    // the game sacrifices one of the highest building owned
    assert.equal(h.game.state.owned[3], before[3] - 1)
})

test('an aura the dragon does not know is not confirmed at all', async () => {
    const h = await ready(dragonBoot({ level: 19, dragon: { level: 19 } }))
    await h.A.act.dragon.open()
    // Supreme Intellect needs level 24
    assert.equal(await h.A.act.dragon.setAura(20, 0), false)
    assert.equal(h.game.dragon.aura, 0)
    assert.equal(h.A.act.dragon.pickerOpen(), false, 'and the prompt is not left open')
})

//! The module

test('the module puts the best aura in and says why', async () => {
    const h = await ready(
        dragonBoot({ level: 27, dragon: { level: 27 }, owned: [50, 0, 0, 0, 0, 0, 0, 0] })
    )
    const mod = h.A.registry.get('dragon')
    await mod.tick()
    const state = h.debug().dragon
    assert.equal(state.level, 27)
    assert.equal(state.wanted, 'Radiant Appetite')
    assert.match(state.why, /Radiant Appetite/)
})

test('when Elder Battalion overtakes Radiant Appetite in slot 0, it fills slot 1 instead of overwriting slot 0', async () => {
    const h = await ready(
        dragonBoot({
            level: 27,
            aura: 15,
            aura2: 0,
            dragon: { level: 27, aura: 15, aura2: 0 },
            owned: [500, 10, 500, 500, 500, 500, 500, 500]
        })
    )
    // hover the grandma product so catalog.buildingCps(1) is populated (10 * 1 / 25 = 0.4 share)
    await h.A.registry.get('catalog').tick()
    await h.A.registry.get('catalog').tick()
    await h.A.registry.get('dragon').tick()
    assert.equal(h.game.dragon.aura, 15, 'Radiant Appetite stays in the first slot')
    assert.equal(h.game.dragon.aura2, 3, 'Elder Battalion is placed into the second slot')
})

test('a production buff does not stop the dragon growing any more', async () => {
    // a hundred cursors are bought back within seconds; Radiant Appetite is not
    const h = await ready(
        dragonBoot({
            level: 5,
            owned: [300, 0, 0, 0, 0, 0, 0, 0],
            dragon: { level: 5, trainable: true }
        })
    )
    h.game.gainBuff('Frenzy', 0.5)
    await h.A.registry.get('buffs').tick()
    await h.A.registry.get('dragon').tick()
    assert.ok(h.game.dragon.level > 5, 'the ladder is worth more than a tidy moment')
})

test('one visit climbs as far as the game allows, not one rung', async () => {
    const h = await ready(
        dragonBoot({
            level: 5,
            owned: [300, 0, 0, 0, 0, 0, 0, 0],
            dragon: { level: 5, trainable: true }
        })
    )
    await h.A.registry.get('dragon').tick()
    // the panel is already open and every rung is one click, so a single tick takes
    // the whole ladder it can pay for, up to its own cap
    assert.equal(h.game.dragon.level, 15)
    assert.equal(h.game.state.log.filter(l => l === 'trained dragon').length, 10)
})

test('nothing is touched while a golden cookie is on screen', async () => {
    const h = await ready(
        dragonBoot({
            level: 5,
            owned: [300, 0, 0, 0, 0, 0, 0, 0],
            dragon: { level: 5, trainable: true }
        })
    )
    h.game.addShimmer()
    await h.A.registry.get('dragon').tick()
    assert.equal(h.game.dragon.level, 5, 'the golden cookie is not kept waiting')
    assert.match(h.debug().dragon.waiting, /golden cookie/)

    h.game.clearShimmers()
    await h.A.registry.get('dragon').tick()
    assert.ok(h.game.dragon.level > 5, 'and once it is gone the climb happens')
})

test('the scheduler is left running after a panel visit', async () => {
    const h = await ready(
        dragonBoot({
            level: 5,
            owned: [300, 0, 0, 0, 0, 0, 0, 0],
            dragon: { level: 5, trainable: true }
        })
    )
    await h.A.registry.get('dragon').tick()
    assert.equal(h.A.scheduler.isPaused(), false)
    assert.ok(h.game.dragon.level > 5, 'and the visit did its work')
})

test('explain prints the comparison and hands back the choice', async () => {
    const h = await ready(dragonBoot({ level: 27, dragon: { level: 27 } }))
    const out = h.A.dragon.explain()
    assert.ok(out.table.length > 20)
    assert.equal(out.primary, 15)
})
