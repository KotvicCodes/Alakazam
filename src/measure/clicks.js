// wrapped in an IIFE so content scripts do not share top-level declarations
;(function () {
    //! Registered Click Income
    // Difference the game's saved cookieClicks and handmadeCookies counters over
    // save timestamps, not scheduler ticks. Dispatches are a separate diagnostic.
    const { save, live, registry, store } = window.Alakazam
    const TICK_MS = 1000
    const STALE_MS = 150000 // two missed minute autosaves, plus polling slack
    const SMOOTHING = 0.4

    let dispatched = 0
    let dispatchedRate = 0
    let lastDispatched = 0
    let lastDispatchAt = null
    let income = 0
    let rate = 0
    let perClick = NaN
    let samples = 0
    let baseline = null
    let seenRevision = null
    let reason = 'Waiting for two saves.'
    let allowEstimate = true

    function record(count) {
        if (Number.isFinite(count) && count > 0) dispatched += count
    }

    function reset(why, estimate = true) {
        income = 0
        rate = 0
        perClick = NaN
        samples = 0
        baseline = null
        dispatched = 0
        dispatchedRate = 0
        lastDispatched = 0
        lastDispatchAt = null
        reason = why
        allowEstimate = estimate
    }

    function blend(current, sample) {
        return current * (1 - SMOOTHING) + sample * SMOOTHING
    }

    function sampleGameTotals(now) {
        const s = save.get()
        const meta = save.stats()
        if (!s.ok || s.stale || !s.scalars || !s.scalars.trusted || meta.trusted === false) {
            reset('Click measurement unavailable: save is not trustworthy.', false)
            seenRevision = null
            return
        }
        // The save-lifecycle PR supplies this contract. Parsed metadata is the
        // compatibility path until that PR lands; changed parsed objects act as
        // revisions, including saves with unchanged click totals.
        const revision = meta.revision ?? s
        const savedAt = meta.savedAt ?? (s.run && s.run.lastDate)
        const runId =
            meta.runId ||
            (s.run && [s.key, s.run.fullDate, s.run.seed, s.run.startDate, s.scalars.resets].join('|'))
        const clicks = s.scalars.cookieClicks
        const handmade = s.scalars.handmadeCookies
        if (
            !runId ||
            !Number.isFinite(savedAt) ||
            savedAt <= 0 ||
            !Number.isFinite(clicks) ||
            clicks < 0 ||
            !Number.isFinite(handmade) ||
            handmade < 0 ||
            savedAt > now + 5000
        ) {
            reset('Click measurement unavailable: invalid save totals or time.', false)
            seenRevision = null
            return
        }
        if (now - savedAt > STALE_MS) {
            reset('Click measurement expired: no recent save.', false)
            seenRevision = revision
            return
        }
        if (revision === seenRevision) return
        seenRevision = revision
        const next = { runId, savedAt, clicks, handmade }
        if (
            !baseline ||
            baseline.runId !== runId ||
            clicks < baseline.clicks ||
            handmade < baseline.handmade ||
            savedAt <= baseline.savedAt
        ) {
            reset('Waiting for two saves in this run.')
            baseline = next
            return
        }
        const seconds = (savedAt - baseline.savedAt) / 1000
        const gainedClicks = clicks - baseline.clicks
        const gainedCookies = handmade - baseline.handmade
        if (gainedClicks === 0 && gainedCookies > 0) {
            reset('Click measurement unavailable: inconsistent saved counters.', false)
            baseline = next
            return
        }
        const first = samples === 0
        // A newly saved zero interval proves inactivity. Clear the old combo
        // immediately; zero is a measured value and must not select a fallback.
        income =
            first || gainedCookies === 0
                ? gainedCookies / seconds
                : blend(income, gainedCookies / seconds)
        rate = first || gainedClicks === 0 ? gainedClicks / seconds : blend(rate, gainedClicks / seconds)
        perClick = gainedClicks > 0 ? gainedCookies / gainedClicks : NaN
        samples++
        reason = ''
        allowEstimate = false
        baseline = next
    }

    function sampleDispatched(now) {
        if (lastDispatchAt !== null && now > lastDispatchAt) {
            dispatchedRate = (dispatched - lastDispatched) / ((now - lastDispatchAt) / 1000)
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

    function clickCps() {
        return income
    }

    function estimatedRate() {
        const autoclick = window.Alakazam.autoclick
        return allowEstimate && store.moduleEnabled('autoclick') && autoclick
            ? autoclick.configuredRate()
            : 0
    }

    // The startup estimate is explicit and follows configured pacing. It is not
    // presented as registration. Measured zero and expired samples stay zero.
    function clicksPerSecond() {
        return samples > 0 ? rate : estimatedRate()
    }

    function cookiesPerClick() {
        return perClick
    }

    function effectiveCps(passiveCps) {
        const passive = Number.isFinite(passiveCps) ? passiveCps : live.readGlobals().cps
        return passive + clickCps()
    }

    function measured() {
        return samples > 0
    }

    function stats() {
        return {
            clickCps: clickCps(),
            registeredPerSecond: measured() ? Math.round(rate * 10) / 10 : null,
            estimatedPerSecond: measured() ? null : estimatedRate(),
            dispatchedPerSecond: Math.round(dispatchedRate * 10) / 10,
            cookiesPerClick: cookiesPerClick(),
            measured: measured(),
            samples,
            reason
        }
    }

    function resetRun() {
        reset('Waiting for two saves after a run transition.')
        seenRevision = null
    }

    registry.register({ name: 'clicks', interval: TICK_MS, always: true, tick, reset: resetRun })
    window.Alakazam.clicks = {
        record,
        reset: resetRun,
        clickCps,
        clicksPerSecond,
        cookiesPerClick,
        effectiveCps,
        measured,
        stats
    }
})()
