// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Local Strategy Engine
    // Pure functions over a view of the store: given what we measured, decide the
    // single best next purchase and how many of it to buy. Nothing here touches
    // the DOM; it returns a decision and the purchase module executes it through
    // the fair-play input layer. Keeping this pure and separate is what lets
    // smarter scorers (buff timing, ascension) slot in later.

    const { PRICE_GROWTH } = window.Alakazam.data.buildings

    //* paybackSeconds
    // how long the thing takes to pay for itself: price divided by the cookies per
    // second it adds. lower is better. returns Infinity when it cannot be scored.
    function paybackSeconds(price, deltaCps) {
        if (!Number.isFinite(price) || !Number.isFinite(deltaCps) || deltaCps <= 0) {
            return Infinity
        }
        return price / deltaCps
    }

    //* rankBuildings
    // scores every building we could eventually buy by payback, best first. a
    // building with no readable per-unit CpS (Infinity payback) sorts to the back.
    function rankBuildings(buildings) {
        return buildings
            .map(b => {
                // prefer the exact tooltip figure; before a building is owned that
                // is NaN, so fall back to its published base production
                const cps = Number.isFinite(b.perUnitCps) && b.perUnitCps > 0 ? b.perUnitCps : b.baseCps
                return { ...b, scoredCps: cps, payback: paybackSeconds(b.price, cps) }
            })
            .sort((a, b) => a.payback - b.payback)
    }

    //* sumPrice
    // total cost of buying `count` units, as a geometric series over the 15% per
    // unit price growth. kept here as well as in act/store so this file stays pure
    // and independently testable.
    function sumPrice(nextUnitPrice, count) {
        if (!Number.isFinite(nextUnitPrice) || count <= 0) return Infinity
        if (count === 1) return nextUnitPrice
        return (nextUnitPrice * (Math.pow(PRICE_GROWTH, count) - 1)) / (PRICE_GROWTH - 1)
    }

    // buying a batch that costs no more than this share of the bank is treated as
    // spending pocket change: see the second rule in chooseAmount
    const SURPLUS_SHARE = 0.05

    //! chooseAmount
    // How many to buy in one go. Two rules, and the larger one wins.
    //
    // Rule one, efficiency. Buying one at a time always has the best payback,
    // because each unit costs 15% more than the last. So the question is not "is
    // bulk cheaper" (it never is) but "how many would a one-at-a-time loop have
    // bought before something else became the better target". Buying exactly that
    // many in one click gives an identical outcome far quicker. That count is
    // where this building's payback would overtake the runner-up:
    //
    //   price * 1.15^n / cps <= runnerUpPayback
    //   n <= log(runnerUpPayback * cps / price) / log(1.15)
    //
    // Rule two, surplus. In practice buildings stay tightly ranked, so rule one
    // almost always says one and the extension spends the whole game clicking
    // singles. That is the wrong trade once the bank dwarfs the purchase: every
    // single costs a click and a redraw wait, so converting a big bank into
    // buildings one at a time wastes far more in elapsed time than the few percent
    // of ordering efficiency it protects. When a batch costs under a twentieth of
    // the bank, take the batch.
    //
    // Both rules are capped by what is actually affordable and snapped down to a
    // size the store offers.
    function chooseAmount(best, runnerUpPayback, bank) {
        const offered = [100, 10, 1]
        if (!Number.isFinite(best.scoredCps) || best.scoredCps <= 0) return 1

        let efficient = Infinity
        if (Number.isFinite(runnerUpPayback) && runnerUpPayback > 0) {
            const ratio = (runnerUpPayback * best.scoredCps) / best.price
            // ratio <= 1 means the runner-up is already at least as good: buy one
            // and re-evaluate rather than committing to a batch
            efficient = ratio <= 1 ? 1 : Math.floor(Math.log(ratio) / Math.log(PRICE_GROWTH))
        }

        for (const n of offered) {
            const cost = sumPrice(best.price, n)
            if (cost > bank) continue
            if (n <= efficient || cost <= bank * SURPLUS_SHARE) return n
        }
        return 1
    }

    //! decide
    // priority order, matching the project's established intent:
    //   1. buy the cheapest affordable ordinary upgrade (upgrades dominate ROI)
    //   2. otherwise target the best-payback building: buy as many as stay the
    //      best choice, else wait and let cookies accumulate rather than wasting
    //      them on a worse building
    // returns { action, target, amount, reason } where target carries the element.
    function decide(view) {
        // 1) upgrades first
        const buyableUpgrades = view.upgrades
            .filter(u => u.kind === 'buy' && u.affordable)
            .sort((a, b) => a.price - b.price)

        if (buyableUpgrades.length > 0) {
            const u = buyableUpgrades[0]
            return { action: 'buyUpgrade', target: u, amount: 1, reason: `cheapest upgrade: ${u.name}` }
        }

        // 2) best building by payback
        const ranked = rankBuildings(view.buildings).filter(b => b.payback !== Infinity)
        if (ranked.length === 0) {
            return { action: 'none', target: null, amount: 0, reason: 'no scorable building' }
        }

        const best = ranked[0]
        if (best.affordable) {
            const runnerUp = ranked.length > 1 ? ranked[1].payback : Infinity
            const amount = chooseAmount(best, runnerUp, view.cookies)
            return {
                action: 'buyBuilding',
                target: best,
                amount,
                reason: `best payback ${best.name} x${amount} (${best.payback.toFixed(1)}s)`
            }
        }

        // save up for the best building instead of buying a worse affordable one
        return {
            action: 'wait',
            target: best,
            amount: 0,
            reason: `saving for ${best.name} (payback ${best.payback.toFixed(1)}s)`
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.strategy = { decide, rankBuildings, paybackSeconds, chooseAmount, sumPrice }
})()
