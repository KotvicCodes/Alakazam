// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Ascension Arithmetic
    // Pure functions over the save's scalars: how much prestige a pile of cookies
    // is worth, what ascending right now would pay, and whether it is time. Nothing
    // here touches the DOM or clicks anything, so the "should we throw the run
    // away" question is decidable in a unit test rather than only in a real game.
    //
    // The whole thing rests on one formula, which is the game's own:
    //
    //   prestige = floor((cookies / 1e12) ^ (1/3))
    //
    // Two consequences fall out of the cube root and both matter.
    //
    // Doubling your prestige level takes eight times the cookies. That is why the
    // guide's ascension targets climb so steeply, and why "ascend when you can
    // double" is a sane rule rather than an impatient one: below that, you are
    // handing back a whole run for a handful of chips.
    //
    // The cookies that count are `cookiesReset`, the all-time total across every
    // run. Ascending folds this run's `cookiesEarned` into it. So the projection is
    // exactly "what would prestige be if that addition happened now", and the chips
    // it pays are the difference. Nothing is estimated.

    const { CUMULATIVE } = window.Alakazam.data.heavenly

    // the divisor in the game's own prestige formula
    const COOKIES_PER_CHIP_BASE = 1e12

    // the exponent. the game calls it HCfactor and it is 3 in an ordinary run.
    const HC_FACTOR = 3

    //* root
    // The game writes the formula as Math.pow(c / 1e12, 1 / 3), and at this exponent
    // that is not quite exact: Math.pow(1000, 1/3) is 9.999999999999998, which a
    // floor turns into 9. The game has the same wart and nobody notices, because a
    // real cookie total is never an exact cube.
    //
    // Math.cbrt evaluates the same function without the error, so it is used here.
    // It only ever differs from the game by a single chip, only on an exact cube,
    // and only in our favour. Worth it for arithmetic that has to be testable
    // against round numbers.
    function root(value) {
        return HC_FACTOR === 3 ? Math.cbrt(value) : Math.pow(value, 1 / HC_FACTOR)
    }

    // past the end of the guide's table, fall back to its own rule of thumb: ascend
    // when the run would roughly double the prestige level you already have
    const DOUBLING = 2

    //* prestigeFor
    // the prestige level a lifetime cookie total is worth. floored, because the
    // game only ever grants whole levels and a fraction of a chip buys nothing.
    function prestigeFor(cookies) {
        if (!Number.isFinite(cookies) || cookies <= 0) return 0
        return Math.floor(root(cookies / COOKIES_PER_CHIP_BASE))
    }

    //* cookiesFor
    // the inverse: how many lifetime cookies a prestige level needs. used to say
    // how far off a target is in a unit anyone can read.
    function cookiesFor(prestige) {
        if (!Number.isFinite(prestige) || prestige <= 0) return 0
        return Math.pow(prestige, HC_FACTOR) * COOKIES_PER_CHIP_BASE
    }

    //* projected
    // what ascending right now would do. `prestige` is the level afterwards and
    // `chipsGained` is what lands in the bank to spend on the ascend screen.
    //
    // The current level is recomputed from cookiesReset rather than read from the
    // save's own `prestige` field. They agree in an ordinary run, but the save
    // field is written at load time and the two drift apart in challenge runs,
    // where the difference would show up as chips that never arrive.
    function projected(scalars) {
        const reset = number(scalars && scalars.cookiesReset)
        const earned = number(scalars && scalars.cookiesEarned)
        const current = prestigeFor(reset)
        const after = prestigeFor(reset + earned)
        return {
            current,
            prestige: after,
            chipsGained: Math.max(0, after - current)
        }
    }

    //! stillToBuy
    // How many heavenly chips the plan is still waiting for.
    //
    // This is the whole of the "when" question, and it used to be asked in the
    // wrong currency. The plan was read as a ladder of prestige levels and the
    // target was the next rung above the save, which ignores two things that are
    // always true by the time an ascension comes round.
    //
    // A run does not stop the moment the target is met. It waits out whatever
    // boost is running, takes three loans and earns under them, so it arrives on
    // the ascension screen with more chips than the entry asked for. The shopping
    // pass spends the surplus on the next entry's list, which is the guide's own
    // advice. So the next ascension does not need a whole entry's worth again: it
    // needs what is left of the plan.
    //
    // And chips that were not spent stay banked. A run that came up short of an
    // expensive centrepiece carries the difference forward, and asking it to earn
    // the full price a second time is asking for chips it already has.
    //
    // Both are answered by the same two numbers, and the save carries both.
    // heavenlyChipsSpent is exactly how far down the plan the purchases have got,
    // because Alakazam never buys anything off it; heavenlyChips is the rest.
    //
    // Returns null once the entire plan has been bought, which is the caller's
    // signal to fall back on the doubling rule.
    //
    // The one thing that can mislead it is chips spent off-plan by hand, which
    // read as progress they did not buy. The result is ascending a little early
    // with the difference still to earn, which the next pass simply asks for
    // again.
    function stillToBuy(chipsSpent) {
        const spent = number(chipsSpent)
        for (const total of CUMULATIVE) {
            if (total > spent) return total - spent
        }
        return null
    }

    //! worthAscending
    // The decision, and the only place the two rules live.
    //
    // Inside the guide's table the question is whether ascending now would put
    // enough chips in hand to buy what the plan still wants. That is better than a
    // rule about prestige levels because the table is not a smooth curve: it is
    // shaped around what each tier of heavenly upgrades costs, so stopping short of
    // an entry means ascending for chips that cannot buy the thing the entry exists
    // to buy. It is also the only form of the question that a save part way through
    // a tier, or sitting on unspent chips, can answer correctly.
    //
    // Past the table the doubling rule takes over, because there is nothing left to
    // aim at and the cube root makes "twice the level" the only scale-free answer.
    //
    // Either way nothing happens without at least one chip: ascending for zero
    // chips is strictly a loss, and early in the very first run that is the case
    // for a long time.
    function worthAscending(scalars) {
        const p = projected(scalars)
        const banked = number(scalars && scalars.heavenlyChips)
        const needed = stillToBuy(scalars && scalars.heavenlyChipsSpent)
        const earned = p.chipsGained >= 1

        if (needed === null) {
            const ready = earned && p.prestige >= p.current * DOUBLING
            return {
                ...p,
                target: null,
                chipsNeeded: 0,
                chipsShort: 0,
                ready,
                why: !earned
                    ? 'no chips yet'
                    : ready
                      ? 'the whole plan is bought, and this would double prestige'
                      : 'the whole plan is bought, saving for double'
            }
        }

        // chips the plan wants that the bank cannot already cover, and so the
        // prestige level that has to be reached: a level is a chip
        const short = Math.max(0, needed - banked)
        const target = p.current + short
        const ready = earned && p.prestige >= target

        return {
            ...p,
            target,
            chipsNeeded: needed,
            chipsShort: short,
            ready,
            why: !earned
                ? 'no chips yet'
                : ready
                  ? `the plan's next ${Math.round(needed)} chips are covered`
                  : `saving for ${Math.round(needed)} chips, ${Math.round(banked + p.chipsGained)} so far`
        }
    }

    function number(value) {
        return Number.isFinite(value) ? value : 0
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.strategy = window.Alakazam.strategy || {}
    window.Alakazam.strategy.ascend = {
        prestigeFor,
        cookiesFor,
        projected,
        stillToBuy,
        worthAscending,
        HC_FACTOR,
        DOUBLING
    }
})()
