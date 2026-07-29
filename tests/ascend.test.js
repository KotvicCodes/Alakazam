const { test } = require('node:test')
const assert = require('node:assert')
const { boot } = require('./harness')

const { A } = boot({})
const S = A.strategy.ascend
const H = A.data.heavenly

//! The prestige formula

test('prestige is the cube root of cookies over a trillion', () => {
    // 1e12 cookies is exactly one prestige level
    assert.equal(S.prestigeFor(1e12), 1)
    // 8e12 is two: doubling the level takes eight times the cookies
    assert.equal(S.prestigeFor(8e12), 2)
    assert.equal(S.prestigeFor(1000 * 1e12), 10)
    // nothing, and nonsense, are worth nothing
    assert.equal(S.prestigeFor(0), 0)
    assert.equal(S.prestigeFor(-1), 0)
    assert.equal(S.prestigeFor(NaN), 0)
})

test('prestige is floored, not rounded', () => {
    // just under two levels is still one
    assert.equal(S.prestigeFor(8e12 - 1), 1)
})

test('the first ascension milestone matches the guide', () => {
    // the guide says 365 chips at 48.627 quintillion cookies, which is its own
    // figure rounded to three places, so it lands a hair under the real boundary
    assert.ok(Math.abs(S.cookiesFor(365) - 4.8627e19) / 4.8627e19 < 0.001)
    assert.equal(S.prestigeFor(S.cookiesFor(365)), 365)
})

test('cookiesFor inverts prestigeFor', () => {
    for (const level of [1, 7, 365, 2185, 127776]) {
        assert.equal(S.prestigeFor(S.cookiesFor(level)), level)
    }
})

//! Projection

test('projection folds this run into the lifetime total', () => {
    // nothing banked yet, so the run's own cookies are the whole of it
    const p = S.projected({ cookiesReset: 0, cookiesEarned: 8e12 })
    assert.equal(p.current, 0)
    assert.equal(p.prestige, 2)
    assert.equal(p.chipsGained, 2)
})

test('projection counts only the levels the run adds', () => {
    // already at level 2, this run would take the total to level 3
    const p = S.projected({ cookiesReset: 8e12, cookiesEarned: 27e12 - 8e12 })
    assert.equal(p.current, 2)
    assert.equal(p.prestige, 3)
    assert.equal(p.chipsGained, 1)
})

test('projection never reports negative chips', () => {
    const p = S.projected({ cookiesReset: 8e12, cookiesEarned: 0 })
    assert.equal(p.chipsGained, 0)
})

test('projection survives a save with nothing in it', () => {
    const p = S.projected({})
    assert.equal(p.current, 0)
    assert.equal(p.prestige, 0)
    assert.equal(p.chipsGained, 0)
    assert.doesNotThrow(() => S.projected(null))
})

//! Targets

test('targets come from the guide, indexed by ascensions done', () => {
    assert.equal(S.targetFor(0), 365)
    assert.equal(S.targetFor(1), 2185)
    assert.equal(S.targetFor(2), 12301)
    assert.equal(S.targetFor(4), 127776)
})

test('past the end of the guide there is no target', () => {
    assert.equal(S.targetFor(H.PLAN.length), null)
    assert.equal(S.targetFor(999), null)
})

//! The decision

test('a fresh run is never worth ascending', () => {
    const d = S.worthAscending({ cookiesReset: 0, cookiesEarned: 1e6, resets: 0 })
    assert.equal(d.ready, false)
    assert.equal(d.why, 'no chips yet')
})

test('a first run short of 365 chips waits', () => {
    const d = S.worthAscending({ cookiesReset: 0, cookiesEarned: S.cookiesFor(300), resets: 0 })
    assert.equal(d.prestige, 300)
    assert.equal(d.target, 365)
    assert.equal(d.ready, false)
    assert.match(d.why, /saving for 365/)
})

test('a first run at 365 chips ascends', () => {
    const d = S.worthAscending({ cookiesReset: 0, cookiesEarned: S.cookiesFor(365), resets: 0 })
    assert.equal(d.ready, true)
    assert.equal(d.chipsGained, 365)
})

test('overshooting the target still ascends', () => {
    const d = S.worthAscending({ cookiesReset: 0, cookiesEarned: S.cookiesFor(900), resets: 0 })
    assert.equal(d.ready, true)
    assert.equal(d.target, 365)
})

test('the second ascension aims at the second target, not the first', () => {
    // 365 already banked; reaching 365 again is not enough, 2185 is the bar
    const banked = S.cookiesFor(365)
    const short = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(2000) - banked,
        resets: 1
    })
    assert.equal(short.ready, false)
    assert.equal(short.target, 2185)

    const enough = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(2185) - banked,
        resets: 1
    })
    assert.equal(enough.ready, true)
})

test('past the guide it falls back to doubling prestige', () => {
    const resets = H.PLAN.length
    const banked = S.cookiesFor(1e6)

    // half again is not a double
    const short = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(1.5e6) - banked,
        resets
    })
    assert.equal(short.ready, false)
    assert.equal(short.target, null)
    assert.match(short.why, /past the plan/)

    const enough = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(2e6) - banked,
        resets
    })
    assert.equal(enough.ready, true)
    assert.match(enough.why, /double/)
})

//! The plan itself

test('the plan is ordered by target and starts at the guide milestones', () => {
    assert.equal(H.PLAN[0].chips, 365)
    assert.equal(H.PLAN[1].chips, 2185)
    // the guide's own table is not monotonic near the end, where the last few
    // entries are sized by what they buy rather than by a climb, so only the
    // early run is asserted as increasing
    for (let i = 1; i < 15; i++) {
        assert.ok(H.PLAN[i].chips > H.PLAN[i - 1].chips, `entry ${i} climbs`)
    }
})

test('every plan upgrade has a positive cost and a place in the order', () => {
    for (const step of H.PLAN) {
        for (const [name, cost] of step.upgrades) {
            assert.ok(cost > 0, `${name} costs something`)
            assert.ok(Number.isFinite(H.priority(name)), `${name} is on the shopping list`)
            assert.equal(H.COST[H.normalise(name)], cost)
        }
    }
})

test('the shopping list has no duplicates', () => {
    assert.equal(new Set(H.ORDER).size, H.ORDER.length)
})

test('priority follows the guide order and rejects anything off-plan', () => {
    assert.equal(H.priority('Legacy'), 0)
    assert.ok(H.priority('Heavenly cookies') < H.priority('Heralds'))
    assert.ok(H.priority('Heralds') < H.priority('Season switcher'))
    assert.equal(H.priority('Chocolate egg'), Infinity)
    assert.equal(H.priority(''), Infinity)
})

test('names are matched however the game capitalises them', () => {
    assert.equal(H.priority('legacy'), H.priority('Legacy'))
    assert.equal(H.priority('  HEAVENLY   COOKIES '), H.priority('Heavenly cookies'))
    // the game ships a registered trademark in this one; the guide does not
    assert.ok(Number.isFinite(H.priority('Milkhelp® lactose intolerance relief tablets')))
})

test('permanent slot picks put kittens first', () => {
    assert.equal(H.PERMANENT_PICKS[0], 'kitten angels')
    assert.ok(H.PERMANENT_PICKS.indexOf('kitten helpers') < H.PERMANENT_PICKS.indexOf('heavenly key'))
})
