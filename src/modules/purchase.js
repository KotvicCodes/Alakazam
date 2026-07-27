// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Purchasing
    // Measure the store, ask the strategy engine what to buy, buy it.
    //
    // This is still the original one-purchase-per-cycle loop, moved onto the
    // scheduler unchanged so that this commit is a pure refactor. The interval is
    // effectively a floor rather than a cadence: snapshot() sweeps every building
    // and upgrade tooltip, so a cycle mid-game takes several seconds. Splitting
    // that measurement apart and draining purchases in a loop is the next commit.

    const { simulateClick } = window.Alakazam.input
    const { snapshot } = window.Alakazam.measure
    const { decide } = window.Alakazam.strategy
    const { registry } = window.Alakazam

    const INTERVAL_MS = 2000

    async function tick() {
        const snap = await snapshot()
        // expose the latest measurement for inspection in the console
        window.__alakazam.snapshot = snap

        const decision = decide(snap)
        if (decision.action === 'buyUpgrade' || decision.action === 'buyBuilding') {
            simulateClick(decision.target.element)
        }
        window.__alakazam.decision = decision
        logSnapshot(snap, decision)
    }

    //* logSnapshot
    // one compact structured line per cycle so the measured data is inspectable
    function logSnapshot(snap, decision) {
        console.log('Alakazam', {
            cookies: snap.cookies,
            cps: snap.cps,
            buildings: snap.buildings.length,
            upgrades: snap.upgrades.length,
            shimmers: snap.shimmers.length,
            decision: `${decision.action}: ${decision.reason}`
        })
    }

    registry.register({ name: 'purchase', interval: INTERVAL_MS, tick })
})()
