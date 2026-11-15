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

    const { simulateClick } = window.Alakazam.safety.input('shimmers')
    const { live, registry, store } = window.Alakazam

    const INTERVAL_MS = 50
    const FADING_LUCK_PEAK = 0.85
    const FADING_LUCK_MAX_OPACITY = 0.12

    const counts = { golden: 0, wrath: 0, reindeer: 0, skipped: 0 }
    const peakOpacity = new WeakMap()

    //* readOpacity
    // returns the inline opacity when it is a finite number in [0, 1], or NaN when
    // the shimmer is not animating opacity
    function readOpacity(element) {
        const raw = element?.style?.opacity
        if (raw === undefined || raw === null || String(raw).trim() === '') return NaN
        const value = Number(raw)
        return Number.isFinite(value) && value >= 0 && value <= 1 ? value : NaN
    }

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

            // once Early bird is secured on the first golden cookie, hold one solo
            // golden cookie until its opacity peaks and fades so the save also
            // earns Fading luck
            const holdForFadingLuck =
                !shimmer.wrath &&
                shimmer.type !== 'reindeer' &&
                shimmers.length === 1 &&
                counts.golden >= 1 &&
                !store.get('fadingLuckDone', false)

            let earnedFadingLuck = false
            if (holdForFadingLuck) {
                const opacity = readOpacity(shimmer.element)
                if (Number.isFinite(opacity)) {
                    const peak = Math.max(peakOpacity.get(shimmer.element) || 0, opacity)
                    peakOpacity.set(shimmer.element, peak)
                    if (peak < FADING_LUCK_PEAK || opacity > FADING_LUCK_MAX_OPACITY || opacity <= 0) {
                        continue
                    }
                    earnedFadingLuck = true
                }
            }

            simulateClick(shimmer.element)
            if (shimmer.wrath) counts.wrath++
            else if (shimmer.type === 'reindeer') counts.reindeer++
            else {
                counts.golden++
                if (earnedFadingLuck) store.set('fadingLuckDone', true)
            }
        }
    }

    registry.register({ name: 'shimmers', interval: INTERVAL_MS, tick })

    window.Alakazam.shimmers = { counts: () => ({ ...counts }) }
})()
