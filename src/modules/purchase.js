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

    //! The first minutes of a new run
    // An ascension hands back a whole run's worth of upgrades to re-earn, and the
    // prestige it paid for means they come back fast: for a while the store refills
    // quicker than anything can read it. Scoring one upgrade costs a tooltip hover,
    // so the drain loop below spends that entire period identifying crates while
    // the cookies pile up unspent, and there are far too many to keep up with.
    //
    // The game has its own answer, unlocked by the heavenly upgrade "Inspired
    // checklist": one button that buys every upgrade in the store, cheapest first.
    // Inside this window that is both quicker and very nearly the same answer,
    // because everything on offer is trivially cheap against what the run is
    // earning, so the order it is bought in hardly matters. Once the growth
    // flattens out the ordering starts to matter again, the window closes, and the
    // strategy engine goes back to picking upgrades against buildings one at a
    // time.
    //
    // It is a window rather than a permanent switch for exactly that reason: later
    // in a run, buying every affordable upgrade on sight is worse than weighing
    // each one against a building, which is the whole job of strategy/score.js.

    //* BUY_ALL_WINDOW_MS
    // How much of a new run is swept rather than picked through.
    //
    // Five minutes, because that is about how long a returning run takes to buy
    // back most of what it lost, and erring short is the cheap direction: the
    // strategy engine simply takes over sooner. Erring long means buying upgrades
    // that should have been weighed against a building first.
    //
    // Nothing about this timing is load bearing for the grandmapocalypse, which
    // would otherwise be the thing to worry about with a button that buys
    // everything. Game.storeBuyAll skips the tech pool outright and the research
    // that starts it is tech, so it is out of reach for the whole window and not
    // only for the first few minutes of it.
    const BUY_ALL_WINDOW_MS = 5 * 60 * 1000

    // the store refills continuously, so the button is worth pressing briskly.
    // More often than this is just noise on the page.
    const BUY_ALL_EVERY_MS = 2000

    let bought = 0
    let lastBuyAllAt = 0
    let buyAllPresses = 0

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

    //! Buy all

    //* runAge
    // how long this run has been going, from the save's own start date, which the
    // game resets on every ascension.
    //
    // NaN when the save cannot be read. That is deliberately not treated as "young
    // enough": without a start date there is no way to tell a fresh run from an
    // established one, and sweeping the store of an established run is the case
    // this window exists to stay out of.
    function runAge() {
        const s = save.get()
        if (!s.ok || !s.run || !s.run.startDate) return NaN
        return Date.now() - s.run.startDate
    }

    function inBuyAllWindow() {
        const age = runAge()
        return age >= 0 && age < BUY_ALL_WINDOW_MS
    }

    //* buyAll
    // Press the game's own "Buy all upgrades" button.
    //
    // It only exists once "Inspired checklist" is owned, so on a save without it
    // this quietly does nothing and the drain loop is the whole story, as before.
    //
    // What it buys is the game's decision, and it is a safe one: Game.storeBuyAll
    // skips anything in the vault, anything in the toggle pool, and anything in
    // the tech pool. The research that starts the grandmapocalypse is tech, so the
    // one purchase Alakazam holds back by name is one this button cannot make.
    function buyAll() {
        if (!inBuyAllWindow()) return false
        if (Date.now() - lastBuyAllAt < BUY_ALL_EVERY_MS) return false
        const button = document.getElementById('storeBuyAllButton')
        if (!button) return false
        lastBuyAllAt = Date.now()
        buyAllPresses++
        simulateClick(button)
        return true
    }

    //! The drain loop

    async function tick(ctx) {
        // the sweep goes first: it is one click and it changes what the drain loop
        // below can afford, so reading the bank before it would be reading a number
        // that is about to be spent
        if (buyAll()) await wait(REDRAW_MS)

        const deadline = Date.now() + SLICE_MS
        let balance = live.readGlobals().cookies
        let actions = 0
        let decision = null

        while (actions < MAX_ACTIONS && Date.now() < deadline) {
            if (!ctx.budget.take(1)) break

            const view = buildView(balance)
            decision = decide(view)

            if (decision.action === 'buyUpgrade') {
                simulateClick(decision.target.element)
                balance -= decision.target.price
                bought++
                actions++
                await wait(REDRAW_MS)
                continue
            }

            if (decision.action === 'buyBuilding') {
                const amount = decision.amount || 1
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
        window.__alakazam.buyAll = {
            sweeping: inBuyAllWindow() && !!document.getElementById('storeBuyAllButton'),
            minutesLeft: Math.max(0, (BUY_ALL_WINDOW_MS - runAge()) / 60000),
            presses: buyAllPresses
        }
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

    window.Alakazam.purchase = {
        buildView,
        buyAll,
        inBuyAllWindow,
        totalBought: () => bought,
        BUY_ALL_WINDOW_MS
    }
})()
