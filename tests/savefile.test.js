const { test } = require('node:test')
const assert = require('node:assert')
const { boot } = require('./harness')
const fx = require('./fixtures')

const { A } = boot({})
const { savefile, identity } = A

test('reads the percent-escaped form the game actually stores', () => {
    // Game.WriteSave stores escape(base64 + '!END!'), so '=' arrives as %3D and
    // the marker as %21END%21. Reading it without unescaping first finds no
    // marker, hands the percent signs to atob, and calls a good save "not
    // base64" -- which it did, on every save, in every real browser.
    const { text, raw } = fx.save({ seed: 'qwert' })
    assert.match(raw, /%21END%21$/)
    assert.equal(savefile.decode(raw), text)
})

test('still reads a save that was never escaped', () => {
    // a code pasted by hand, or anything that has already been through unescape
    const { text, raw } = fx.save({ seed: 'qwert' })
    assert.equal(savefile.decode(unescape(raw)), text)
})

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

test('an unfamiliar game version is not remarked on at all', () => {
    const { raw } = fx.save({ version: '9.999', minigames: { 2: fx.garden({ unlocked: [0, 1, 2] }) } })
    const parsed = savefile.parse(savefile.decode(raw))
    // the layout is what matters, and it checks out. Refusing to trust a save
    // purely because the game shipped a patch is how ascension went quiet, and
    // warning about it in the panel forever was the same mistake made quietly.
    assert.equal(parsed.stale, false)
    assert.equal(parsed.reason, '')
    assert.equal(parsed.version, '9.999')
    // bitfields and minigame saves are self delimiting, so they stay usable
    assert.equal(parsed.buildings[2].minigame.unlocked.filter(Boolean).length, 3)
})

test('distrusts a save whose scalar layout is two fields short', () => {
    // the real bug: the parser did not know about the shiny wrinkler pair, so
    // every field from the lumps onward was read two places out
    const { raw } = fx.save({ driftedScalars: true, lumps: 4, lumpType: 2 })
    const parsed = savefile.parse(savefile.decode(raw))
    assert.equal(parsed.stale, true)
    assert.match(parsed.reason, /scalar layout/)
})

test('reads the lump fields from the other side of the shiny wrinklers', () => {
    const at = Date.now() - 60000
    const { raw } = fx.save({
        shinyWrinklers: 3,
        shinyWrinklerHoard: 1e9,
        lumps: 7,
        lumpsTotal: 40,
        lumpT: at,
        lumpType: 2
    })
    const parsed = savefile.parse(savefile.decode(raw))
    assert.equal(parsed.stale, false)
    assert.equal(parsed.scalars.wrinklersShiny, 3)
    assert.equal(parsed.scalars.lumps, 7)
    assert.equal(parsed.scalars.lumpsTotal, 40)
    assert.equal(parsed.scalars.lumpT, at)
    assert.equal(parsed.scalars.lumpCurrentType, 2)
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

//! Reading the save out of localStorage

test('base64 is repaired before decoding rather than rejected', () => {
    const { raw } = fx.save({})
    const body = raw.split('!END!')[0]

    // the game's own loader strips whitespace, so a save that has been through a
    // text field is still a save
    assert.ok(savefile.decode(body.slice(0, 8) + '\n ' + body.slice(8) + '!END!'))
    // url-safe base64, and padding trimmed off the end
    const urlSafe = body.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    assert.equal(savefile.decode(urlSafe + '!END!'), savefile.decode(raw))
})

test('a decode failure says which step failed', () => {
    assert.equal(savefile.decodeDetailed(null).reason, 'no save found')
    assert.equal(savefile.decodeDetailed('not base64 at all !!').reason, 'save is not base64')
    const { raw } = fx.save({})
    assert.equal(savefile.decodeDetailed(raw).reason, '')
})

//* store
// a localStorage standing in for the page's, with the length/key pair the reader
// uses to find a save that is not under the name it expects
function localStorageOf(entries) {
    const keys = Object.keys(entries)
    return {
        length: keys.length,
        key: i => keys[i],
        getItem: k => (k in entries ? entries[k] : null)
    }
}

test('the save is found even when it is not under the usual key', () => {
    const { raw } = fx.save({})
    const store = localStorageOf({ CookieClickerGameBeta: raw })
    const read = boot({ localStorage: store }).A.savefile.read()
    assert.equal(read.ok, true, `read failed: ${read.reason}`)
    assert.equal(read.key, 'CookieClickerGameBeta')
})

test('the usual key wins when both are present', () => {
    const store = localStorageOf({
        CookieClickerGameBeta: fx.save({ resets: 9 }).raw,
        CookieClickerGame: fx.save({ resets: 4 }).raw
    })
    const read = boot({ localStorage: store }).A.savefile.read()
    assert.equal(read.key, 'CookieClickerGame')
    assert.equal(read.scalars.resets, 4)
})

test('a missing save is reported as missing, not as a decode failure', () => {
    const read = boot({ localStorage: localStorageOf({}) }).A.savefile.read()
    assert.equal(read.ok, false)
    assert.equal(read.reason, 'no save found')
})

test('a save that is present but unreadable says so specifically', () => {
    const store = localStorageOf({ CookieClickerGame: 'this is not a save !!' })
    const read = boot({ localStorage: store }).A.savefile.read()
    assert.equal(read.ok, false)
    assert.equal(read.reason, 'save is not base64')
})

test('the fingerprint notices a change anywhere in the save', () => {
    // it used to be the length plus the first 24 characters. the save is base64,
    // so those cover the version and the run's start date, neither of which move
    // during a run: two autosaves of the same length were indistinguishable.
    const a = fx.save({ cookieClicks: 1000, handmadeCookies: 10000 }).raw
    const b = fx.save({ cookieClicks: 1600, handmadeCookies: 16000 }).raw
    assert.equal(a.length, b.length, 'this test is pointless unless the lengths match')

    const print = raw => boot({ save: raw }).A.savefile.rawFingerprint()
    assert.notEqual(print(a), print(b))
    assert.equal(print(a), print(a))
})
