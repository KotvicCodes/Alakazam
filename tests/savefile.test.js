const { test } = require('node:test')
const assert = require('node:assert')
const { boot } = require('./harness')
const fx = require('./fixtures')

const { A } = boot({})
const { savefile, identity } = A

test('decodes a save and reads its run metadata', () => {
    const { text, raw } = fx.save({ seed: 'qwert', bakeryName: 'My Bakery', resets: 4 })
    assert.equal(savefile.decode(raw), text)

    const parsed = savefile.parse(savefile.decode(raw))
    assert.equal(parsed.ok, true)
    assert.equal(parsed.stale, false)
    assert.equal(parsed.version, '2.052')
    assert.equal(parsed.run.seed, 'qwert')
    assert.equal(parsed.run.bakeryName, 'My Bakery')
    assert.equal(parsed.scalars.resets, 4)
})

test('rejects anything that is not a save, without throwing', () => {
    assert.equal(savefile.decode(null), null)
    assert.equal(savefile.decode(''), null)
    assert.equal(savefile.decode('not base64 at all !!'), null)
    assert.equal(savefile.parse('').ok, false)
    assert.equal(savefile.parse('a|b|c').ok, false)
})

test('flags an unknown game version as stale but still parses the structure', () => {
    const { raw } = fx.save({ version: '9.999', minigames: { 2: fx.garden({ unlocked: [0, 1, 2] }) } })
    const parsed = savefile.parse(savefile.decode(raw))
    assert.equal(parsed.stale, true)
    assert.match(parsed.reason, /unknown game version/)
    // bitfields and minigame saves are self delimiting, so they stay usable
    assert.equal(parsed.buildings[2].minigame.unlocked.filter(Boolean).length, 3)
})

test('flags a drifted scalar layout as stale', () => {
    const { text } = fx.save({})
    const sections = text.split('|')
    sections[4] = '1;2;3'
    const parsed = savefile.parse(sections.join('|'))
    assert.equal(parsed.stale, true)
    assert.match(parsed.reason, /scalar layout/)
})

test('reads building records and levels', () => {
    const { raw } = fx.save({ amounts: { 0: 300, 2: 55 }, levels: { 2: 9 } })
    const parsed = savefile.parse(savefile.decode(raw))
    assert.equal(parsed.buildings.length, 20)
    assert.equal(parsed.buildings[0].name, 'Cursor')
    assert.equal(parsed.buildings[0].amount, 300)
    assert.equal(parsed.buildings[2].amount, 55)
    assert.equal(parsed.buildings[2].level, 9)
})

test('reads the upgrade and achievement bitfields', () => {
    const { raw } = fx.save({ upgradeBits: '1110', achievementBits: '10110' })
    const parsed = savefile.parse(savefile.decode(raw))
    assert.deepEqual(parsed.upgrades, [
        { id: 0, unlocked: true, bought: true },
        { id: 1, unlocked: true, bought: false }
    ])
    assert.deepEqual(parsed.achievements, [true, false, true, true, false])
})

test('parses the garden plot, treating zero as an empty tile', () => {
    const plot = [
        [
            [1, 40],
            [14, 90],
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0]
        ]
    ]
    const { raw } = fx.save({ minigames: { 2: fx.garden({ unlocked: [0, 1, 8], plot, soil: 4 }) } })
    const garden = savefile.parse(savefile.decode(raw)).buildings[2].minigame

    assert.equal(garden.soil, 4)
    assert.equal(garden.plot.length, 6)
    // tile values are the plant id plus one
    assert.deepEqual(garden.plot[0][0], { x: 0, y: 0, empty: false, plantId: 0, age: 40 })
    assert.deepEqual(garden.plot[0][1], { x: 1, y: 0, empty: false, plantId: 13, age: 90 })
    assert.equal(garden.plot[0][2].empty, true)
    assert.equal(garden.plot[0][2].plantId, -1)
    assert.deepEqual(
        garden.unlocked.map((u, i) => (u ? i : null)).filter(i => i !== null),
        [0, 1, 8]
    )
})

test('parses stock market goods including the hidden trend mode', () => {
    const goods = [{ val: 12.34, mode: 3, d: -1.5, stock: 7, prev: 9 }]
    const { raw } = fx.save({ minigames: { 5: fx.market({ goods, officeLevel: 5, brokers: 30 }) } })
    const market = savefile.parse(savefile.decode(raw)).buildings[5].minigame

    assert.equal(market.officeLevel, 5)
    assert.equal(market.brokers, 30)
    assert.equal(market.goods.length, 18)
    assert.equal(market.goods[0].value, 12.34)
    assert.equal(market.goods[0].mode, 3)
    assert.equal(market.goods[0].delta, -1.5)
    assert.equal(market.goods[0].stock, 7)
})

test('parses pantheon slots and the swap budget', () => {
    const { raw } = fx.save({ minigames: { 6: fx.pantheon({ slots: [6, 7, -1], swaps: 2 }) } })
    const pantheon = savefile.parse(savefile.decode(raw)).buildings[6].minigame
    assert.deepEqual(pantheon.slots, [6, 7, -1])
    assert.equal(pantheon.swaps, 2)
})

test('parses grimoire magic', () => {
    const { raw } = fx.save({ minigames: { 7: fx.grimoire({ magic: 41.5, cast: 12 }) } })
    const grimoire = savefile.parse(savefile.decode(raw)).buildings[7].minigame
    assert.equal(grimoire.magic, 41.5)
    assert.equal(grimoire.spellsCast, 12)
})

test('parses buffs, converting frames to seconds', () => {
    const { raw } = fx.save({ buffs: '0,1800,900,7,0,0;5,600,300,0,0,0' })
    const buffs = savefile.parse(savefile.decode(raw)).buffs
    assert.equal(buffs.length, 2)
    assert.equal(buffs[0].maxSeconds, 60)
    assert.equal(buffs[0].secondsLeft, 30)
    assert.equal(buffs[0].arg1, 7)
})

test('identity is stable per save and changes with the seed or creation date', () => {
    const base = {
        ok: true,
        run: { seed: 'abcde', fullDate: 1000, startDate: 2000 },
        scalars: { resets: 1 }
    }
    const a = identity.fromSave(base)
    const same = identity.fromSave(JSON.parse(JSON.stringify(base)))
    const otherSeed = identity.fromSave({ ...base, run: { ...base.run, seed: 'zzzzz' } })
    const otherSave = identity.fromSave({ ...base, run: { ...base.run, fullDate: 9999 } })
    const otherRun = identity.fromSave({ ...base, run: { ...base.run, startDate: 8888 } })

    assert.equal(a.legacyId, same.legacyId)
    assert.notEqual(a.legacyId, otherSeed.legacyId)
    assert.notEqual(a.legacyId, otherSave.legacyId)
    // ascending starts a new run but stays the same save file
    assert.equal(a.legacyId, otherRun.legacyId)
    assert.notEqual(a.runId, otherRun.runId)
})

test('identity degrades to a known-unknown rather than throwing', () => {
    const unknown = identity.fromSave({ ok: false })
    assert.equal(unknown.known, false)
    assert.equal(unknown.legacyId, 'unknown')
})
