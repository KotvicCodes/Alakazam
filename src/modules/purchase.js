// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Purchasing
    // Build a view of what is buyable, ask the strategy engine for the single best
    // purchase, execute it.
    //
    // The view is assembled from three sources with very different costs, and the
    // whole point of the split is that only the cheap one is on this path:
    //   - measure/live.js  every tick, sub-millisecond: bank, CpS, prices
    //   - measure/catalog  whatever the tooltip rotation has managed to read
    //   - measure/save     owned counts, exact and free
    //
    // Because nothing here waits on a tooltip, this runs several times a second
    // instead of once every several seconds, and the price it decides against is
    // the price on screen right now.

    const { simulateClick } = window.Alakazam.input
    const { decide } = window.Alakazam.strategy
    const { live, catalog, save, registry } = window.Alakazam
    const { BASE_PRODUCTION } = window.Alakazam.data.buildings

    const INTERVAL_MS = 250

    //* buildView
    // the shape the strategy engine scores: one entry per buildable thing, with
    // whatever production figure we have for it and whether it is affordable now.
    function buildView() {
        const globals = live.readGlobals()
        const bank = globals.cookies

        const buildings = live.readProducts().map(p => {
            const record = save.building(p.index)
            // the save knows the exact count; the rendered count is the fallback
            const owned = record ? record.amount : p.owned
            return {
                index: p.index,
                name: p.name,
                price: p.price,
                owned,
                perUnitCps: catalog.buildingCps(p.index),
                baseCps: BASE_PRODUCTION[p.name.toLowerCase()],
                affordable: bank >= p.price,
                element: p.element
            }
        })

        // a crate the tooltip rotation has not reached yet is simply not a
        // candidate this tick; it will be within a few seconds
        const upgrades = []
        for (const crate of live.readUpgradeCrates()) {
            const known = catalog.upgradeFor(crate.key)
            if (!known) continue
            upgrades.push({
                key: crate.key,
                name: known.name,
                price: known.price,
                kind: known.kind,
                description: known.description,
                affordable: bank >= known.price,
                element: crate.element
            })
        }

        return { timestamp: Date.now(), ...globals, buildings, upgrades }
    }

    function tick() {
        const view = buildView()
        const decision = decide(view)

        if (decision.action === 'buyUpgrade' || decision.action === 'buyBuilding') {
            simulateClick(decision.target.element)
        }

        window.__alakazam.view = view
        window.__alakazam.decision = decision
        logOccasionally(view, decision)
    }

    //* logOccasionally
    // one compact line every few seconds. the tick is far too fast to log every
    // pass, and the interesting event is the decision changing, not its repetition.
    let lastLoggedReason = ''
    let lastLoggedAt = 0

    function logOccasionally(view, decision) {
        const now = Date.now()
        const changed = decision.reason !== lastLoggedReason
        if (!changed && now - lastLoggedAt < 5000) return
        lastLoggedReason = decision.reason
        lastLoggedAt = now
        console.log('Alakazam', {
            cookies: view.cookies,
            cps: view.cps,
            buildings: view.buildings.length,
            upgrades: view.upgrades.length,
            catalog: catalog.stats(),
            decision: `${decision.action}: ${decision.reason}`
        })
    }

    registry.register({ name: 'purchase', interval: INTERVAL_MS, tick })

    window.Alakazam.purchase = { buildView }
})()
