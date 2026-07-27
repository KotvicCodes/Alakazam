// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Sugar Lumps
    // A lump grows for 20 hours, is mature for 3 more, is ripe for 1, then falls
    // on its own. Harvesting a mature lump fails half the time and yields nothing;
    // harvesting a ripe one always works. Nothing on screen says which stage a
    // lump is at, but the save records the moment it started growing, so the stage
    // is simple arithmetic and the harvest can be timed properly.
    //
    // Waiting for ripe is very nearly free: a lump left alone falls by itself an
    // hour later anyway. The only reason to harvest early is the one achievement
    // that requires it, so that gamble is taken exactly once per save.
    //
    // Lumps are then spent on building levels. Every level adds 1% to that
    // building, but the first level of four specific buildings unlocks a whole
    // minigame, which is worth far more than any percentage.

    const { simulateClick } = window.Alakazam.input
    const { live, save, store, registry } = window.Alakazam

    const INTERVAL_MS = 30000
    const HOUR = 60 * 60 * 1000

    // base timings. upgrades and Rigidel shave a little off these, so treating
    // them as the latest possible moment only ever means harvesting slightly late,
    // which costs nothing. Being early, by contrast, costs half the lumps.
    const MATURE_MS = 20 * HOUR
    const RIPE_MS = 23 * HOUR

    const LUMP_TYPES = ['normal', 'bifurcated', 'golden', 'meaty', 'caramelized']

    //* Spending plan
    // in order. the first level of these four buildings unlocks a minigame, which
    // is the best return sugar lumps ever offer, so they come before everything.
    // after that: the garden wants a full 6x6 plot, cursors want the levels that
    // improve click combos, and 100 lumps banked is itself a production bonus.
    const PLAN = [
        { building: 7, level: 1, why: 'unlocks the Grimoire' },
        { building: 6, level: 1, why: 'unlocks the Pantheon' },
        { building: 2, level: 1, why: 'unlocks the Garden' },
        { building: 5, level: 1, why: 'unlocks the Stock Market' },
        { building: 2, level: 9, why: 'grows the garden to a full 6x6 plot' },
        { building: 0, level: 12, why: 'improves click combos and loan slots' }
    ]

    // below this, lumps are spent; at or above it they are banked, because holding
    // 100 is itself worth 1% production per lump
    const BANK_TARGET = 100

    let lastHarvestAt = 0

    //! Reading the current lump

    function lumpState() {
        const s = save.get()
        if (!s.ok || !s.scalars) return null
        const scalars = s.scalars
        if (!scalars.lumpT) return null

        const age = Date.now() - scalars.lumpT
        return {
            lumps: scalars.lumps,
            total: scalars.lumpsTotal,
            type: LUMP_TYPES[scalars.lumpCurrentType] || 'normal',
            age,
            mature: age >= MATURE_MS,
            ripe: age >= RIPE_MS,
            hoursToRipe: Math.max(0, (RIPE_MS - age) / HOUR),
            trusted: scalars.trusted
        }
    }

    //! Harvesting

    //* confirmPrompt
    // the game can be set to ask before spending or harvesting lumps. when it
    // does, the confirmation is the same prompt widget used elsewhere in the UI.
    function confirmPrompt() {
        const option = document.getElementById('promptOption0')
        if (option) simulateClick(option)
    }

    function harvest(reason) {
        const lumps = document.getElementById('lumps')
        if (!lumps) return false
        simulateClick(lumps)
        setTimeout(confirmPrompt, 120)
        lastHarvestAt = Date.now()
        console.log(`Alakazam: harvesting sugar lump (${reason})`)
        return true
    }

    //* shouldGamble
    // one deliberate early harvest per save, for the achievement that can only be
    // earned by picking a lump before it ripens. it is a coin flip, so it is taken
    // once and never again.
    function shouldGamble(lump) {
        if (!lump.mature || lump.ripe) return false
        return !store.get('handPickedTried', false)
    }

    //! Spending

    //* nextSpend
    // the first entry in the plan that is not satisfied yet, or the best ordinary
    // level-up once the plan is complete
    function nextSpend(lumps) {
        const s = save.get()
        if (!s.ok || !s.buildings) return null

        for (const step of PLAN) {
            const building = s.buildings[step.building]
            if (!building) continue
            // a building has to exist before it can be levelled
            if (building.amount < 1) continue
            if (building.level >= step.level) continue
            const cost = building.level + 1
            if (cost > lumps) return null
            return { index: step.building, name: building.name, cost, why: step.why }
        }

        // plan complete: keep a hundred banked for the production bonus, and put
        // anything above that into whichever building is producing the most
        if (lumps <= BANK_TARGET) return null
        const best = s.buildings
            .filter(b => b.amount > 0)
            .sort((a, b) => b.totalCookies - a.totalCookies)[0]
        if (!best) return null
        const cost = best.level + 1
        if (cost > lumps - BANK_TARGET) return null
        return { index: best.id, name: best.name, cost, why: 'highest producing building' }
    }

    //* levelUp
    // the level control is the .productLevel badge on a store product, which the
    // game styles with its own hover affordance. clicking it opens the same
    // confirmation prompt the harvest uses.
    function levelUp(index) {
        const product = live.readProducts().find(p => p.index === index)
        if (!product) return false
        const badge = product.element.querySelector('.productLevel')
        if (!badge) return false
        simulateClick(badge)
        setTimeout(confirmPrompt, 120)
        return true
    }

    //! Tick

    function tick() {
        const lump = lumpState()
        if (!lump) return
        window.__alakazam.lumps = lump

        // the lump timings come from positional save fields, so if that layout
        // could not be trusted we do not gamble a lump on it
        if (lump.trusted && Date.now() - lastHarvestAt > 60000) {
            if (lump.ripe) {
                harvest(`ripe ${lump.type} lump`)
            } else if (shouldGamble(lump)) {
                store.set('handPickedTried', true)
                harvest('mature but not ripe, for the one achievement that needs it')
            }
        }

        const spend = nextSpend(lump.lumps)
        if (spend) {
            console.log(`Alakazam: levelling ${spend.name} for ${spend.cost} sugar lumps (${spend.why})`)
            levelUp(spend.index)
        }
    }

    registry.register({ name: 'lumps', interval: INTERVAL_MS, tick })

    window.Alakazam.lumps = { lumpState, nextSpend, PLAN, MATURE_MS, RIPE_MS }
})()
