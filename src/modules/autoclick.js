// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Autoclicker
    // A real user clicks a few times a second; an autoclicker clicks many times a
    // second. Every click here is still a genuine dispatched event (fair-play),
    // we simply issue a burst of them per animation frame.
    //
    // It used to fire a burst per animation frame: fifty at first, then four,
    // which still worked out at around 240 events a second on a 60Hz display.
    // Watching the game's own tally makes it clear that almost none of that lands.
    // However fast the clicks arrive, even thousands at once, the game registers
    // roughly three a second. Everything above that was pure cost: events that
    // several handlers each had to consider before nothing came of them.
    //
    // So the rate is capped in time rather than per frame, which also makes it a
    // number that means something. Fifteen a second is comfortably above what the
    // game has been observed to consume, low enough to be unremarkable, and
    // independent of the display's refresh rate, which a per-frame burst never
    // was.
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
