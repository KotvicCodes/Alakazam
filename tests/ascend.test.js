const { test } = require('node:test')
const assert = require('node:assert')
const { boot, sleep } = require('./harness')
const fx = require('./fixtures')

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

test('what the plan still wants comes from what has been spent on it', () => {
    assert.equal(S.stillToBuy(0), 365)
    assert.equal(S.stillToBuy(100), 265)
    // the first entry is paid off, so the bar is the second entry's list
    assert.equal(S.stillToBuy(365), 2185)
    // and part way into the second, only the rest of it
    assert.equal(S.stillToBuy(1365), 1185)
})

test('the whole plan bought leaves nothing to aim at', () => {
    const total = H.CUMULATIVE[H.CUMULATIVE.length - 1]
    assert.equal(S.stillToBuy(total), null)
    assert.equal(S.stillToBuy(total * 2), null)
})

test('the cumulative table is the running total of the guide entries', () => {
    assert.equal(H.CUMULATIVE[0], 365)
    assert.equal(H.CUMULATIVE[1], 365 + 2185)
    assert.equal(H.CUMULATIVE.length, H.PLAN.length)
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

test('the second ascension aims at what is left of the plan', () => {
    // the first entry was bought outright, so 2185 more chips are wanted
    const banked = S.cookiesFor(365)
    const short = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(2000) - banked,
        heavenlyChipsSpent: 365,
        resets: 1
    })
    assert.equal(short.ready, false)
    assert.equal(short.chipsNeeded, 2185)
    assert.equal(short.target, 365 + 2185)

    const enough = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(365 + 2185) - banked,
        heavenlyChipsSpent: 365,
        resets: 1
    })
    assert.equal(enough.ready, true)
})

test('upgrades already bought from the next entry lower the bar', () => {
    // the run overshot and the shopping pass carried on into the second entry,
    // buying 1000 chips worth of it. Asking for the full 2185 again would be
    // asking for chips that are already spent.
    const banked = S.cookiesFor(1365)
    const d = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(1365 + 1185) - banked,
        heavenlyChipsSpent: 1365,
        resets: 1
    })
    assert.equal(d.chipsNeeded, 1185)
    assert.equal(d.ready, true)
})

test('chips already banked count toward what the plan wants', () => {
    // 2000 chips sitting unspent and 185 to go, not 2185
    const banked = S.cookiesFor(2365)
    const d = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(2365 + 185) - banked,
        heavenlyChipsSpent: 365,
        heavenlyChips: 2000,
        resets: 1
    })
    assert.equal(d.chipsNeeded, 2185)
    assert.equal(d.target, d.current + 185, 'the target is the levels the plan is short by')
    assert.equal(d.ready, true)
})

test('a save that already holds enough still has to earn a chip', () => {
    // the bank covers the whole of the next entry, but ascending for nothing at
    // all is still a loss
    const banked = S.cookiesFor(365)
    const idle = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: 0,
        heavenlyChipsSpent: 365,
        heavenlyChips: 5000,
        resets: 1
    })
    assert.equal(idle.ready, false)
    assert.match(idle.why, /no chips yet/)
})

