const { test } = require('node:test')
const assert = require('node:assert')
const { boot } = require('./harness')

const { A } = boot({})
const S = A.strategy

function view(extra) {
    return {
        cps: 1000,
        cookies: 1e6,
        buildings: [
            { name: 'Cursor', owned: 100, price: 1000, perUnitCps: 0.5, baseCps: 0.1, affordable: true },
            { name: 'Grandma', owned: 50, price: 5000, perUnitCps: 4, baseCps: 1, affordable: true },
            { name: 'Farm', owned: 24, price: 20000, perUnitCps: 20, baseCps: 8, affordable: true }
        ],
        upgrades: [],
        ...extra
    }
}

test('payback is price over added production', () => {
    assert.equal(S.paybackSeconds(100, 10), 10)
    assert.equal(S.paybackSeconds(100, 0), Infinity)
    assert.equal(S.paybackSeconds(100, -1), Infinity)
    assert.equal(S.paybackSeconds(NaN, 10), Infinity)
})

test('sumPrice follows the 15% geometric series', () => {
    assert.equal(S.sumPrice(100, 1), 100)
    // 100 + 115 = 215
    assert.ok(Math.abs(S.sumPrice(100, 2) - 215) < 0.001)
    // closed form matches summing unit by unit
    let manual = 0
    for (let i = 0; i < 25; i++) manual += 100 * Math.pow(1.15, i)
    assert.ok(Math.abs(S.sumPrice(100, 25) - manual) < 0.001)
    assert.equal(S.sumPrice(100, 0), Infinity)
})

test('reads a doubling upgrade as the line it doubles', () => {
    const delta = S.upgradeDeltaCps({ description: 'Cursors are twice as efficient.' }, view())
    // 100 cursors at 0.5 each, doubled, adds another 50
    assert.equal(delta, 50)
})

test('reads a multiplier upgrade', () => {
    const delta = S.upgradeDeltaCps({ description: 'Grandmas are 4 times as efficient.' }, view())
    assert.equal(delta, 600)
})

test('reads a percentage upgrade against the right building', () => {
    const delta = S.upgradeDeltaCps({ description: 'Farms are 5% more efficient' }, view())
    assert.equal(delta, 24)
})

test('reads a global production percentage', () => {
    const delta = S.upgradeDeltaCps({ description: 'Cookie production multiplier +10%' }, view())
    assert.equal(delta, 100)
})

test('returns NaN for an effect it cannot read', () => {
    assert.ok(Number.isNaN(S.upgradeDeltaCps({ description: 'Unlocks something inscrutable' }, view())))
    assert.ok(Number.isNaN(S.upgradeDeltaCps({ description: '' }, view())))
})

test('an unreadable upgrade is marked unmeasured rather than guessed at', () => {
    const scored = S.scoreUpgrades(
        view({
            upgrades: [
                {
                    name: 'Mystery',
                    price: 900000,
                    kind: 'buy',
                    affordable: true,
                    description: 'who knows'
                }
            ]
        })
    )
    assert.equal(scored[0].measured, false)
    assert.equal(scored[0].payback, Infinity)
    assert.ok(Number.isNaN(scored[0].deltaCps))
})

test('a measured upgrade reports its real payback', () => {
    const scored = S.scoreUpgrades(
        view({
            upgrades: [
                {
                    name: 'Twice',
                    price: 5000,
                    kind: 'buy',
                    affordable: true,
                    description: 'Cursors are twice as efficient.'
                }
            ]
        })
    )
    assert.equal(scored[0].measured, true)
    assert.equal(scored[0].payback, 100)
})

test('upgrades are ordered cheapest first, so the drain loop works through them', () => {
    const scored = S.scoreUpgrades(
        view({
            upgrades: [
                { name: 'Dear', price: 9000, kind: 'buy', affordable: true, description: 'x' },
                { name: 'Cheap', price: 50, kind: 'buy', affordable: true, description: 'x' },
                { name: 'Middling', price: 500, kind: 'buy', affordable: true, description: 'x' }
            ]
        })
    )
    assert.deepEqual(
        scored.map(u => u.name),
        ['Cheap', 'Middling', 'Dear']
    )
})

test('skips upgrades classified as toggles', () => {
    const scored = S.scoreUpgrades(
        view({ upgrades: [{ name: 'Elder Pledge', price: 1, kind: 'skip', affordable: true }] })
    )
    assert.equal(scored.length, 0)
})

test('an affordable upgrade is always taken ahead of a building', () => {
    const decision = S.decide(
        view({
            upgrades: [
                { name: 'Unreadable', price: 500, kind: 'buy', affordable: true, description: 'unclear' }
            ]
        })
    )
    assert.equal(decision.action, 'buyUpgrade')
    assert.match(decision.reason, /Unreadable/)
    // the reason names what is being bought; how good a deal it is rides on its
    // own field, so the panel can give each of them a row
    assert.equal(decision.measured, false)
    assert.equal(decision.payback, Infinity)
})

