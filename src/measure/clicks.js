// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Click Income
    // The number in #cookiesPerSecond is passive production only. It does not
    // include a single cookie earned by clicking, and Alakazam clicks the big
    // cookie constantly, so the rate it was reasoning about was never the rate it
    // was actually earning at. That mattered most for the early clicking upgrades,
    // whose whole effect is on a number nothing was measuring.
    //
    // Rather than assume a click rate, both halves are measured:
    //
    //   clicks per second   counted from the clicks we actually issue, because
    //                       what the autoclicker asks for and what the game
    //                       processes are not the same number
    //   cookies per click   inferred from the bank. Over a window, whatever the
    //                       bank gained beyond passive production came from
    //                       clicking, so dividing that by the clicks in the window
    //                       gives the value of one click.
    //
    // The inference is only valid in a quiet window, so samples are thrown away
    // whenever anything else could have moved the bank: a purchase, a buff, or a
    // golden cookie. That leaves fewer samples but honest ones, and they are
    // smoothed because any single window is noisy.

    const { live, registry } = window.Alakazam

    const TICK_MS = 1000

    // how much a new sample moves the running estimate
    const SMOOTHING = 0.25

    // ignore windows shorter than this: the arithmetic gets noisy
    const MIN_WINDOW_MS = 400

    let clicksIssued = 0
    let lastAt = 0
    let lastBank = 0
    let lastClicks = 0
    let dirtyWindow = true

    let cookiesPerClick = NaN
    let clicksPerSecond = 0
    let samples = 0

    //* record
    // called by the autoclicker with however many clicks it just issued
    function record(count) {
        clicksIssued += count
    }

    //* spoil
    // mark the current window unusable. anything that moves the bank for a reason
    // other than clicking has to call this or the estimate is nonsense.
    function spoil() {
        dirtyWindow = true
    }

    function tick() {
        const now = Date.now()
        const globals = live.readGlobals()
        const bank = globals.cookies
        const clicks = clicksIssued

        const elapsed = now - lastAt
        const usable =
            lastAt > 0 &&
            elapsed >= MIN_WINDOW_MS &&
            !dirtyWindow &&
            // a buff multiplies production and a golden cookie can drop a lump sum
            live.readBuffs().length === 0 &&
            live.readShimmers().length === 0

        if (usable) {
            const seconds = elapsed / 1000
            const gained = bank - lastBank
            const windowClicks = clicks - lastClicks

            // a bank that went down means something was bought; a window with no
            // clicks says nothing about what a click is worth
            if (gained > 0 && windowClicks > 0) {
                const fromClicking = gained - globals.cps * seconds
                if (fromClicking > 0) {
                    const sample = fromClicking / windowClicks
                    cookiesPerClick = Number.isFinite(cookiesPerClick)
                        ? cookiesPerClick * (1 - SMOOTHING) + sample * SMOOTHING
                        : sample
                    samples++
                }
                const rate = windowClicks / seconds
                clicksPerSecond = clicksPerSecond
                    ? clicksPerSecond * (1 - SMOOTHING) + rate * SMOOTHING
                    : rate
            }
        }

        lastAt = now
        lastBank = bank
        lastClicks = clicks
        dirtyWindow = false

        window.__alakazam.clicks = stats()
    }

    //* clickCps
    // what clicking is earning per second, on the same scale as passive CpS.
    // zero until there is something to base it on, so it can always be added.
    function clickCps() {
        if (!Number.isFinite(cookiesPerClick) || cookiesPerClick <= 0) return 0
        return cookiesPerClick * clicksPerSecond
    }

    //* effectiveCps
    // what Alakazam is really earning: passive production plus clicking
    function effectiveCps(passiveCps) {
        const passive = Number.isFinite(passiveCps) ? passiveCps : live.readGlobals().cps
        return passive + clickCps()
    }

    function stats() {
        return {
            cookiesPerClick: Number.isFinite(cookiesPerClick) ? cookiesPerClick : null,
            clicksPerSecond: Math.round(clicksPerSecond * 10) / 10,
            clickCps: clickCps(),
            samples
        }
    }

    registry.register({ name: 'clicks', interval: TICK_MS, setting: 'enabled', tick })

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.clicks = { record, spoil, clickCps, effectiveCps, stats }
})()
