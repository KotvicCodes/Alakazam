// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
export const api = (function () {
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
    const { firstNumberIn } = window.Alakazam.parse
    const { live, registry, save, store } = window.Alakazam

    const INTERVAL_MS = 50
    const FADING_LUCK_ID = 264
    const FADING_LUCK_PEAK = 0.85
    // even at the ~68.9s maximum golden-cookie lifespan (Lucky day + Serendipity +
    // 36 mature green rot on clay), opacity <= 0.10 is strictly under 30 frames (1s)
    const FADING_LUCK_MAX_OPACITY = 0.1

    const counts = { golden: 0, wrath: 0, reindeer: 0, skipped: 0 }
    const opacityState = new WeakMap()
    let seenSpellsCast = null
    let seenDomSpellsCast = null
    let attemptRevision = null

    //* readOpacity
    // returns the inline opacity when it is a finite number in [0, 1], or NaN when
    // the shimmer is not animating opacity
    function readOpacity(element) {
        const raw = element?.style?.opacity
        if (raw === undefined || raw === null || String(raw).trim() === '') return NaN
        const value = Number(raw)
        return Number.isFinite(value) && value >= 0 && value <= 1 ? value : NaN
    }

    //* readDomSpellsCast
    // #grimoireInfo renders "Spells cast: X (total: Y)" live on screen, including
    // manual player casts that do not increment store.get('spellsCast', 0)
    function readDomSpellsCast() {
        const info = document.getElementById('grimoireInfo')
        if (!info) return NaN
        const value = firstNumberIn(info.innerText)
        return Number.isFinite(value) && value >= 0 ? value : NaN
    }

    function hasFadingLuck() {
        const s = save?.get?.()
        const hasAchievementBit = Boolean(
            s?.ok && Array.isArray(s.achievements) && s.achievements.length > FADING_LUCK_ID
        )
        if (hasAchievementBit && s.achievements[FADING_LUCK_ID]) {
            if (attemptRevision !== null || store.get('fadingLuckAttemptAt', 0) > 0) {
                attemptRevision = null
                store.forget('fadingLuckAttemptAt')
            }
            if (!store.get('fadingLuckDone', false)) store.set('fadingLuckDone', true)
            return true
        }
        if (store.get('fadingLuckDone', false) !== true) return false
        if (hasAchievementBit) {
            const attemptAt = store.get('fadingLuckAttemptAt', 0)
            const lastDate = Number.isFinite(s.run?.lastDate) ? s.run.lastDate : 0
            const revision = save?.stats?.()?.revision ?? 0
            const saveAdvanced =
                (attemptAt > 0 && lastDate > attemptAt) ||
                (attemptRevision !== null && revision > attemptRevision) ||
                (attemptAt === 0 && attemptRevision === null)
            if (saveAdvanced) {
                attemptRevision = null
                store.forget('fadingLuckAttemptAt')
                store.set('fadingLuckDone', false)
                return false
            }
        }
        return true
    }

    function tick() {
        const spellsCast = store.get('spellsCast', 0)
        if (seenSpellsCast === null || spellsCast < seenSpellsCast) seenSpellsCast = spellsCast

        const domSpellsCast = readDomSpellsCast()
        if (seenDomSpellsCast === null) {
            seenDomSpellsCast = Number.isFinite(domSpellsCast)
                ? domSpellsCast
                : (save?.minigame?.('grimoire')?.spellsCast ?? 0)
        } else if (Number.isFinite(domSpellsCast) && domSpellsCast < seenDomSpellsCast) {
            seenDomSpellsCast = domSpellsCast
        }

        const conjuredBySpell =
            spellsCast > seenSpellsCast ||
            (Number.isFinite(domSpellsCast) && domSpellsCast > seenDomSpellsCast)
        const fadingLuckWon = hasFadingLuck()

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
            // natural golden cookie (never a reindeer, wrath, buffed combo cookie,
            // or FTHOF spell cookie which lacks spawnLead) until its opacity fades
            // into the final second so the save earns Fading luck
            const holdForFadingLuck =
                !shimmer.wrath &&
                shimmer.type !== 'reindeer' &&
                !buffed &&
                !conjuredBySpell &&
                shimmers.length === 1 &&
                counts.golden >= 1 &&
                !fadingLuckWon

            let earnedFadingLuck = false
            if (holdForFadingLuck) {
                const opacity = readOpacity(shimmer.element)
                if (Number.isFinite(opacity)) {
                    const prev = opacityState.get(shimmer.element)
                    const peak = Math.max(prev ? prev.peak : 0, opacity)
                    const falling = (prev && prev.falling) || (prev !== undefined && opacity < prev.last)
                    const u = 0.5 * (1 + Math.pow(Math.max(0, 1 - opacity), 0.25))
                    const at = Date.now()
                    const fallingTicks = falling ? (prev && prev.falling ? prev.fallingTicks + 1 : 1) : 0
                    const firstFallingU = falling ? (prev && prev.falling ? prev.firstFallingU : u) : 0
                    const firstFallingAt = falling
                        ? prev && prev.falling
                            ? prev.firstFallingAt
                            : at
                        : 0
                    const rate = fallingTicks >= 2 && at > prev.at ? (u - prev.u) / (at - prev.at) : 0
                    const averageRate =
                        fallingTicks >= 2 && at > firstFallingAt
                            ? (u - firstFallingU) / (at - firstFallingAt)
                            : 0
                    const progressPerMs = Math.max(rate, averageRate)
                    // Background tabs may poll a second apart. Observations are
                    // not units of time: release only inside the game's <1s
                    // achievement window, even when two polls span two seconds.
                    const aboutToExpire =
                        fallingTicks >= 3 && progressPerMs > 0 && (1 - u) / progressPerMs < 999
                    opacityState.set(shimmer.element, {
                        peak,
                        last: opacity,
                        falling,
                        u,
                        at,
                        fallingTicks,
                        firstFallingU,
                        firstFallingAt
                    })
                    const inFadePhase = peak >= FADING_LUCK_PEAK || falling
                    if (
                        !inFadePhase ||
                        (opacity > FADING_LUCK_MAX_OPACITY && !aboutToExpire) ||
                        opacity <= 0
                    ) {
                        continue
                    }
                    earnedFadingLuck = true
                }
            }

            simulateClick(shimmer.element)
            if (shimmer.wrath) {
                counts.wrath++
                if (conjuredBySpell) {
                    seenSpellsCast = spellsCast
                    if (Number.isFinite(domSpellsCast)) seenDomSpellsCast = domSpellsCast
                }
            } else if (shimmer.type === 'reindeer') counts.reindeer++
            else {
                counts.golden++
                if (conjuredBySpell) {
                    seenSpellsCast = spellsCast
                    if (Number.isFinite(domSpellsCast)) seenDomSpellsCast = domSpellsCast
                }
                if (earnedFadingLuck) {
                    attemptRevision = save?.stats?.()?.revision ?? 0
                    store.set('fadingLuckAttemptAt', Date.now())
                    store.set('fadingLuckDone', true)
                }
            }
        }
    }

    registry.register({ name: 'shimmers', interval: INTERVAL_MS, tick })

    return { counts: () => ({ ...counts }) }
})()
window.Alakazam.shimmers = api