test('a decision carries its payback as a number, not inside the sentence', () => {
    const decision = S.decide(view({}))
    assert.equal(decision.action, 'buyBuilding')
    assert.ok(Number.isFinite(decision.payback), 'payback should be a number')
    assert.equal(
        /\d/.test(decision.reason.replace(/x\d+/, '')),
        false,
        `the reason should hold no figures: "${decision.reason}"`
    )
})

test('an upgrade Alakazam cannot afford does not block a building', () => {
    const decision = S.decide(
        view({
            upgrades: [
                { name: 'Dear', price: 5e9, kind: 'buy', affordable: false, description: 'unclear' }
            ]
        })
    )
    assert.equal(decision.action, 'buyBuilding')
})

test('the same upgrade is judged the same way at every production level', () => {
    // regression: the old scorer assumed an unreadable upgrade gave a few percent
    // of current CpS, so this exact upgrade was refused at 1 CpS and snapped up at
    // 1000. Production growing is not a reason to change your mind about a price.
    const upgrade = {
        name: 'Thousand fingers',
        price: 100,
        kind: 'buy',
        affordable: true,
        description: 'the mouse gains more'
    }
    for (const cps of [0.1, 1, 10, 1000, 1e6]) {
        const decision = S.decide(view({ cps, upgrades: [upgrade] }))
        assert.equal(decision.action, 'buyUpgrade', `should still buy at ${cps} cps`)
    }
})

test('detects crossing a tier boundary', () => {
    assert.equal(S.crossesThreshold(24, 1), true)
    assert.equal(S.crossesThreshold(26, 1), false)
    assert.equal(S.crossesThreshold(24, 10), true)
    assert.equal(S.crossesThreshold(99, 1), true)
    assert.equal(S.crossesThreshold(NaN, 1), false)
})

test('a tier-crossing building is preferred over its raw payback', () => {
    const ranked = S.rankBuildings(view().buildings)
    const farm = ranked.find(b => b.name === 'Farm')
    // raw payback is 20000/20 = 1000s; the discount for reaching 25 puts it first
    assert.equal(farm.crossesThreshold, true)
    assert.ok(farm.payback < 1000)
    assert.equal(ranked[0].name, 'Farm')
})

test('chooseAmount buys one when the runner-up is close behind', () => {
    // owned is past every tier boundary and the bank is small, so neither the
    // threshold rule nor the surplus rule applies and only efficiency is left
    const best = { price: 1000, scoredCps: 1, owned: 600 }
    assert.equal(S.chooseAmount(best, 1001, 200000), 1)
})

test('the tier rule outranks the efficiency rule', () => {
    // efficiency alone would say one, but ten reaches the boundary at 10
    const best = { price: 1000, scoredCps: 1, owned: 5 }
    assert.equal(S.chooseAmount(best, 1001, 200000), 10)
})

test('chooseAmount takes a batch when the bank dwarfs it', () => {
    const best = { price: 100, scoredCps: 1, owned: 5 }
    // ten costs about 2030, a rounding error against this bank
    assert.equal(S.chooseAmount(best, 101, 1e7), 10)
})

test('chooseAmount never exceeds what is affordable', () => {
    const best = { price: 100, scoredCps: 1, owned: 5 }
    assert.equal(S.chooseAmount(best, Infinity, 150), 1)
})

test('chooseAmount reaches for a tier boundary', () => {
    const best = { price: 100, scoredCps: 1, owned: 20 }
    assert.equal(S.chooseAmount(best, 101, 1e6), 10)
})

test('chooseAmount refuses to guess without a production figure', () => {
    assert.equal(S.chooseAmount({ price: 100, scoredCps: NaN, owned: 0 }, 500, 1e9), 1)
})

test('waits rather than buying a worse building', () => {
    const v = view()
    v.buildings = v.buildings.map(b => ({ ...b, affordable: false }))
    const decision = S.decide(v)
    assert.equal(decision.action, 'wait')
    assert.equal(decision.amount, 0)
})

test('reports nothing scorable when there is nothing to score', () => {
    const decision = S.decide({ cps: 0, cookies: 0, buildings: [], upgrades: [] })
    assert.equal(decision.action, 'none')
})

test('clicking upgrades are valued from the measured click rate', () => {
    const clicky = view({ cps: 1000, clicksPerSecond: 3.3, clickCps: 660 })
    // 1% of 1000 CpS per click, 3.3 clicks a second
    assert.ok(
        Math.abs(S.upgradeDeltaCps({ description: 'Clicking gains +1% of your CpS.' }, clicky) - 33) <
            0.001
    )
    // 174 non-cursor buildings owned in the fixture (50 grandmas + 24 farms)
    assert.ok(
        Math.abs(
            S.upgradeDeltaCps(
                {
                    description:
                        'The mouse and cursors gain +0.1 cookies for each non-cursor object owned.'
                },
                clicky
            ) -
                3.3 * 0.1 * 74
        ) < 0.001
    )
})

test('clicking upgrades read as unknown when nothing is clicking', () => {
    const idle = view({ clicksPerSecond: 0, clickCps: 0 })
    assert.ok(Number.isNaN(S.upgradeDeltaCps({ description: 'Clicking gains +1% of your CpS.' }, idle)))
})
