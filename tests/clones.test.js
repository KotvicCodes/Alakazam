const { test } = require('node:test')
const assert = require('node:assert')
const { boot } = require('./harness')
const fx = require('./fixtures')

const C = boot({}).A.data.clones

//! The appearance table

test('the achievement condition matches the game own check', () => {
    // the wiki example code, which is what the module aims for
    assert.equal(C.matchesLikeness([9, 1, 1, 3, 7, 3, 0]), true)
    // hair colour 6 and head 2 are the other legal halves of each clause
    assert.equal(C.matchesLikeness([9, 6, 4, 2, 0, 0, 3]), true)
    // wrong hair
    assert.equal(C.matchesLikeness([8, 1, 1, 3, 7, 3, 0]), false)
    // wrong hair colour
    assert.equal(C.matchesLikeness([9, 2, 1, 3, 7, 3, 0]), false)
    // wrong head
    assert.equal(C.matchesLikeness([9, 1, 1, 1, 7, 3, 0]), false)
    // an accessory on both sides: one of them has to be bare
    assert.equal(C.matchesLikeness([9, 1, 1, 3, 7, 3, 2]), false)
    // neither side carries the right accessory
    assert.equal(C.matchesLikeness([9, 1, 1, 3, 7, 5, 0]), false)
})

test('skin colour and face are free', () => {
    for (let skin = 0; skin < 15; skin++) {
        assert.equal(C.matchesLikeness([9, 1, skin, 3, 7, 3, 0]), true)
    }
})

test('the preset is a valid appearance', () => {
    assert.equal(C.PRESET.length, C.GENES.length)
    C.PRESET.forEach((v, i) => {
        assert.ok(v >= 0 && v < C.CHOICES[i], `${C.GENES[i]} index ${v} is in range`)
    })
})

test('the default appearance is not all zeroes', () => {
    // hair colour defaults to 1, which is why "untouched" cannot be tested for
    // by looking for zeroes
    assert.equal(C.isDefault([0, 1, 0, 0, 0, 0, 0]), true)
    assert.equal(C.isDefault([0, 0, 0, 0, 0, 0, 0]), false)
    assert.equal(C.isDefault(C.PRESET), false)
})

test('stepping takes the shorter way round a wrapping list', () => {
    // hair has 17 choices: 1 to 16 is fifteen steps forward or two back
    assert.equal(C.stepsTo(0, 1, 16), -2)
    assert.equal(C.stepsTo(0, 16, 1), 2)
    assert.equal(C.stepsTo(0, 3, 5), 2)
    assert.equal(C.stepsTo(0, 5, 5), 0)
    // head has five, so two either way is a tie and forward wins
    assert.equal(C.stepsTo(3, 0, 2), 2)
})

//! The module

function cloneSave(opts = {}) {
    return fx.save({
        amounts: { 19: opts.owned === undefined ? 1 : opts.owned },
        appearance: opts.appearance
    }).raw
}

async function styleClones(h, ticks = 12) {
    await h.A.store.ready('t')
    const mod = h.A.registry.get('clones')
    for (let i = 0; i < ticks; i++) await mod.tick()
    return h.game.state
}

test('owning a You earns the likeness achievement and leaves the preset', async () => {
    const h = boot({ save: cloneSave() })
    const state = await styleClones(h)
    assert.equal(state.likenessWon, true, 'never matched the grandma look')
    assert.deepEqual(state.genes, C.PRESET)
})

test('the achievement fires on a real arrow click, not on arriving at the look', async () => {
    // the game only checks inside its step handler, so a run that walked every
    // gene into place without a final step would set the appearance and win nothing
    const h = boot({ save: cloneSave() })
    const state = await styleClones(h)
    const won = state.log.indexOf('achievement In her likeness')
    assert.ok(won !== -1)
})

test('a look already reached is still stepped once so the game notices', async () => {
    // start the customizer already on the achievement appearance. Walking finds
    // nothing to do, so without the deliberate nudge nothing would ever fire.
    const h = boot({ save: cloneSave(), game: { genes: C.LIKENESS.slice() } })
    const state = await styleClones(h)
    assert.equal(state.likenessWon, true)
})

test('nothing happens until a You is owned', async () => {
    const h = boot({ save: cloneSave({ owned: 0 }) })
    const state = await styleClones(h)
    assert.equal(state.likenessWon, false)
    assert.deepEqual(state.genes, [0, 1, 0, 0, 0, 0, 0])
})

test('it runs once and then leaves the clones alone', async () => {
    const h = boot({ save: cloneSave() })
    await styleClones(h)
    assert.equal(h.A.store.get('clonesStyled'), true)

    // the player redresses them; a later tick must not undo that
    h.game.state.genes = [3, 3, 3, 3, 3, 3, 3]
    await h.A.registry.get('clones').tick()
    await h.A.registry.get('clones').tick()
    assert.deepEqual(h.game.state.genes, [3, 3, 3, 3, 3, 3, 3])
})

test('an appearance the player already chose is never touched', async () => {
    const h = boot({ save: cloneSave({ appearance: '4,5,6,1,2,3,4' }) })
    const state = await styleClones(h)
    assert.deepEqual(state.genes, [0, 1, 0, 0, 0, 0, 0], 'opened a customizer it should not have')
    assert.equal(h.A.store.get('clonesStyled'), true)
})

test('the default appearance is not mistaken for a choice', async () => {
    const h = boot({ save: cloneSave({ appearance: '0,1,0,0,0,0,0' }) })
    const state = await styleClones(h)
    assert.equal(state.likenessWon, true)
})

test('the appearance is parsed out of the save run section', () => {
    const h = boot({ save: cloneSave({ appearance: '11,10,10,1,1,12,30' }) })
    assert.deepEqual(h.A.save.get().run.appearance, [11, 10, 10, 1, 1, 12, 30])
})

test('a save with no appearance field reads as unknown rather than as zeroes', () => {
    const h = boot({ save: cloneSave() })
    assert.equal(h.A.save.get().run.appearance, null)
})

test('clone styling is a module the master switch can stop', () => {
    const h = boot({})
    const mod = h.A.registry.get('clones')
    assert.ok(mod)
    assert.equal(mod.setting, 'clones')
    assert.equal(h.A.store.DEFAULTS.clones, true)
})
