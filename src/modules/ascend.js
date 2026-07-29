// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Ascension Planner
    // Ascending trades the whole run for prestige levels, each worth a permanent
    // +1% CpS, and for the heavenly chips that buy permanent upgrades. It is the
    // only progression in the game that survives anything, and it is also the only
    // action Alakazam takes that cannot be undone.
    //
    // The arithmetic behind "is it time" is in strategy/ascend.js, where it is pure
    // and unit tested. This module is the part that has to live in a real game: it
    // watches the save, keeps the verdict fresh, and owns the phase the run is in.
    //
    // Right now it only reports. The click path through the ascension screen, the
    // pre-ascension loans and the timing rule that keeps it from ascending in the
    // middle of a boost all land in later commits, and they all hang off the phase
    // machine started here.

    const { save, store, registry } = window.Alakazam
    const { worthAscending, cookiesFor } = window.Alakazam.strategy.ascend

    const INTERVAL_MS = 5000

    //* Phases
    // The run's position in the ascension sequence. It is a single value rather
    // than a set of booleans because these are genuinely exclusive: the sequence
    // ends the run, so there is never more than one of them in flight.
    //
    //   watching   nothing to do; the target is not met yet
    //   ready      the target is met, waiting for a clean moment to start
    //   ascending  committed: the click path is running
    //
    // It is persisted per save so that a page reload part way through resumes
    // rather than leaving the game parked on the ascension screen.
    const PHASES = ['watching', 'ready', 'ascending']

    let phase = 'watching'
    let announced = false

    //* state
    // the whole verdict, or null when the save cannot be trusted. Ascension is
    // irreversible, so an untrusted save is a hard stop rather than something to
    // guess around: the positional scalar layout is version specific, and reading
    // cookiesReset out of the wrong offset would mean ascending on a made-up number.
    function state() {
        const s = save.get()
        if (!s.ok || !s.scalars || s.stale) return null

        const verdict = worthAscending(s.scalars)
        return {
            ...verdict,
            ascensions: s.scalars.resets || 0,
            chipsBanked: s.scalars.heavenlyChips || 0,
            // how many more cookies this run needs before the target is met, in the
            // same unit everything else in the panel is in
            cookiesToTarget: remaining(verdict, s.scalars),
            phase
        }
    }

    //* remaining
    // cookies still to bake before the plan is satisfied. zero once it is.
    function remaining(verdict, scalars) {
        if (verdict.ready) return 0
        const wanted = verdict.target === null ? verdict.current * 2 : verdict.target
        const need = cookiesFor(wanted)
        const have = (scalars.cookiesReset || 0) + (scalars.cookiesEarned || 0)
        return Math.max(0, need - have)
    }

    function setPhase(next) {
        if (phase === next) return
        if (PHASES.indexOf(next) === -1) return
        phase = next
        store.set('ascendPhase', next)
    }

    function tick() {
        const s = state()
        if (!s) {
            window.__alakazam.ascend = { phase, blocked: 'save not trustworthy' }
            return
        }

        // the target coming and going is a real transition, not noise: production
        // is monotonic within a run, so once it is met it stays met
        if (s.ready && phase === 'watching') setPhase('ready')
        if (!s.ready && phase === 'ready') setPhase('watching')

        if (s.ready && !announced) {
            announced = true
            console.log(
                `Alakazam: ascending is worth it now, ${Math.round(s.chipsGained)} heavenly ` +
                    `chip(s) for ascension ${s.ascensions + 1}. ${s.why}.`
            )
        }
        if (!s.ready) announced = false

        window.__alakazam.ascend = { ...s, phase }
    }

    function setup() {
        // resume whatever phase the last page load left behind
        const saved = store.get('ascendPhase', 'watching')
        if (PHASES.indexOf(saved) !== -1) phase = saved
    }

    registry.register({ name: 'ascend', interval: INTERVAL_MS, setup, tick })

    window.Alakazam.ascend = { state, PHASES }
})()
