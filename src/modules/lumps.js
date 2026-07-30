// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Sugar Lumps
    // A lump grows for 20 hours, is mature for 3 more, is ripe for 1, then falls
    // on its own. Harvesting a mature lump fails half the time and yields nothing;
    // harvesting a ripe one always works. Nothing on screen says in so many words
    // which stage a lump is at, but the save records the moment it started
    // growing, so the stage is arithmetic and the harvest can be timed properly.
    //
    // Waiting for ripe is very nearly free: a lump left alone falls by itself an
    // hour later anyway. The only reason to harvest early is the one achievement
    // that requires it, so that gamble is taken exactly once per save.
    //
    // Lumps are then spent on building levels. Every level adds 1% to that
    // building, but the first level of four specific buildings unlocks a whole
    // minigame, which is worth far more than any percentage.
    //
    //! Those hours are not constants
    // Stevia Caelestis, Sugar aging process and Rigidel each take up to an hour
    // off the ripening time, and the game sets the moment a lump falls to exactly
    // one hour after it ripens. So every one of those reductions pulls the
    // auto-harvest earlier too, and on a save with all three the lump has fallen
    // by hour 21. Waiting for hour 23 on that save means never harvesting a lump
    // at all: they all fall on their own, an hour later than they had to, and the
    // next one starts growing an hour late every time.
    //
    // Which of those upgrades are owned is not readable from the save in any form
    // that survives a game patch (the bitfield is by upgrade id, and ids move), so
    // the schedule is measured off the lump itself instead. See lifeSpan below.

    const { simulateClick } = window.Alakazam.input
    const { save, store, registry } = window.Alakazam

    const INTERVAL_MS = 30000
    const HOUR = 60 * 60 * 1000

    //* MATURE_MS
    // 20 hours, the game's base. Every modifier only ever lowers the real figure,
    // so a lump this old is certainly mature whatever the save owns. That is all
    // this is used for: the one deliberate early harvest below needs a moment that
    // is definitely past maturity, and being late to it costs nothing.
    const MATURE_MS = 20 * HOUR

    // and the base fall time, used until the real one has been measured
    const FALL_MS = 24 * HOUR

    // the game's own gap between ripening and falling, which it never varies:
    // lumpOverripeAge is written as lumpRipeAge plus one hour
    const RIPE_BEFORE_FALL_MS = HOUR

    // a measured lifespan outside this range is a misread rather than a discovery.
    // Nothing can push it above the 24 hour base, and the reductions together
    // cannot bring it below about 19 hours.
    const MIN_MEASURED_MS = 2 * HOUR

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

    //! How long this save's lumps actually live
    // The lump icon is a sprite, and the frame is picked from how far through its
    // life the lump is. From the game's own draw call:
    //
    //   sevenths = (age / fallAge) * 7
    //   #lumpsIcon  background-position column = 23 + min(floor(sevenths), 5)
    //   #lumpsIcon2 opacity                    = min(6, sevenths) % 1
    //
    // with the opacity forced to 1 once six sevenths are up. So the column gives
    // the whole part and the opacity the fraction, and together they are `sevenths`
    // to several decimal places. The age is known from the save, so the whole
    // lifespan is age * 7 / sevenths, and everything else follows from it.
    //
    // The reading saturates in the last seventh, which is exactly the part that
    // matters, so the answer is measured all through the lump's life and kept.
    // It is stored per save because it only changes when an upgrade does, and
    // because a page reload late in a lump's life would otherwise have nothing.

    const LUMP_KEY = 'lumpLifeSpan'

    // sprite geometry, matching measure/buffs.js: 48px cells, and the lump frames
    // start at column 23
    const CELL = 48
    const FIRST_COLUMN = 23

    // below this the age is too short for the ratio to be worth anything: a few
    // minutes in, a small misreading of the fraction is a large one of the whole
    const MEASURE_AFTER_MS = HOUR

    function el(id) {
        return document.getElementById(id)
    }

    //* sevenths
    // how far through its life the lump on screen is, in the game's own sevenths.
    // NaN when it cannot be read at all and when the reading has saturated, which
    // are the same answer as far as any caller is concerned: no new information.
    function sevenths() {
        const icon = el('lumpsIcon')
        const fade = el('lumpsIcon2')
        if (!icon || !icon.style || !fade || !fade.style) return NaN

        const found = String(icon.style.backgroundPosition || '').match(/(-?\d+(?:\.\d+)?)px/)
        if (!found) return NaN
        const whole = Math.round(-parseFloat(found[1]) / CELL) - FIRST_COLUMN
        if (!(whole >= 0 && whole <= 5)) return NaN

        const opacity = parseFloat(fade.style.opacity)
        if (!Number.isFinite(opacity)) return NaN
        // the frame stops advancing and the second icon goes fully opaque together,
        // six sevenths in. Past that the sprite says only "nearly done".
        if (whole === 5 && opacity >= 1) return NaN

        return whole + opacity
    }

    //* measure
    // update the stored lifespan from what the icon is showing, if it is showing
    // anything useful. Silent when it is not: the fallback is the game's base.
    function measure(age) {
        if (!(age > MEASURE_AFTER_MS)) return
        const at = sevenths()
        if (!(at > 0)) return
        const span = (age * 7) / at
        // nothing can lengthen a lump's life past the base, and the reductions
        // together cannot halve it, so anything outside that is a bad read
        if (!(span >= MIN_MEASURED_MS && span <= FALL_MS)) return
        store.set(LUMP_KEY, Math.round(span))
    }

    //* lifeSpan
    // how long a lump lives on this save, in milliseconds. Takes a fresh reading
    // first, so it is correct whoever asks and in whatever order.
    //
    // The remembered value is what carries the answer through the last seventh,
    // where the sprite stops saying anything, and through a page reload. Until
    // there has ever been a reading it is the game's own base, which is the safe
    // direction to be wrong in: too late to harvest costs an hour, too early
    // costs half the lumps.
    function lifeSpan() {
        return measuredSpan() || FALL_MS
    }

    //* measuredSpan
    // the lifespan if it has actually been read off the game, and zero if the
    // only thing behind the answer so far is the base timing
    function measuredSpan() {
        const s = save.get()
        if (s.ok && s.scalars && s.scalars.trusted && s.scalars.lumpT) {
            measure(Date.now() - s.scalars.lumpT)
        }
        const held = store.get(LUMP_KEY, 0)
        return held >= MIN_MEASURED_MS && held <= FALL_MS ? held : 0
    }

    //! Reading the current lump

    function lumpState() {
        const s = save.get()
        if (!s.ok || !s.scalars) return null
        const scalars = s.scalars
        if (!scalars.lumpT) return null

        const age = Date.now() - scalars.lumpT
        const measured = measuredSpan()
        const falls = measured || FALL_MS
        const ripeAt = falls - RIPE_BEFORE_FALL_MS
        return {
            lumps: scalars.lumps,
            total: scalars.lumpsTotal,
            type: LUMP_TYPES[scalars.lumpCurrentType] || 'normal',
            age,
            mature: age >= MATURE_MS,
            ripe: age >= ripeAt,
            hoursToRipe: Math.max(0, (ripeAt - age) / HOUR),
            // whether that came off the game or is still the base guess
            measured: measured > 0,
            // worth showing: on an upgraded save this is hours below the 24 the
            // guides quote, and it is the whole reason the timing changed
            lifeSpanHours: falls / HOUR,
            trusted: scalars.trusted
        }
    }

    //! Harvesting

    //* confirmSpend
    // The game can be set to ask before a lump is spent. It never asks before one
    // is harvested, so this belongs to levelling up and nothing else.
    //
    // It names the prompt it expects. Every confirmation in Cookie Clicker is
    // #promptOption0, including "Really wipe save" and including the Done button
    // on the clone customizer, so a blind click here is a click on whatever
    // another module happens to have open. Game.Prompt stamps each prompt's own
    // name into the DOM, and this one is #promptContentSpendLump.
    function confirmSpend() {
        if (!document.getElementById('promptContentSpendLump')) return
        const option = document.getElementById('promptOption0')
        if (option) simulateClick(option)
    }

    function harvest(reason) {
        const lumps = el('lumps')
        if (!lumps) return false
        simulateClick(lumps)
        lastHarvestAt = Date.now()
        console.log(`Alakazam: harvesting sugar lump (${reason})`)
        return true
    }

    //* shouldGamble
    // one deliberate early harvest per save, for the achievement that can only be
    // earned by picking a lump before it ripens. it is a coin flip, so it is taken
    // once and never again.
    //
    // It waits for a measured lifespan rather than going on the base timings,
    // because the gamble is only worth taking if we know where ripe is: guessing
    // it an hour late on a shortened save spends the one attempt on a lump that
    // was already ripe, or already gone. On a save whose ripening has been pulled
    // in below twenty hours there is no moment we can be sure is past maturity
    // but short of ripe, and this simply never fires. That is the right way
    // round: a wasted lump is worse than an achievement earned by hand.
    function shouldGamble(lump) {
        if (!lump.mature || lump.ripe || !lump.measured) return false
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
    // The level control is #productLevel<n>. It is not part of the store product
    // it belongs to: the game builds it into the building's own row, over on the
    // other side of the page, so looking for it inside the store listing finds
    // nothing and no lump was ever spent. It is addressed by id instead.
    function levelUp(index) {
        const badge = el('productLevel' + index)
        if (!badge) return false
        simulateClick(badge)
        setTimeout(confirmSpend, 120)
        return true
    }

    //! Tick

    //* banked
    // how many lumps are in hand. Straight from the save, so that a lump that is
    // growing unreadably (or is not growing at all) cannot stop the ones already
    // harvested from being spent, which is how a levelling plan quietly stalls.
    function banked() {
        const s = save.get()
        if (!s.ok || !s.scalars || !s.scalars.trusted) return NaN
        return s.scalars.lumps
    }

    function tick() {
        const lump = lumpState()
        if (lump) {
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
        }

        const held = banked()
        if (!Number.isFinite(held)) return
        const spend = nextSpend(held)
        if (spend) {
            console.log(`Alakazam: levelling ${spend.name} for ${spend.cost} sugar lumps (${spend.why})`)
            levelUp(spend.index)
        }
    }

    registry.register({ name: 'lumps', interval: INTERVAL_MS, tick })

    window.Alakazam.lumps = { lumpState, nextSpend, lifeSpan, sevenths, PLAN, MATURE_MS, FALL_MS }
})()