test('past the guide it falls back to doubling prestige', () => {
    // above the top of the table there is nothing left to aim at
    const top = Math.max(...H.PLAN.map(p => p.chips))
    const banked = S.cookiesFor(top * 1.1)

    // half again is not a double
    const short = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(top * 1.65) - banked,
        heavenlyChipsSpent: H.CUMULATIVE[H.CUMULATIVE.length - 1],
        resets: H.PLAN.length
    })
    assert.equal(short.ready, false)
    assert.equal(short.target, null)
    assert.match(short.why, /whole plan is bought/)

    const enough = S.worthAscending({
        cookiesReset: banked,
        cookiesEarned: S.cookiesFor(top * 2.2) - banked,
        heavenlyChipsSpent: H.CUMULATIVE[H.CUMULATIVE.length - 1],
        resets: H.PLAN.length
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

test('permanent slot picks are kittens, strongest first', () => {
    // the game's own tier order. The old list ran experts before specialists and
    // stopped at analysts, so a save owning any of the four strongest was handed
    // one from five tiers down, which was the first name it recognised.
    const order = [
        'kitten strategists',
        'kitten admins',
        'kitten executives',
        'kitten analysts',
        'kitten marketeers',
        'kitten assistants to the regional manager',
        'kitten consultants',
        'kitten experts',
        'kitten specialists',
        'kitten accountants',
        'kitten managers',
        'kitten overseers',
        'kitten engineers',
        'kitten workers',
        'kitten helpers'
    ]
    assert.deepEqual(H.PERMANENT_PICKS.slice(0, order.length), order)
    assert.ok(H.PERMANENT_PICKS.indexOf('kitten helpers') < H.PERMANENT_PICKS.indexOf('heavenly key'))
    // Game.AssignPermanentSlot only lists the plain and cookie pools, so a
    // heavenly upgrade can never be on offer
    assert.equal(H.PERMANENT_PICKS.indexOf('kitten angels'), -1)
})

//! The planner module

//* ascendSave
// a save at a given lifetime total and reset count. cookiesEarned carries the
// current run, cookiesReset everything banked before it.
function ascendSave({
    earned = 0,
    reset = 0,
    resets = 0,
    chips = 0,
    version,
    drifted,
    permanentSlots
} = {}) {
    return fx.save({
        cookiesEarned: earned,
        cookiesReset: reset,
        resets,
        heavenlyChips: chips,
        driftedScalars: drifted,
        permanentSlots,
        version
    }).raw
}

test('the planner reads the run straight out of the save', () => {
    const h = boot({ save: ascendSave({ earned: 8e12, chips: 3 }) })
    const s = h.A.ascend.state()
    assert.equal(s.prestige, 2)
    assert.equal(s.chipsGained, 2)
    assert.equal(s.chipsBanked, 3)
    assert.equal(s.ascensions, 0)
    // the plan wants 365 and three are already banked, so the run has 362 to earn
    assert.equal(s.chipsNeeded, 365)
    assert.equal(s.target, 362)
    assert.equal(s.ready, false)
})

test('the planner says ready once the plan target is met', () => {
    const h = boot({ save: ascendSave({ earned: S.cookiesFor(365) }) })
    assert.equal(h.A.ascend.state().ready, true)
})

test('the planner reports how far off the target still is', () => {
    const h = boot({ save: ascendSave({ earned: S.cookiesFor(300) }) })
    const s = h.A.ascend.state()
    assert.ok(s.cookiesToTarget > 0)
    // exactly the gap between where the run is and what 365 needs
    const gap = S.cookiesFor(365) - S.cookiesFor(300)
    assert.ok(Math.abs(s.cookiesToTarget - gap) / gap < 1e-9)
})

test('a met target leaves nothing still to bake', () => {
    const h = boot({ save: ascendSave({ earned: S.cookiesFor(400) }) })
    assert.equal(h.A.ascend.state().cookiesToTarget, 0)
})

test('an untrusted save refuses to plan an ascension at all', () => {
    // a scalar section whose layout does not match means the positional offsets
    // cannot be believed, and ascending on a misread cookiesReset is unrecoverable
    const h = boot({ save: ascendSave({ earned: S.cookiesFor(999), drifted: true }) })
    assert.equal(h.A.ascend.state(), null)
})

test('a game version we have not read the layout from still plans', () => {
    // the version list is a note, not a gate. It used to be a gate, and every
    // game patch quietly switched ascension off until somebody updated it.
    const h = boot({ save: ascendSave({ earned: S.cookiesFor(999), version: '9.999' }) })
    const s = h.A.ascend.state()
    assert.ok(s)
    assert.equal(s.ready, true)
})

//* run
// drive one module tick directly rather than through the scheduler. The planner
// is a pure read on a 5 second interval, so waiting for a real tick would add
// five seconds per test for no extra coverage.
async function run(h) {
    const mod = h.A.registry.get('ascend')
    if (mod.setup) await mod.setup()
    await mod.tick()
    return mod
}

test('the planner publishes to the debug handle', async () => {
    const h = boot({ save: ascendSave({ earned: 8e12 }) })
    await h.A.store.ready('t')
    await run(h)
    assert.equal(h.debug().ascend.prestige, 2)
    assert.equal(h.debug().ascend.chipsGained, 2)
})

test('an unreadable save is reported rather than guessed around', async () => {
    const h = boot({ save: ascendSave({ earned: 8e12, drifted: true }) })
    await h.A.store.ready('t')
    await run(h)
    assert.match(h.debug().ascend.blocked, /trustworthy/)
    assert.equal(h.debug().ascend.prestige, undefined)
})

test('the phase starts at watching and commits once the target is met', async () => {
    const h = boot({ save: ascendSave({ earned: S.cookiesFor(365) }) })
    await h.A.store.ready('t')
    assert.equal(h.A.ascend.state().phase, 'watching')
    // ready is passed through within the same tick: there is nothing running to
    // wait out. The loan phase is next, and with no bank it falls straight through.
    await run(h)
    assert.equal(h.A.ascend.state().phase, 'loans')
    await h.A.registry.get('ascend').tick()
    assert.equal(h.A.ascend.state().phase, 'ascending')
})

test('a run short of the target stays in watching', async () => {
    const h = boot({ save: ascendSave({ earned: S.cookiesFor(100) }) })
    await h.A.store.ready('t')
    await run(h)
    assert.equal(h.A.ascend.state().phase, 'watching')
})

test('the phase is remembered across a reload', async () => {
    const disk = {}
    const first = boot({ save: ascendSave({ earned: S.cookiesFor(365) }), disk })
    await first.A.store.ready('t')
    await run(first)
    await first.A.store.flush()

    // a fresh boot against the same storage picks the phase back up
    const second = boot({ save: ascendSave({ earned: S.cookiesFor(365) }), disk })
    await second.A.store.ready('t')
    await second.A.registry.get('ascend').setup()
    assert.equal(second.A.ascend.state().phase, 'loans')
})

test('ascension is a module the master switch can stop', () => {
    const h = boot({})
    const mod = h.A.registry.get('ascend')
    assert.ok(mod)
    assert.equal(mod.setting, 'ascend')
    assert.equal(mod.always, false)
    assert.equal(h.A.store.DEFAULTS.ascend, true)
})

//! The click path

//* TREE
// a small heavenly tree: two on-plan upgrades, one gated behind the first, one
// off-plan, and a permanent slot. `needs` mirrors the game's own prerequisites,
// which render as a ghosted crate with no click handler until they are met.
const TREE = [
    { id: 1, name: 'Legacy', cost: 1 },
    { id: 2, name: 'Heavenly cookies', cost: 3, needs: 'Legacy' },
    { id: 3, name: 'How to bake your dragon', cost: 9, needs: 'Legacy' },
    { id: 4, name: 'Chocolate egg', cost: 2 },
    { id: 5, name: 'Permanent upgrade slot I', cost: 100, needs: 'Legacy', slot: true }
]

function ascender(opts = {}) {
    const h = boot({
        save: ascendSave({
            earned: S.cookiesFor(opts.prestige || 365),
            permanentSlots: opts.permanentSlots
        }),
        game: {
            chips: opts.chips != null ? opts.chips : 13,
            heavenly: opts.heavenly || TREE,
            heavenlyBought: opts.heavenlyBought,
            permanents: opts.permanents,
            permanentChoices: opts.permanentChoices
        }
    })
    return h
}

//* pump
// run ticks until the phase settles or the budget runs out. The sequence is a
// state machine that advances at most one step per tick on purpose, so a test
// that wants the end of it has to turn the handle.
async function pump(h, ticks = 40) {
    await h.A.store.ready('t')
    const mod = h.A.registry.get('ascend')
    await mod.setup()
    for (let i = 0; i < ticks; i++) await mod.tick()
    return h.game.state
}

test('the sequence runs from the legacy button to reincarnating', async () => {
    const h = ascender()
    const state = await pump(h)
    assert.ok(state.log.indexOf('prompt Ascend') !== -1, 'opened the ascend prompt')
    assert.ok(state.log.indexOf('reincarnated') !== -1, 'reincarnated at the end')
    // the prompt comes before the reincarnation, and each happens exactly once
    assert.ok(state.log.indexOf('prompt Ascend') < state.log.indexOf('reincarnated'))
    assert.equal(state.log.filter(l => l === 'reincarnated').length, 1)
})

test('a stale save is not mistaken for a fresh run worth ascending', async () => {
    // the save still describes the run that just ended: same reset count, still a
    // lifetime of cookies in it. Acting on that would ascend an empty run at once.
    const h = ascender()
    const state = await pump(h, 60)
    assert.equal(state.log.filter(l => l === 'reincarnated').length, 1)
    assert.equal(h.debug().ascend.waitingForSave, true)
})

test('heavenly upgrades are bought in the guide order', async () => {
    const state = await pump(ascender())
    const order = state.log.filter(l => l.indexOf('heavenly ') === 0).map(l => l.slice(9))
    assert.deepEqual(order.slice(0, 3), ['Legacy', 'Heavenly cookies', 'How to bake your dragon'])
})

test('an upgrade that is not on the plan is never bought', async () => {
    const state = await pump(ascender({ chips: 1000 }))
    assert.equal(state.heavenlyBought.indexOf('Chocolate egg'), -1)
    // and its chips went to the plan instead
    assert.ok(state.heavenlyBought.indexOf('Permanent upgrade slot I') !== -1)
})

test('a ghosted crate is never clicked, and unlocks once its parent is bought', async () => {
    // Heavenly cookies is gated behind Legacy, so on the first pass it is a plain
    // div with no handler at all. It still ends up bought.
    const state = await pump(ascender())
    assert.ok(state.heavenlyBought.indexOf('Heavenly cookies') !== -1)
    assert.ok(
        state.log.indexOf('heavenly Legacy') < state.log.indexOf('heavenly Heavenly cookies'),
        'the parent was bought first'
    )
})

test('shopping stops at what the chips can actually buy', async () => {
    // 4 chips buys Legacy and Heavenly cookies and nothing else
    const state = await pump(ascender({ chips: 4 }))
    assert.deepEqual(state.heavenlyBought, ['Legacy', 'Heavenly cookies'])
    assert.equal(state.chips, 0)
    assert.ok(state.log.indexOf('reincarnated') !== -1)
})

test('a crate that refuses the purchase is dropped rather than clicked forever', async () => {
    // the tree offers something affordable on paper that the game will refuse
    const h = ascender({ chips: 2, heavenly: [{ id: 1, name: 'Legacy', cost: 1 }] })
    // make the game reject it: the crate is drawn, but the handler checks again
    const state = await pump(h)
    assert.deepEqual(state.heavenlyBought, ['Legacy'])
    const rejects = state.log.filter(l => l.indexOf('REJECT heavenly') === 0)
    assert.ok(rejects.length <= 1, `clicked a refusing crate ${rejects.length} times`)
})

test('a permanent slot is filled from the preference list', async () => {
    const state = await pump(
        ascender({
            chips: 1000,
            permanentChoices: [
                { id: 90, name: 'Forwards from grandma' },
                { id: 91, name: 'Kitten helpers' },
                { id: 92, name: 'Plastic mouse' }
            ]
        })
    )
    // kittens outrank the mouse, and the grandma upgrade is not a candidate at all
    assert.equal(state.permanent, 'Kitten helpers')
})

test('the shopping pass never loops on an owned permanent slot', async () => {
    // Game.Upgrade.buy ends with "if (this.bought && this.activateFunction)
    // this.activateFunction()", outside the branch that checks whether anything
    // was purchased. A slot's activateFunction opens its picker, so clicking one
    // you already own reopens the picker for free. The shopping pass filled it,
    // came round, found the same affordable crate and clicked it again: a loop
    // that spends nothing, never reports itself finished, and so never
    // reincarnates. Which is exactly what the run did.
    const state = await pump(
        ascender({ chips: 1000, permanentChoices: [{ id: 91, name: 'Kitten helpers' }] })
    )
    assert.equal(state.permanent, 'Kitten helpers')
    // The slot is opened twice and no more: once when it is bought, and once by the
    // reassignment pass that runs after shopping is finished, which finds nothing
    // better on offer and cancels straight out. The bug this guards against is
    // unbounded, so the count is what matters.
    const pickers = state.log.filter(l => l.indexOf('picker ') === 0)
    assert.equal(pickers.length, 2, `opened the slot picker ${pickers.length} times`)
    assert.equal(
        state.log.filter(l => l.indexOf('RECLICK') === 0).length,
        1,
        'and the owned crate is clicked once, deliberately, not in a loop'
    )
    assert.ok(state.log.indexOf('reincarnated') !== -1, 'never got to Reincarnate')
})

test('an upgrade already owned is left alone entirely', async () => {
    // bought crates stay on the tree carrying `enabled`. Clicking one is a wasted
    // click at best and, for anything with an activateFunction, a loop.
    const h = ascender({ chips: 20 })
    h.game.state.heavenlyBought.push('Legacy')
    h.game.drawTree()
    const state = await pump(h)
    assert.deepEqual(
        state.log.filter(l => l.indexOf('RECLICK') === 0),
        []
    )
    assert.equal(state.log.filter(l => l === 'heavenly Legacy').length, 0, 'bought it twice')
    // and the ones behind it still get bought
    assert.ok(state.heavenlyBought.indexOf('Heavenly cookies') !== -1)
})

test('the dearest kitten on offer takes the slot', async () => {
    // kitten tiers are three orders of magnitude apart, so the price the crate's
    // own tooltip quotes ranks them without a table to keep in step with the game
    const state = await pump(
        ascender({
            chips: 1000,
            permanentChoices: [
                { id: 90, name: 'Kitten helpers', price: 9e6 },
                { id: 91, name: 'Kitten admins', price: 9e47 },
                { id: 92, name: 'Kitten experts', price: 9e29 },
                { id: 93, name: 'Plastic mouse', price: 50000 }
            ]
        })
    )
    assert.equal(state.permanent, 'Kitten admins')
})

test('a kitten the pick list has never heard of still wins on price', async () => {
    // the list cannot stay ahead of the game; the price can
    const state = await pump(
        ascender({
            chips: 1000,
            permanentChoices: [
                { id: 90, name: 'Kitten experts', price: 9e29 },
                { id: 91, name: 'Kitten researchers', price: 9e53 }
            ]
        })
    )
    assert.equal(state.permanent, 'Kitten researchers')
})

test('with no prices to compare, the named order decides', async () => {
    const state = await pump(
        ascender({
            chips: 1000,
            permanentChoices: [
                { id: 90, name: 'Kitten helpers' },
                { id: 91, name: 'Kitten managers' }
            ]
        })
    )
    assert.equal(state.permanent, 'Kitten managers')
})

test('a permanent slot with nothing worth taking is left empty', async () => {
    const state = await pump(
        ascender({ chips: 1000, permanentChoices: [{ id: 90, name: 'Forwards from grandma' }] })
    )
    assert.equal(state.permanent, null)
    // and the run still finishes
    assert.ok(state.log.indexOf('reincarnated') !== -1)
})

test('crate names are cached so a second ascension costs no hovers', async () => {
    const disk = {}
    const first = boot({
        save: ascendSave({ earned: S.cookiesFor(365) }),
        game: { chips: 13, heavenly: TREE },
        disk
    })
    await pump(first)
    await first.A.store.flush()

    const cached = disk['legacy:t'].heavenlyNames
    assert.equal(cached.version, '2.052')
    assert.equal(cached.names['1'], 'legacy')

    const second = boot({
        save: ascendSave({ earned: S.cookiesFor(365) }),
        game: { chips: 13, heavenly: TREE },
        disk
    })
    await second.A.store.ready('t')
    const before = second.A.catalog.stats().hovers
    await pump(second)
    assert.equal(second.A.catalog.stats().hovers, before, 'named every crate from the cache')
})

//! Confirming the wrong prompt

test('a prompt we did not open is never confirmed', async () => {
    const h = ascender()
    await h.A.store.ready('t')
    const mod = h.A.registry.get('ascend')
    await mod.setup()

    // get as far as waiting on the ascend prompt, then put a different one up
    await mod.tick()
    await mod.tick()
    assert.equal(h.A.ascend.state().phase, 'ascending')
    h.game.closePrompt()
    h.game.prompt('ReallyWipeSave', [['Delete', () => h.game.state.log.push('WIPED')]])

    await mod.tick()
    await mod.tick()
    assert.equal(h.game.state.log.indexOf('WIPED'), -1, 'confirmed a prompt it did not open')
})

test('the confirm helper refuses a prompt it cannot name', () => {
    const h = ascender()
    h.game.prompt('ReallyWipeSave', [['Delete', () => h.game.state.log.push('WIPED')]])
    assert.equal(h.A.act.ascend.promptIs('ascend'), false)
    assert.equal(h.A.act.ascend.confirmPrompt('ascend'), false)
    assert.equal(h.game.state.log.indexOf('WIPED'), -1)
})

test('the ascension screen is recognised from the game class list', () => {
    const h = ascender()
    assert.equal(h.A.act.ascend.screen(), 'playing')
    h.game.setMode('ascendIntro')
    assert.equal(h.A.act.ascend.animating(), true)
    assert.equal(h.A.act.ascend.onAscendScreen(), false)
    h.game.setMode('ascending')
    assert.equal(h.A.act.ascend.onAscendScreen(), true)
    assert.equal(h.A.act.ascend.animating(), false)
})

test('nothing is clicked while the ascend animation is running', async () => {
    const h = ascender()
    await h.A.store.ready('t')
    const mod = h.A.registry.get('ascend')
    await mod.setup()
    await mod.tick()
    h.game.closePrompt()
    h.game.setMode('ascendIntro')
    const before = h.game.state.log.length
    await mod.tick()
    await mod.tick()
    assert.equal(h.game.state.log.length, before, 'acted during the animation')
})

//! Buff measurement

test('a buff is identified from its tooltip, since it renders no text', async () => {
    const h = boot({})
    await h.A.store.ready('t')
    h.game.gainBuff('Frenzy', 0)
    // nothing readable without the hover: this is the bug this file exists for
    assert.equal(h.A.buffs.active()[0].name, null)
    assert.equal(h.A.buffs.hasProductionBuff(), false)

    await h.A.registry.get('buffs').tick()
    assert.equal(h.A.buffs.active()[0].name, 'Frenzy')
    assert.equal(h.A.buffs.hasProductionBuff(), true)
    // and the old entry point now answers correctly too
    assert.equal(h.A.live.hasProductionBuff(), true)
})

test('time left comes out of the pie timer sprite offset', async () => {
    const h = boot({})
    await h.A.store.ready('t')
    h.game.gainBuff('Loan 2', 0)
    await h.A.registry.get('buffs').tick()

    const window = /^loan 2$/i
    // a forty second buff, freshly taken
    assert.ok(Math.abs(h.A.buffs.remaining(window, 40) - 40) < 0.5)

    h.game.progressBuff('Loan 2', 0.5)
    assert.ok(Math.abs(h.A.buffs.remaining(window, 40) - 20) < 0.5)

    h.game.progressBuff('Loan 2', 0.9)
    assert.ok(Math.abs(h.A.buffs.remaining(window, 40) - 4) < 0.5)
})

test('a buff that is not running reads as unknown, not as zero', async () => {
    const h = boot({})
    await h.A.store.ready('t')
    assert.ok(Number.isNaN(h.A.buffs.remaining(/^loan 2$/i, 40)))
})

test('a loan and its interest are told apart', async () => {
    const h = boot({})
    await h.A.store.ready('t')
    const L = h.A.data.loans
    h.game.gainBuff('Loan 2 (interest)', 0)
    await h.A.registry.get('buffs').tick()
    assert.equal(h.A.buffs.named(L.buffPattern(2)).length, 0)
    assert.equal(h.A.buffs.named(L.interestPattern(2)).length, 1)
})

//! Loans before ascending

function banker(opts = {}) {
    return boot({
        save: ascendSave({ earned: S.cookiesFor(365) }),
        game: {
            chips: 13,
            heavenly: TREE,
            officeLevel: opts.officeLevel != null ? opts.officeLevel : 5,
            loanProgress: opts.loanProgress != null ? opts.loanProgress : 0
        }
    })
}

//* turn
// tick the planner n times, naming any new buffs in between, which is what the
// buffs module does on its own schedule in a real page
async function turn(h, n) {
    const planner = h.A.registry.get('ascend')
    const namer = h.A.registry.get('buffs')
    for (let i = 0; i < n; i++) {
        await namer.tick()
        await planner.tick()
    }
}

test('a running production buff holds the ascension back', async () => {
    const h = banker()
    await h.A.store.ready('t')
    await h.A.registry.get('ascend').setup()
    h.game.gainBuff('Frenzy', 0.1)

    await turn(h, 6)
    assert.equal(h.A.ascend.state().phase, 'ready', 'left in the middle of a frenzy')
    assert.equal(h.game.state.loansTaken.length, 0)

    // once it is gone the sequence starts
    h.game.loseBuff('Frenzy')
    await turn(h, 6)
    assert.ok(h.game.state.loansTaken.length > 0)
})

test('every loan slot on offer is taken, shortest window last', async () => {
    const h = banker()
    await h.A.store.ready('t')
    await h.A.registry.get('ascend').setup()
    await turn(h, 8)
    // 1 and 3 run for hours, 2 for forty seconds: it goes last so the window the
    // ascension has to fit inside is as wide as possible
    assert.deepEqual(h.game.state.loansTaken, [1, 3, 2])
})

test('a bank too small for loan slots ascends without them', async () => {
    const h = banker({ officeLevel: 1 })
    await h.A.store.ready('t')
    await h.A.registry.get('ascend').setup()
    await turn(h, 6)
    assert.deepEqual(h.game.state.loansTaken, [])
    assert.ok(h.game.state.log.indexOf('prompt Ascend') !== -1)
})

test('the ascension waits while the loan window is still wide', async () => {
    const h = banker()
    await h.A.store.ready('t')
    await h.A.registry.get('ascend').setup()
    await turn(h, 8)
    assert.equal(h.A.ascend.state().phase, 'harvest')
    // forty seconds of x2 production is the whole reason for taking it
    await turn(h, 10)
    assert.equal(h.A.ascend.state().phase, 'harvest', 'left before collecting the boost')
    assert.equal(h.game.state.log.indexOf('prompt Ascend'), -1)
})

test('the ascension happens inside the loan window, before the interest', async () => {
    const h = banker()
    await h.A.store.ready('t')
    await h.A.registry.get('ascend').setup()
    await turn(h, 8)
    assert.equal(h.A.ascend.state().phase, 'harvest')

    // walk the forty second window down to its last few seconds
    h.game.progressBuff('Loan 2', 0.8)
    await turn(h, 3)
    assert.ok(h.game.state.log.indexOf('prompt Ascend') !== -1, 'missed the window')
    // and it left while the boost was still running
    assert.equal(h.A.buffs.named(/^loan 2$/i).length, 1)
})

test('an interest phase that has already started is left immediately', async () => {
    const h = banker()
    await h.A.store.ready('t')
    await h.A.registry.get('ascend').setup()
    await turn(h, 8)
    assert.equal(h.A.ascend.state().phase, 'harvest')

    // the boost expired and the penalty began before we got out
    h.game.loseBuff('Loan 2')
    h.game.gainBuff('Loan 2 (interest)', 0)
    await turn(h, 3)
    assert.ok(h.game.state.log.indexOf('prompt Ascend') !== -1, 'sat under the penalty')
})

test('loans are only ever taken by the ascension sequence', async () => {
    // a run nowhere near its target must never touch a loan slot, because outside
    // the pre-ascension window the penalty is bigger than the boost
    const h = boot({
        save: ascendSave({ earned: S.cookiesFor(10) }),
        game: { officeLevel: 5 }
    })
    await h.A.store.ready('t')
    await h.A.scheduler.start()
    await sleep(300)
    h.A.scheduler.stop()
    assert.deepEqual(h.game.state.loansTaken, [])
})

test('the loan table matches the game', () => {
    const L = boot({}).A.data.loans
    assert.equal(L.byId(2).boostSeconds, 0.67 * 60)
    assert.equal(L.byId(2).multiplier, 2)
    assert.equal(L.SHORTEST, 2)
    assert.deepEqual(L.ORDER, [1, 3, 2])
    // taking all three at once triples production and a bit
    assert.ok(Math.abs(L.stackedMultiplier([1, 2, 3]) - 3.6) < 1e-9)
})

test('the panel reports the wrinkler hoard the ascension is about to lose', async () => {
    const h = boot({
        save: fx.save({
            cookiesEarned: S.cookiesFor(365),
            wrinklers: 8,
            wrinklerHoard: 5e15
        }).raw,
        game: { chips: 1, heavenly: TREE }
    })
    await h.A.store.ready('t')
    await h.A.registry.get('wrinklers').tick()
    await h.A.registry.get('ascend').setup()
    await h.A.registry.get('ascend').tick()
    assert.equal(h.debug().ascend.wrinklerHoard, 5e15)
})

test('a buff that has not been identified yet also holds the sequence back', async () => {
    // naming costs a hover and happens one buff per tick, so for a moment a live
    // frenzy is on screen with no name on it. Reading that as "nothing running"
    // is how the sequence would start half a second into a frenzy.
    const h = banker()
    await h.A.store.ready('t')
    const planner = h.A.registry.get('ascend')
    await planner.setup()
    h.game.gainBuff('Frenzy', 0.1)

    // planner ticks only: the buffs module never gets a chance to name it
    for (let i = 0; i < 6; i++) await planner.tick()
    assert.equal(h.game.state.loansTaken.length, 0, 'acted on a buff it could not name')
    assert.equal(h.A.ascend.state().phase, 'ready')
})

//! Reassigning permanent slots
// A slot is not a decision made once: the game reopens its picker whenever the
// crate is clicked, owned or not, and the run that just ended nearly always owns a
// stronger kitten than the run that filled the slot did.

const OWNED_SLOT = { heavenlyBought: ['Legacy', 'Permanent upgrade slot I'] }

test('a slot holding a weaker kitten is reassigned at the next ascension', async () => {
    const state = await pump(
        ascender({
            ...OWNED_SLOT,
            chips: 1000,
            permanents: { 'Permanent upgrade slot I': 'Kitten helpers' },
            permanentSlots: [90, -1, -1, -1, -1],
            permanentChoices: [
                { id: 91, name: 'Kitten admins', price: 9e47 },
                { id: 92, name: 'Kitten experts', price: 9e29 }
            ]
        })
    )
    assert.equal(state.permanents['Permanent upgrade slot I'], 'Kitten admins')
    assert.ok(state.log.indexOf('reincarnated') !== -1, 'and the run still ends')
})

test('a slot already holding the best thing on the save is left alone', async () => {
    // the game never lists a slot's own occupant, so without checking what is in
    // there this would take the best of what is left and swap the strongest kitten
    // out for the second strongest
    const state = await pump(
        ascender({
            ...OWNED_SLOT,
            chips: 1000,
            permanents: { 'Permanent upgrade slot I': 'Kitten admins' },
            permanentSlots: [91, -1, -1, -1, -1],
            permanentChoices: [
                { id: 90, name: 'Kitten helpers', price: 9e6 },
                { id: 92, name: 'Kitten experts', price: 9e29 }
            ]
        })
    )
    assert.equal(state.permanents['Permanent upgrade slot I'], 'Kitten admins')
    assert.ok(state.log.indexOf('reincarnated') !== -1)
})

test('an ordinary owned upgrade is never clicked while looking for slots', async () => {
    const state = await pump(
        ascender({
            heavenlyBought: ['Legacy', 'Heavenly cookies', 'Permanent upgrade slot I'],
            chips: 1000,
            permanents: { 'Permanent upgrade slot I': 'Kitten helpers' },
            permanentSlots: [90, -1, -1, -1, -1],
            permanentChoices: [{ id: 91, name: 'Kitten admins', price: 9e47 }]
        })
    )
    assert.equal(state.log.indexOf('RECLICK Heavenly cookies'), -1)
    assert.ok(state.log.indexOf('RECLICK Permanent upgrade slot I') !== -1)
})

test('a slot holding something unrecognised is left exactly as it is', async () => {
    // an upgrade this version has never heard of is likelier to be newer than worse
    const state = await pump(
        ascender({
            ...OWNED_SLOT,
            chips: 1000,
            permanents: { 'Permanent upgrade slot I': 'Kitten quantum theorists' },
            permanentSlots: [95, -1, -1, -1, -1],
            permanentChoices: [{ id: 90, name: 'Kitten helpers', price: 9e6 }]
        })
    )
    assert.equal(state.permanents['Permanent upgrade slot I'], 'Kitten quantum theorists')
    assert.equal(state.log.indexOf('RECLICK Permanent upgrade slot I'), -1, 'not even opened')
})

test('an owned slot the save calls empty is filled rather than skipped', async () => {
    const state = await pump(
        ascender({
            ...OWNED_SLOT,
            chips: 1000,
            permanentSlots: [-1, -1, -1, -1, -1],
            permanentChoices: [{ id: 91, name: 'Kitten admins', price: 9e47 }]
        })
    )
    assert.equal(state.permanents['Permanent upgrade slot I'], 'Kitten admins')
})
