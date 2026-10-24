// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Autoclicker
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

    const { simulateClick } = window.Alakazam.input
    const { registry, clicks } = window.Alakazam

    const CLICKS_PER_SECOND = 15
    const MIN_GAP_MS = 1000 / CLICKS_PER_SECOND

    let target = null
    let lastClickAt = 0

    function tick() {
        const now = Date.now()
        if (now - lastClickAt < MIN_GAP_MS) return
        lastClickAt = now

        // the big cookie is replaced when the game redraws, so re-resolve it
        // whenever the node we held has been detached
        if (!target || !target.isConnected) {
            target = document.getElementById('bigCookie')
        }
        if (!target) return
        simulateClick(target)
        // tell the click meter what we issued, so what clicking earns can be
        // measured rather than assumed
        clicks.record(1)
    }

    registry.register({ name: 'autoclick', interval: 'frame', tick })

    window.Alakazam.autoclick = { CLICKS_PER_SECOND }
})()
