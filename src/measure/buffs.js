// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Buff Measurement
    // What is currently boosting (or suppressing) production, by name, with the
    // time left on it.
    //
    //! Why this file exists
    // A buff renders as an icon and nothing else. The game builds it as
    //
    //   <div id="buff3" class="crate enabled buff" style="background-position:...">
    //     <div class="pieTimer" id="buffPieTimer3" style="background-position:..."></div>
    //   </div>
    //
    // There is no name in it, no countdown, no text at all. Everything a reader
    // would want is either in a tooltip attribute or encoded in a sprite offset.
    //
    // measure/live.js was reading `innerText` off these elements and matching the
    // result against a list of buff names. That can only ever have matched the
    // empty string, which means hasProductionBuff() has always returned false and
    // every decision resting on it has been running blind: the grimoire never
    // timed a Force the Hand of Fate against a frenzy, and the shimmer module's
    // "do not click a wrath cookie mid-buff" guard never fired.
    //
    //! What is actually readable
    // The name comes from the tooltip, which costs a hover, so it is cached per
    // buff element. Element ids are unique per buff instance and a buff element is
    // thrown away when it expires, so the cache can never hand back a stale name.
    // Icons cannot be used as the key: "Loan 1" and "Loan 1 (interest)" are drawn
    // with the same one, and those two mean opposite things.
    //
    // The time left is in the pie timer. The game writes
    //
    //   T = (1 - time/maxTime) * 144
    //   backgroundPosition = -(T % 18)*48 px, -floor(T/18)*48 px
    //
    // so the sprite offset is the fraction of the buff that has elapsed, in 144
    // steps. That is a fraction rather than a duration, and turning it into seconds
    // needs the buff's total length, which only the caller knows. For a forty
    // second buff a step is under three tenths of a second, which is ample for
    // deciding whether there is time to act.

    const { catalog, registry } = window.Alakazam

    const TICK_MS = 500

    // the pie timer sprite sheet: 144 frames laid out 18 to a row, 48px cells
    const TIMER_COLUMNS = 18
    const TIMER_STEPS = 144
    const CELL = 48

    //* PRODUCTION_BUFFS
    // the buffs that multiply cookies per second. Moved here from measure/live.js,
    // where it was being tested against text that is never present.
    //
    // Loans are deliberately absent. They are production buffs by any reasonable
    // definition, but everything that asks this question is asking "is something
    // good happening that I should not interrupt", and the ascension planner takes
    // loans on purpose and then interrupts them on purpose. It has its own reading.
    const PRODUCTION_BUFFS =
        /frenzy|dragon harvest|building special|high-five|congregation|luxuriant harvest|ore vein|oiled-up|juicy profits|fervent adoration|manabloom|delicious lifeforms|breakthrough|righteous cataclysm|golden ages|extra cycles|solar flare|winning streak|macrocosm|refactoring|cosmic nursery|brainstorm|deliciousness|click frenzy|cursed finger|elder frenzy|devastation|sugar frenzy/i

    // element id -> name. instances are unique and short lived, so this only grows
    // by one entry per buff that has ever been on screen this page load.
    const names = new Map()

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
            name: names.get(el.id) || null,
            progress: progressOf(el)
        }))
    }

    //* named
    // buffs whose name matches, ignoring any that have not been identified yet.
    // Callers wanting "is anything good running" should prefer hasProductionBuff.
    function named(pattern) {
        return active().filter(b => b.name && pattern.test(b.name))
    }

    function hasProductionBuff() {
        return named(PRODUCTION_BUFFS).length > 0
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
            if (!el.id || names.has(el.id)) continue
            const tip = await catalog.readTooltip(el)
            // the lock is held elsewhere, or the tooltip has not drawn: try again
            if (!tip) return
            const name = tip.name || (tip.text || '').split('\n')[0].trim()
            if (name) names.set(el.id, name)
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
        PRODUCTION_BUFFS
    }
})()
