// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Click Income
    // The number in #cookiesPerSecond is passive production only. It does not
    // include a single cookie earned by clicking, and Alakazam clicks the big
    // cookie constantly, so the rate it reasons about was never the rate it was
    // actually earning at.
    //
    // This started out inferring click income by subtraction: watch the bank, take
    // off what passive production should have contributed, and call the remainder
    // clicking. Every term in that was a guess, and all of them leaned the same
    // way, so it read low. Displayed CpS is sampled at the end of a window but
    // applies across it, and production only ever rises. Wrinklers eat part of
    // what production should have delivered. Windows containing a purchase had to
    // be discarded, and the drain loop buys almost continuously, so honest samples
    // were rare and the smoothed figure lagged a value that keeps growing.
    //
    // The game already counts all of this exactly. Two of its own running totals
    // are in the save:
    //
    //   handmadeCookies  cookies earned by clicking, ever
    //   cookieClicks     clicks the game acted on, ever
    //
    // Differencing those over the gap between saves gives income, click rate and
    // the value of one click, with no estimate anywhere in the chain. It lags by
    // up to a minute, because that is when the game writes its save, and it is an
    // average over that gap rather than an instantaneous reading. For deciding
    // what an upgrade is worth, exact and slightly stale beats live and wrong.

    const { save, live, registry } = window.Alakazam

    const TICK_MS = 1000

    // how much a new sample moves the running estimate. these arrive about once a
    // minute, so they are trusted more than the old noisy per-second ones were.
    const SMOOTHING = 0.4

    //* ASSUMED_RATE
    // What to reason with before the game has autosaved twice.
    //
    // Measurement needs two saves a minute apart, so there is a window at the
    // start of every session with nothing to go on, and clicking upgrades are at
    // their most valuable in exactly that window. Scoring them against zero clicks
    // a second is the old bug in a new place: it values every one of them at
    // nothing and skips them all.
    //
    // Three a second is what the game registers in practice, whether the clicks
    // arriving are three a second or three thousand. It is a floor, not a
    // prediction, and the moment a real measurement exists it takes over.
    const ASSUMED_RATE = 3

    let dispatched = 0
    let dispatchedRate = 0
    let lastDispatched = 0
    let lastDispatchAt = 0

    let income = 0
    let rate = 0
    let perClick = NaN
    let samples = 0

    let lastClicks = NaN
    let lastHandmade = NaN
    let lastAt = 0

    //* record
    // called by the autoclicker with however many clicks it issued. kept as a
    // diagnostic only: what we send has never been what the game counts.
    function record(count) {
        dispatched += count
    }

    function blend(current, sample) {
        return current > 0 ? current * (1 - SMOOTHING) + sample * SMOOTHING : sample
    }

    //* sampleGameTotals
    // difference the game's own cumulative counters. they only move when the game
    // autosaves, so most ticks see no change and do nothing.
    function sampleGameTotals(now) {
        const s = save.get()
        if (!s.ok || !s.scalars || !s.scalars.trusted) return

        const clicks = s.scalars.cookieClicks
        const handmade = s.scalars.handmadeCookies
        if (!Number.isFinite(clicks) || !Number.isFinite(handmade)) return

        const first = !Number.isFinite(lastClicks)
        // ascending resets both totals; treat any decrease as a fresh start rather
        // than reporting a negative rate
        const reset = clicks < lastClicks || handmade < lastHandmade

        if (!first && !reset && now > lastAt) {
            const seconds = (now - lastAt) / 1000
            const gainedCookies = handmade - lastHandmade
            const gainedClicks = clicks - lastClicks

            if (gainedCookies > 0) {
                income = blend(income, gainedCookies / seconds)
                samples++
            }
            if (gainedClicks > 0) {
                rate = blend(rate, gainedClicks / seconds)
                perClick = Number.isFinite(perClick)
                    ? blend(perClick, gainedCookies / gainedClicks)
                    : gainedCookies / gainedClicks
            }
        }

        if (first || reset || clicks !== lastClicks || handmade !== lastHandmade) {
            lastClicks = clicks
            lastHandmade = handmade
            lastAt = now
        }
    }

    function sampleDispatched(now) {
        if (lastDispatchAt > 0 && now > lastDispatchAt) {
            const seconds = (now - lastDispatchAt) / 1000
            dispatchedRate = blend(dispatchedRate, (dispatched - lastDispatched) / seconds)
        }
        lastDispatched = dispatched
        lastDispatchAt = now
    }

    function tick() {
        const now = Date.now()
        sampleGameTotals(now)
        sampleDispatched(now)
        window.__alakazam.clicks = stats()
    }

    //! What callers use

    //* clickCps
    // what clicking earns per second, from the game's own total. zero until the
    // game has autosaved twice, which is the only honest thing to say until then.
    function clickCps() {
        return income > 0 ? income : 0
    }

    //* clicksPerSecond
    // how many clicks the game actually acts on, which is a small fraction of what
    // the autoclicker sends. this is the one to value a clicking upgrade against,
    // and it falls back to the assumed floor rather than to zero.
    function clicksPerSecond() {
        return rate > 0 ? rate : ASSUMED_RATE
    }

    function cookiesPerClick() {
        return Number.isFinite(perClick) ? perClick : NaN
    }

    //* effectiveCps
    // what Alakazam is really earning: passive production plus clicking
    function effectiveCps(passiveCps) {
        const passive = Number.isFinite(passiveCps) ? passiveCps : live.readGlobals().cps
        return passive + clickCps()
    }

    //* measured
    // whether there has been a real sample yet. the panel says so rather than
    // showing a zero that looks like a broken autoclicker.
    function measured() {
        return samples > 0
    }

    function stats() {
        return {
            clickCps: clickCps(),
            registeredPerSecond: Math.round(clicksPerSecond() * 10) / 10,
            dispatchedPerSecond: Math.round(dispatchedRate),
            cookiesPerClick: cookiesPerClick(),
            measured: measured(),
            samples
        }
    }

    registry.register({ name: 'clicks', interval: TICK_MS, setting: 'enabled', tick })

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.clicks = {
        record,
        clickCps,
        clicksPerSecond,
        cookiesPerClick,
        effectiveCps,
        measured,
        stats
    }
})()
