// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Autoclicker
    // A real user clicks a few times a second; an autoclicker clicks many times a
    // second. Every click here is still a genuine dispatched event (fair-play),
    // we simply issue a burst of them per animation frame. BURST_PER_FRAME is the
    // throughput knob: raise it for more clicks, lower it if the tab stutters.
    // The ceiling is the game's own click-handler cost, and a large burst is
    // effectively superhuman even though each event is real.
    //
    // Cadence used to live in input.js as its own requestAnimationFrame loop.
    // It is a scheduler module now, so it can be paused and toggled like anything
    // else, but the behaviour is unchanged.

    const { simulateClick } = window.Alakazam.input
    const { registry, clicks } = window.Alakazam

    const BURST_PER_FRAME = 50

    let target = null

    function tick() {
        // the big cookie is replaced when the game redraws, so re-resolve it
        // whenever the node we held has been detached
        if (!target || !target.isConnected) {
            target = document.getElementById('bigCookie')
        }
        if (!target) return
        for (let i = 0; i < BURST_PER_FRAME; i++) {
            simulateClick(target)
        }
        // tell the click meter what we issued, so what clicking earns can be
        // measured rather than assumed
        clicks.record(BURST_PER_FRAME)
    }

    registry.register({ name: 'autoclick', interval: 'frame', tick })

    window.Alakazam.autoclick = { BURST_PER_FRAME }
})()
