// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Shimmer Policy
    // Golden cookies, wrath cookies and reindeer all render as .shimmer inside
    // #shimmers. They are only on screen for a few seconds, so this runs far more
    // often than anything else.
    //
    // It used to click every shimmer the instant it appeared, which is wrong in
    // one specific way. Wrath cookies can roll Clot (halved production) or Ruin
    // (five percent of the bank gone), and clicking one in the middle of a Frenzy
    // throws away the buff you were building on. Their expected value is still
    // positive, so they are worth taking in general, just not while a buff is
    // running. Golden cookies and reindeer are always worth clicking.

    const { simulateClick } = window.Alakazam.input
    const { live, registry } = window.Alakazam

    const INTERVAL_MS = 50

    const counts = { golden: 0, wrath: 0, reindeer: 0, skipped: 0 }

    function tick() {
        const shimmers = live.readShimmers()
        if (shimmers.length === 0) return

        // any buff on screen means a combo is in progress and a wrath roll could
        // undo it. reading it here rather than per shimmer keeps the hot path cheap.
        const buffed = live.readBuffs().length > 0

        for (const shimmer of shimmers) {
            if (shimmer.wrath && buffed) {
                counts.skipped++
                continue
            }
            simulateClick(shimmer.element)
            if (shimmer.wrath) counts.wrath++
            else if (shimmer.type === 'reindeer') counts.reindeer++
            else counts.golden++
        }
    }

    registry.register({ name: 'shimmers', interval: INTERVAL_MS, tick })

    window.Alakazam.shimmers = { counts: () => ({ ...counts }) }
})()
