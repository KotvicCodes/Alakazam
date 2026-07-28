// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Purchasing
    // Build a view of what is buyable, ask the strategy engine for the best next
    // purchase, execute it, then do it again until there is nothing worth buying.
    //
    // That drain loop is the point. The old version made exactly one purchase per
    // cycle and its cycle took seconds, so cookies piled up unspent. Now a tick
    // keeps buying while the strategy still says buy, bounded by three things:
    //
    //   - the scheduler's click budget, so one module cannot hog the frame
    //   - a time slice, so a long drain cannot stall the next tick
    //   - a projected balance, tracked locally because the game redraws its cookie
    //     counter on its own loop and would otherwise report a stale bank
    //
    // The view is assembled from three sources with very different costs, and only
    // the cheap one is on this path:
    //   - measure/live.js  every pass, sub-millisecond: bank, CpS, prices
    //   - measure/catalog  whatever the tooltip rotation has read so far
    //   - measure/save     owned counts, exact and free

    const { simulateClick } = window.Alakazam.input
    const { decide, sumPrice } = window.Alakazam.strategy
    const { live, catalog, save, registry, act, clicks } = window.Alakazam
    const { BASE_PRODUCTION } = window.Alakazam.data.buildings

    const INTERVAL_MS = 250
    const SLICE_MS = 150 // never spend longer than this in one drain
    const MAX_ACTIONS = 12 // and never more purchases than this either

    // the game rebuilds the store on its draw loop rather than on purchase, so
    // give it a frame before re-reading prices that a purchase just changed
    const REDRAW_MS = 35

    let bought = 0

    //* buildView
    // the shape the strategy engine scores. `bank` is passed in so the drain loop
    // can score against what it knows it has left rather than what the counter on
    // screen has got round to showing.
    function buildView(bank) {
        const globals = live.readGlobals()
        const balance = Number.isFinite(bank) ? Math.min(bank, globals.cookies) : globals.cookies

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
                affordable: balance >= p.price,
                element: p.element
            }
        })

        // a crate the tooltip rotation has not reached yet is simply not a
        // candidate this pass; it will be within a few seconds
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
                affordable: balance >= known.price,
                element: crate.element
            })
        }

        return {
            timestamp: Date.now(),
            ...globals,
            cookies: balance,
            // passive production is what the game shows; clicking is measured on
            // top of it, and click upgrades are scored against that
            clickCps: clicks.clickCps(),
            // the rate the game registers, not the rate we dispatch
            clicksPerSecond: clicks.clicksPerSecond(),
            effectiveCps: clicks.effectiveCps(globals.cps),
            buildings,
            upgrades
        }
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    //! The drain loop

    async function tick(ctx) {
        const deadline = Date.now() + SLICE_MS
        let balance = live.readGlobals().cookies
        let actions = 0
        let decision = null

        while (actions < MAX_ACTIONS && Date.now() < deadline) {
            if (!ctx.budget.take(1)) break

            const view = buildView(balance)
            decision = decide(view)

            if (decision.action === 'buyUpgrade') {
                // spending moves the bank, which would poison the click meter
                clicks.spoil()
                simulateClick(decision.target.element)
                balance -= decision.target.price
                bought++
                actions++
                await wait(REDRAW_MS)
                continue
            }

            if (decision.action === 'buyBuilding') {
                const amount = decision.amount || 1
                clicks.spoil()
                const result = await act.store.buy(decision.target, amount, balance)
                if (!result.bought) {
                    // the rendered bulk price came in over budget: our estimate was
                    // optimistic. stop here rather than retrying the same number.
                    decision = { ...decision, reason: `${decision.reason} - ${result.reason}` }
                    break
                }
                balance -= result.cost
                bought += amount
                actions++
                await wait(REDRAW_MS)
                continue
            }

            break
        }

        window.__alakazam.decision = decision
        window.__alakazam.lastDrain = { actions, balance }
        logOccasionally(decision, actions)
    }

    //* logOccasionally
    // one compact line every few seconds. the tick is far too fast to log every
    // pass, and the interesting event is the decision changing, not its repetition.
    let lastLoggedReason = ''
    let lastLoggedAt = 0

    function logOccasionally(decision, actions) {
        if (!decision) return
        const now = Date.now()
        const changed = decision.reason !== lastLoggedReason
        if (!changed && now - lastLoggedAt < 5000) return
        lastLoggedReason = decision.reason
        lastLoggedAt = now
        const globals = live.readGlobals()
        console.log('Alakazam', {
            cookies: globals.cookies,
            cps: globals.cps,
            boughtThisDrain: actions,
            boughtTotal: bought,
            bulkControls: act.store.available() ? 'ok' : 'missing',
            catalog: catalog.stats(),
            decision: `${decision.action}: ${decision.reason}`
        })
    }

    registry.register({ name: 'purchase', interval: INTERVAL_MS, tick })

    window.Alakazam.purchase = { buildView, totalBought: () => bought }
})()
