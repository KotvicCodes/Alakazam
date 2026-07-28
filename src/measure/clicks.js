// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Click Income
    // The number in #cookiesPerSecond is passive production only. It does not
    // include a single cookie earned by clicking, and Alakazam clicks the big
    // cookie constantly, so the rate it was reasoning about was never the rate it
    // was actually earning at.
    //
    // The important thing this file gets right, having got it wrong once: the
    // clicks Alakazam *sends* and the clicks the game *registers* are wildly
    // different numbers. The autoclicker dispatches fifty per animation frame,
    // about three thousand a second, and the game acts on a few of them. Reporting
    // the dispatched figure made the panel claim 3000 clicks a second next to a
    // game counting three, and worse, it was the number used to value clicking
    // upgrades: a thousandfold overestimate of what one is worth.
    //
    // So all three quantities are measured separately, each from the source that
    // actually knows:
    //
    //   income     what clicking earns per second. Taken straight from the bank:
    //              whatever it gained beyond passive production came from clicks.
    //              This needs no click count at all, so it cannot be wrong about
    //              one, and it is the number that matters.
    //   registered how many clicks the game acted on, from its own cookieClicks
    //              counter in the save. Exact, just up to a minute behind.
    //   dispatched what we sent. Only interesting as a diagnostic.
    //
    // Income samples are thrown away whenever anything else could have moved the
    // bank: a purchase, a buff, or a golden cookie.

    const { live, save, registry } = window.Alakazam

    const TICK_MS = 1000

    // how much a new sample moves the running estimate
    const SMOOTHING = 0.25

    // ignore windows shorter than this: the arithmetic gets noisy
    const MIN_WINDOW_MS = 400

    let dispatched = 0
    let lastAt = 0
    let lastBank = 0
    let lastDispatched = 0
    let dirtyWindow = true

    let income = 0
    let incomeSamples = 0

    let registeredRate = 0
    let dispatchedRate = 0
    let lastRegistered = NaN
    let lastRegisteredAt = 0

    //* record
    // called by the autoclicker with however many clicks it just issued. this is
    // what we sent, which is not what the game counted.
    function record(count) {
        dispatched += count
    }

    //* spoil
    // mark the current window unusable. anything that moves the bank for a reason
    // other than clicking has to call this or the estimate is nonsense.
    function spoil() {
        dirtyWindow = true
    }

    //! Measuring

    //* sampleIncome
    // the bank's rise above passive production, per second
    function sampleIncome(now, globals) {
        const elapsed = now - lastAt
        const usable =
            lastAt > 0 &&
            elapsed >= MIN_WINDOW_MS &&
            !dirtyWindow &&
            // a buff multiplies production and a golden cookie can drop a lump sum
            live.readBuffs().length === 0 &&
            live.readShimmers().length === 0

        const seconds = elapsed / 1000

        // how many clicks we sent is a fact about us, not about the bank, so it is
        // measured whatever else happened in the window. gating it on a clean
        // income window meant a steady stream of purchases suppressed it entirely.
        if (lastAt > 0 && elapsed >= MIN_WINDOW_MS) {
            const sent = (dispatched - lastDispatched) / seconds
            dispatchedRate = dispatchedRate ? dispatchedRate * (1 - SMOOTHING) + sent * SMOOTHING : sent
        }

        if (usable) {
            const gained = globals.cookies - lastBank
            // a bank that went down means something was bought
            if (gained > 0) {
                const fromClicking = gained - globals.cps * seconds
                if (fromClicking > 0) {
                    const sample = fromClicking / seconds
                    income = incomeSamples > 0 ? income * (1 - SMOOTHING) + sample * SMOOTHING : sample
                    incomeSamples++
                }
            }
        }

        lastAt = now
        lastBank = globals.cookies
        lastDispatched = dispatched
        dirtyWindow = false
    }

    //* sampleRegistered
    // the game keeps its own tally of clicks it acted on. it only reaches us when
    // the game autosaves, so this updates in jumps, but the rate it implies over
    // the gap is exact rather than inferred.
    function sampleRegistered(now) {
        const s = save.get()
        if (!s.ok || !s.scalars || !s.scalars.trusted) return
        const count = s.scalars.cookieClicks
        if (!Number.isFinite(count)) return

        if (Number.isFinite(lastRegistered) && count > lastRegistered && now > lastRegisteredAt) {
            const rate = (count - lastRegistered) / ((now - lastRegisteredAt) / 1000)
            registeredRate = registeredRate ? registeredRate * (1 - SMOOTHING) + rate * SMOOTHING : rate
        }
        if (!Number.isFinite(lastRegistered) || count !== lastRegistered) {
            lastRegistered = count
            lastRegisteredAt = now
        }
    }

    function tick() {
        const now = Date.now()
        sampleIncome(now, live.readGlobals())
        sampleRegistered(now)
        window.__alakazam.clicks = stats()
    }

    //! What callers use

    //* clickCps
    // what clicking is earning per second, measured rather than derived from a
    // click count. zero until there is something to base it on.
    function clickCps() {
        return income > 0 ? income : 0
    }

    //* clicksPerSecond
    // how many clicks the game actually acts on. this is the one to value a
    // clicking upgrade against, never the dispatched figure.
    function clicksPerSecond() {
        return registeredRate
    }

    //* cookiesPerClick
    // derived from the two measurements rather than counted, so it describes a
    // click the game registered, not one we sent
    function cookiesPerClick() {
        if (registeredRate <= 0 || income <= 0) return NaN
        return income / registeredRate
    }

    //* effectiveCps
    // what Alakazam is really earning: passive production plus clicking
    function effectiveCps(passiveCps) {
        const passive = Number.isFinite(passiveCps) ? passiveCps : live.readGlobals().cps
        return passive + clickCps()
    }

    function stats() {
        const perClick = cookiesPerClick()
        return {
            clickCps: clickCps(),
            registeredPerSecond: Math.round(registeredRate * 10) / 10,
            dispatchedPerSecond: Math.round(dispatchedRate),
            cookiesPerClick: Number.isFinite(perClick) ? perClick : null,
            samples: incomeSamples
        }
    }

    registry.register({ name: 'clicks', interval: TICK_MS, setting: 'enabled', tick })

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.clicks = {
        record,
        spoil,
        clickCps,
        clicksPerSecond,
        cookiesPerClick,
        effectiveCps,
        stats
    }
})()
