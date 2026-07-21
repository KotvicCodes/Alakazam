// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
//! Local Strategy Engine
// Pure functions over a snapshot(): given what we measured, decide the single
// best next purchase. Nothing here touches the DOM; it returns a decision and
// main.js executes it through the fair-play input layer. Keeping this pure and
// separate is what lets smarter scorers (buff timing, ascension) slot in later.

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
            // prefer the exact tooltip figure; before a building is owned that is
            // NaN, so fall back to its published base production
            const cps = Number.isFinite(b.perUnitCps) && b.perUnitCps > 0 ? b.perUnitCps : b.baseCps
            return { ...b, scoredCps: cps, payback: paybackSeconds(b.price, cps) }
        })
        .sort((a, b) => a.payback - b.payback)
}

//! decide
// priority order, matching the project's established intent:
//   1. buy the cheapest affordable ordinary upgrade (upgrades dominate ROI)
//   2. otherwise target the best-payback building: buy it if affordable, else
//      wait and let cookies accumulate rather than wasting them on a worse one
// returns { action, target, reason } where target carries the element to click.
function decide(snap) {
    // 1) upgrades first
    const buyableUpgrades = snap.upgrades
        .filter(u => u.kind === 'buy' && u.affordable)
        .sort((a, b) => a.price - b.price)

    if (buyableUpgrades.length > 0) {
        const u = buyableUpgrades[0]
        return { action: 'buyUpgrade', target: u, reason: `cheapest upgrade: ${u.name}` }
    }

    // 2) best building by payback
    const ranked = rankBuildings(snap.buildings).filter(b => b.payback !== Infinity)
    if (ranked.length === 0) {
        return { action: 'none', target: null, reason: 'no scorable building' }
    }

    const best = ranked[0]
    if (best.affordable) {
        return {
            action: 'buyBuilding',
            target: best,
            reason: `best payback ${best.name} (${best.payback.toFixed(1)}s)`
        }
    }

    // save up for the best building instead of buying a worse affordable one
    return {
        action: 'wait',
        target: best,
        reason: `saving for ${best.name} (payback ${best.payback.toFixed(1)}s)`
    }
}

window.Alakazam = window.Alakazam || {}
window.Alakazam.strategy = { decide, rankBuildings, paybackSeconds }
})()
