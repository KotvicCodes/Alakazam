// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Wrinklers
    // Wrinklers latch onto the cookie and siphon production, then hand back more
    // than they took when popped. Leaving them to fill up and popping the full set
    // is the standard play; shiny wrinklers are worth several times a normal one
    // and should never be popped.
    //
    // Alakazam cannot pop them yet, and it is worth being precise about why. The
    // game draws wrinklers straight onto #backgroundLeftCanvas: there is no
    // element for them, and the stylesheet has no .wrinkler rule. The selector the
    // old measurement layer used matched nothing, every time. Popping one means
    // working out where it is on the canvas and clicking that point, which is a
    // real piece of work rather than a selector fix, so it is written up in
    // docs/ROADMAP.md instead of being faked here.
    //
    // What this module can do honestly is report. The save carries the hoard and
    // the count exactly, so the HUD can tell you when it is worth popping them by
    // hand, and the ascension planner will be able to insist on it later.

    const { save, store, registry } = window.Alakazam

    const INTERVAL_MS = 5000

    // the usual cap without upgrades; past this they stop spawning and the hoard
    // simply sits there, which is the point at which popping is clearly right
    const TYPICAL_MAX = 10

    let advised = false

    function state() {
        const s = save.get()
        if (!s.ok || !s.scalars) return null
        return {
            active: s.scalars.wrinklersNumber,
            hoard: s.scalars.wrinklersAmount,
            sucked: s.scalars.cookiesSucked,
            popped: s.scalars.wrinklersPopped,
            // popping returns more than was taken, and every wrinkler beyond the
            // first multiplies what the others digest
            worthPopping: s.scalars.wrinklersNumber >= TYPICAL_MAX
        }
    }

    function tick() {
        const w = state()
        if (!w) return
        window.__alakazam.wrinklers = w

        // say it once per full set rather than every five seconds
        if (w.worthPopping && !advised) {
            advised = true
            store.set('wrinklerAdviceAt', Date.now())
            console.log(
                `Alakazam: ${w.active} wrinklers are holding a hoard worth popping. ` +
                    'Alakazam cannot pop them itself (they are drawn on a canvas, not clickable ' +
                    'elements) so this one is still yours: click each one three times, but leave ' +
                    'any shiny ones alone.'
            )
        }
        if (!w.worthPopping) advised = false
    }

    registry.register({ name: 'wrinklers', interval: INTERVAL_MS, tick })

    window.Alakazam.wrinklers = { state }
})()
