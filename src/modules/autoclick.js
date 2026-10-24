// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Autoclicker
<<<<<<< HEAD
    // Dispatches at a configured rate independent of the display's refresh rate.
    // Earlier experiments observed about three registered clicks per second with
    // detail-zero synthetic events. That was an event-path throttle in the reviewed
    // game, not a universal ceiling. Keep rate policy separate from measured income;
    // input semantics and pacing changes belong with their browser regressions.
    //
    // Pacing happens here rather than through the scheduler's interval because the
    // millisecond driver runs on a 50ms tick, and 15 a second does not divide into
    // it. Running on the frame loop and checking the clock gives an accurate
    // cadence without a timer of its own.
=======
    // pace normal pointer clicks by elapsed time, independently of refresh rate.
    // The configured rate is an input budget, never a claim about registration:
    // measure/clicks.js reads the game's saved counters to measure what landed.
>>>>>>> origin/t3/fix-click-income-and-guards

    const { simulateClick } = window.Alakazam.input
    const { registry, clicks, store } = window.Alakazam

    const CLICKS_PER_SECOND = 15

    function configuredRate() {
        const configured = store.setting('clicksPerSecond')
        return Number.isFinite(configured) ? Math.max(0, Math.min(60, configured)) : CLICKS_PER_SECOND
    }

    let target = null
    let lastClickAt = -Infinity

    function tick() {
        const now = Date.now()
        const rate = configuredRate()
        if (rate === 0 || now - lastClickAt < 1000 / rate) return
        lastClickAt = now

        // the big cookie is replaced when the game redraws, so re-resolve it
        // whenever the node we held has been detached
        if (!target || !target.isConnected) {
            target = document.getElementById('bigCookie')
        }
        if (!target) return
        if (!simulateClick(target)) return
        // tell the click meter what we issued, so what clicking earns can be
        // measured rather than assumed
        clicks.record(1)
    }

    registry.register({ name: 'autoclick', interval: 'frame', tick })

    window.Alakazam.autoclick = { CLICKS_PER_SECOND, configuredRate }
})()
