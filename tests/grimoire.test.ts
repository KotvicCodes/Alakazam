const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./harness')
const { clock } = require('./clock')
const { El } = require('./dom')
const fx = require('./fixtures')

async function grimoire({
    magic = 96,
    maximum = 100,
    savedAura = 0,
    confirmed = true
}: Record<string, any> = {}) {
    const time = clock()
    const h = boot({ clock: time, save: fx.save({ dragonAura: savedAura }).raw })
    await h.A.store.ready('grimoire-regression')
    let combo = false
    const casts = []
    const bar = new El('div', { id: 'grimoireBarText', text: `${magic}/${maximum}` })
    h.game.doc.body.append(bar)
    for (const [id, cost] of [
        [4, Math.floor(10 + maximum * 0.1)],
        [1, Math.floor(10 + maximum * 0.6)]
    ]) {
        const button = new El('div', { id: 'grimoireSpell' + id })
        button.addEventListener('click', () => {
            if (magic < cost) return
            casts.push(id)
            if (confirmed) {
                magic -= cost
                bar.innerText = `${magic}/${maximum}`
            }
        })
        h.game.doc.body.append(button)
    }
    h.A.buffs.guardStatus = () => ({ blocked: false })
    h.A.buffs.hasSpellComboBuff = () => combo
    return {
        h,
        time,
        casts,
        combo: () => (combo = true),
        tick: () => h.A.registry.get('grimoire').tick()
    }
}

test('a confirmed idle cast does not delay Fate when a production buff arrives', async () => {
    const g = await grimoire()
    await g.tick()
    assert.deepEqual(g.casts, [4])
    assert.equal(g.h.A.grimoire.state().magic, 76)
    g.time.advance(2000)
    g.combo()
    await g.tick()
    assert.deepEqual(g.casts, [4, 1])
    await g.tick()
    assert.deepEqual(g.casts, [4, 1], 'Fate retains the normal cooldown')
})

test('an idle click with no observed magic change retains the normal cooldown', async () => {
    const g = await grimoire({ confirmed: false })
    await g.tick()
    g.time.advance(2000)
    g.combo()
    await g.tick()
    assert.deepEqual(g.casts, [4])
})

test('a stale Supreme Intellect discount cannot spend the undiscounted Fate reserve', async () => {
    const g = await grimoire({ magic: 57, maximum: 60, savedAura: 20 })
    assert.equal(g.h.A.grimoire.state().discount, 0.1)
    await g.tick()
    assert.deepEqual(g.casts, [])
    assert.equal(g.h.A.grimoire.state().magic, 57)
    g.time.advance(2000)
    g.combo()
    await g.tick()
    assert.deepEqual(g.casts, [1])
    assert.equal(g.h.A.grimoire.state().magic, 11)
})
