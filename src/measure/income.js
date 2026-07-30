// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Where The Cookies Come From
    // Both the dragon's auras and the pantheon's spirits are choices between "more
    // production", "more clicking" and "more golden cookies", and until now those
    // were picked from guides written for someone playing by hand. This measures the
    // three so they can be compared for this save, at this point in this run.
    //
    // Production is the easy one: it is on screen. Clicking is already differenced
    // out of the game's own counters by measure/clicks.js. Golden cookies are the
    // interesting one, and they pay in two ways:
    //
    //   1. A buff, which multiplies CpS for a while. That shows up in the number on
    //      screen, so the bonus is the difference between CpS now and CpS with
    //      nothing running. Both are sampled once a second and smoothed.
    //   2. A lump sum, which Lucky and a wrinkler popping both hand over at once.
    //      That never appears in CpS at all. It is recovered by comparing what the
    //      save says has been earned against the CpS that was on screen while it was
    //      being earned, and taking clicking off the difference.
    //
    // Everything here decays over about ten minutes, so it follows a run rather than
    // averaging a whole session flat. Nothing here is exact and it does not need to
    // be: the choices it feeds are between candidates that differ by tens of
    // percent, and being wrong about the tenth of a percent changes none of them.

    const { live, save, buffs, catalog, registry } = window.Alakazam

    const TICK_MS = 1000

    // how long a sample takes to lose most of its weight
    const TAU_MS = 10 * 60 * 1000

    // a minute of samples before anything here is worth quoting
    const MIN_SAMPLES = 60

    let meanCps = 0
    let baseCps = 0
    let buffedCps = 0
    let buffedShare = 0
    let goldensOnScreen = 0
    let windfallCps = 0
    let samples = 0
    let lastAt = 0

    // the running integral of what production alone should have earned since the
    // save last moved, which is what the save's own total is compared against
    let producedSinceSave = 0
    let earnedAtSave = null
    let saveWindowMs = 0

    //* decay
    // an exponential moving average that respects how long it actually was since
    // the last sample, because a scheduler tick is not a promise about time.
    function decay(previous, sample, dt) {
        const weight = Math.min(1, dt / TAU_MS)
        return previous + (sample - previous) * weight
    }

    function tick() {
        const now = Date.now()
        const dt = lastAt ? now - lastAt : TICK_MS
        lastAt = now

        const globals = live.readGlobals()
        const cps = Number.isFinite(globals.cps) ? globals.cps : 0
        const buffed = buffs.hasProductionBuff()
        const shimmers = live.readShimmers().filter(s => !s.wrath).length

        samples++
        meanCps = samples === 1 ? cps : decay(meanCps, cps, dt)
        buffedShare = decay(buffedShare, buffed ? 1 : 0, dt)
        goldensOnScreen = decay(goldensOnScreen, shimmers, dt)
        if (buffed) {
            buffedCps = buffedCps === 0 ? cps : decay(buffedCps, cps, dt)
        } else {
            baseCps = baseCps === 0 ? cps : decay(baseCps, cps, dt)
        }

        producedSinceSave += (cps * dt) / 1000
        saveWindowMs += dt
        readWindfall()
    }

    //* readWindfall
    // the part of the run's income that never passed through CpS. The save moves
    // about once a minute, which is exactly the cadence this wants: long enough for
    // the integral to be meaningful, short enough to follow the run.
    function readWindfall() {
        if (!save.trusted()) return
        const scalars = save.get().scalars
        if (!scalars || !Number.isFinite(scalars.cookiesEarned)) return
        const earned = scalars.cookiesEarned

        // first read, or a new run: take a baseline and measure from there
        if (earnedAtSave === null || earned < earnedAtSave) {
            earnedAtSave = earned
            producedSinceSave = 0
            saveWindowMs = 0
            return
        }
        if (earned === earnedAtSave) return

        const seconds = saveWindowMs / 1000
        if (seconds >= 1) {
            const clickCps = window.Alakazam.clicks.stats().clickCps || 0
            const extra = (earned - earnedAtSave - producedSinceSave) / seconds - clickCps
            windfallCps = decay(windfallCps, Math.max(0, extra), saveWindowMs)
        }
        earnedAtSave = earned
        producedSinceSave = 0
        saveWindowMs = 0
    }

    //* stats
    // `goldenCps` is what golden cookies are worth per second on average: the buff
    // bonus plus the lump sums. It is a floor, not a ceiling, because anything the
    // measurement cannot see is left out rather than guessed at.
    function stats() {
        const clicks = window.Alakazam.clicks.stats()
        const buffBonus = Math.max(0, meanCps - baseCps)
        const goldenCps = buffBonus + windfallCps
        const income = Math.max(1, meanCps + clicks.clickCps)
        return {
            cps: meanCps,
            baseCps,
            clickCps: clicks.clickCps,
            goldenCps,
            goldenShare: goldenCps / income,
            clickShare: clicks.clickCps / income,
            buffedShare,
            buffMult: baseCps > 0 && buffedCps > 0 ? buffedCps / baseCps : 1,
            goldensOnScreen,
            measured: samples >= MIN_SAMPLES,
            samples
        }
    }

    //! Shares of production
    // The scorers do not only need to know how much comes in, they need to know what
    // it is made of: an aura worth 5% of grandma output is worth nothing on a save
    // with no grandmas. Measured where it can be, assumed where it cannot, and the
    // assumptions are named so a table printed from them can be read honestly.

    // each wrinkler holds back this share of CpS and hands back a little more than it
    // took when it is finally popped
    const WRINKLER_BITE = 0.05
    const WRINKLER_RETURN = 1.1

    function shares() {
        const scalars = (save.get() || {}).scalars || {}
        const cps = Math.max(0, meanCps || live.readGlobals().cps || 0)
        const products = live.readProducts()

        const grandmas = products.find(p => p.index === 1)
        const grandmaCps = catalog.buildingCps(1)
        const grandmaShare =
            cps > 0 && grandmas && Number.isFinite(grandmaCps)
                ? Math.min(1, (grandmaCps * (grandmas.owned || 0)) / cps)
                : 0

        // prestige releases 1% of base production per level, once the heavenly
        // upgrades that unlock it are owned. Assuming they are overstates this on a
        // young account and is right on an old one, which is where any of this
        // matters. Stated rather than measured.
        const prestigeMult = (scalars.prestige || 0) * 0.01
        const prestigeShare = prestigeMult / (1 + prestigeMult)

        // wrinklers are never popped here, but an ascension harvests them, so what
        // they are holding is income being stored rather than income being lost
        const wrinklers = scalars.wrinklersNumber || 0
        const wrinklerCps = wrinklers > 0 ? wrinklers * WRINKLER_BITE * WRINKLER_RETURN * cps : 0

        return {
            grandmaShare,
            prestigeShare,
            wrinklerCps,
            otherBuildingTypes: Math.max(0, products.filter(p => p.owned > 0).length - 1),
            prestigeAssumed: true
        }
    }

    // measures only, so it runs on the master switch rather than a setting of its
    // own, the same as buffs and clicks
    registry.register({ name: 'income', interval: TICK_MS, setting: 'enabled', tick })

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.income = { stats, shares }
})()
