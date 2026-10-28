// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Buff Measurement
    // live buff instances render an icon and pie timer, with a localized heading
    // available only through their tooltip. Canonical identities come from the
    // supported heading catalog; unknown effects suspend guarded actions.
    //
    // The timer encodes elapsed time in 144 steps on an 18-column, 48px grid.
    // It supplies a fraction; a caller needs the total duration to get seconds.

    const { catalog, registry } = window.Alakazam

    const TICK_MS = 500

    // the pie timer sprite sheet: 144 frames laid out 18 to a row, 48px cells
    const TIMER_COLUMNS = 18
    const TIMER_STEPS = 144
    const CELL = 48

    const { identify: canonicalEffect } = window.Alakazam.data.effects

    // node identity avoids reusing cached names when a reset reuses buff0, and
    // allows old instances to be collected after removal.
    const names = new WeakMap()

    function elements() {
        const out = []
        document.querySelectorAll('#buffs .buff').forEach(el => out.push(el))
        return out
    }

    //* offsetOf
    // the two pixel values out of a background-position, as positive cell indices
    function offsetOf(el) {
        const pos = (el && el.style && el.style.backgroundPosition) || ''
        const found = pos.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px/)
        if (!found) return null
        return {
            column: Math.round(-parseFloat(found[1]) / CELL),
            row: Math.round(-parseFloat(found[2]) / CELL)
        }
    }

    //* progressOf
    // how much of the buff has elapsed, 0 to 1.
    //
    // The pie timer is added on the game's first logic frame after the buff
    // appears, so for a fraction of a second there is not one. A buff that new has
    // effectively none of itself elapsed, which is what the zero says.
    function progressOf(el) {
        const timer = el && el.querySelector ? el.querySelector('.pieTimer') : null
        if (!timer) return 0
        const at = offsetOf(timer)
        if (!at) return 0
        const step = at.row * TIMER_COLUMNS + at.column
        if (!Number.isFinite(step)) return 0
        return Math.min(1, Math.max(0, step / TIMER_STEPS))
    }

    //* active
    // every buff on screen, with whatever is known about it. `name` is null until
    // the tooltip has been read, which the tick below does within half a second.
    function active() {
        return elements().map(el => ({
            id: el.id || '',
            element: el,
            name: names.get(el) || null,
            effect: canonicalEffect(names.get(el)),
            progress: progressOf(el)
        }))
    }

    //* named
    // match canonical names so loans and gift cooldowns work across locales.
    // Safety callers use blocksAscension/guardStatus, which include unknowns.
    function named(pattern) {
        return active().filter(b => b.effect && pattern.test(b.effect.name))
    }

    function hasProductionBuff() {
        return active().some(b => b.effect && b.effect.production)
    }

    function guardStatus() {
        const all = active()
        const unknown = all.find(b => !b.effect)
        const protectedEffect = all.find(b => b.effect && b.effect.protect)
        return {
            blocked: !!unknown,
            reason: unknown
                ? 'Ascension and spell actions suspended: effect "' +
                  (unknown.name || 'unidentified') +
                  '" has no supported canonical identity.'
                : protectedEffect
                  ? 'Waiting for ' + protectedEffect.effect.name + ' to end.'
                  : '',
            protected: !!protectedEffect
        }
    }

    function blocksAscension() {
        const status = guardStatus()
        return status.blocked || status.protected
    }

    function hasSpellComboBuff() {
        const all = active()
        // FTHOF removes click frenzy from its outcome pool during Dragonflight.
        // Protect that effect, but keep magic for the next production combo.
        return (
            !all.some(b => !b.effect || b.effect.key === 'dragonflight') &&
            all.some(b => b.effect.production)
        )
    }

    //* remaining
    // seconds left on a named buff, given how many seconds it runs in total. The
    // total has to come from the caller because the element does not carry it: the
    // pie timer is a fraction, not a clock.
    //
    // Returns NaN when no such buff is running, which is a different answer from
    // zero and callers have to treat it that way.
    function remaining(pattern, totalSeconds) {
        const found = named(pattern)[0]
        if (!found || !Number.isFinite(totalSeconds)) return NaN
        return Math.max(0, totalSeconds * (1 - found.progress))
    }

    //! Naming
    // one hover per buff that has never been seen, behind the catalog's mutex

    async function identify() {
        for (const el of elements()) {
            if (!el.id || names.has(el)) continue
            const tip = await catalog.readTooltip(el, window.Alakazam.safety.scope('buffs'))
            // the lock is held elsewhere, or the tooltip has not drawn: try again
            if (!tip) return
            const name = tip.name || (tip.text || '').split('\n')[0].trim()
            if (name) names.set(el, name)
            // one per tick keeps this off the critical path; buffs are few and
            // last long enough that there is no hurry
            return
        }
    }

    function tick() {
        return identify()
    }

    // gated on the master switch rather than a setting of its own: this measures,
    // it never acts, and several modules read from it
    registry.register({ name: 'buffs', interval: TICK_MS, setting: 'enabled', tick })

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.buffs = {
        active,
        named,
        hasProductionBuff,
        remaining,
        progressOf,
        blocksAscension,
        hasSpellComboBuff,
        guardStatus
    }
})()
