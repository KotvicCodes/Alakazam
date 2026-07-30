// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Which Spirits
    // Pure arithmetic over measured income, the same shape as strategy/dragon.js, and
    // it exists for the same reason: the layout used to be one of three hand-written
    // presets picked by a single question, "is the autoclicker on".
    //
    // That question turned out to be the wrong one. The clicker layout leads with
    // Muridal, whose +15% clicking costs 3% of every building's output, and it is
    // only worth it while clicking is a large share of income. The game registers
    // about three clicks a second however many are dispatched, so after the opening
    // minutes of a run it never is. Meanwhile both spirits in the idle layout make
    // golden cookies rarer, by 10% and 15% at the diamond slot, and golden cookies
    // are a large share of income for something that clicks every one of them within
    // milliseconds. None of that was priced.
    //
    // So: score every layout on what has actually been measured, and let the answer
    // move when the run moves. There are ten usable spirits and three slots, which is
    // seven hundred and twenty layouts, which is nothing to enumerate.
    //
    //! Supreme Intellect
    // The dragon aura promotes each slot one tier, so the same layout pays more and
    // the best layout can change. That is the one real interaction between the
    // dragon and the temple, and it is why `promoted` is an input here rather than a
    // separate table.

    const { GODS, UNUSABLE, effectsOf, TIERS, nameOf } = window.Alakazam.data.gods

    // the same stated assumption strategy/dragon.js makes about kittens, for the
    // same reason: the milk multiplier is not rendered anywhere
    const KITTEN_SHARE = 0.15

    // Cyclius swings this far either side of nothing over its cycle
    const CYCLIUS_SWING = 0.15

    function usable() {
        return GODS.filter(g => UNUSABLE.indexOf(g.id) === -1).map(g => g.id)
    }

    //* termGain
    // one effect of one spirit at one tier, in cookies per second
    function termGain(term, tier, state) {
        const value = term.values[tier]
        const cps = state.cps || 0

        switch (term.kind) {
            case 'production':
                return { gain: value * cps, why: `${pct(value)} production` }
            case 'click':
                return { gain: value * (state.clickCps || 0), why: `${pct(value)} clicking` }
            case 'goldenRate':
                return { gain: value * (state.goldenCps || 0), why: `${pct(value)} golden cookies` }
            case 'goldenDuration':
                return {
                    gain: value * (state.buffBonusCps || 0),
                    why: `${pct(value)} buff duration`
                }
            case 'milk':
                return {
                    gain: value * KITTEN_SHARE * cps,
                    why: `${pct(value)} of an assumed ${pct(KITTEN_SHARE)} kitten share`,
                    assumed: true
                }
            case 'buildingCost':
                return {
                    gain: value * cps,
                    why: `${pct(value)} cheaper buildings, and nearly all income is spent`
                }
            case 'prestige':
                return {
                    gain: value * (state.prestigeShare || 0) * cps,
                    why: `${pct(value)} of the prestige share of production`
                }
            case 'wrinklerDigest':
                return {
                    gain: value * (state.wrinklerCps || 0),
                    why: state.wrinklerCps ? `${pct(value)} more in the wrinklers` : 'no wrinklers'
                }
            case 'wrinklerRate':
                // more wrinklers arrive sooner, which only matters up to the cap and
                // only if something harvests them. Not priced.
                return { gain: 0, why: 'faster wrinklers, not priced' }
            case 'cycle': {
                // a sine wave over `value` hours, so it is worth something now and
                // the opposite later. Scored at its current phase and flagged, since
                // riding it properly would cost a swap every few hours and there are
                // three swaps a day at best.
                const phase = Math.sin((Date.now() / 1000 / (60 * 60 * value)) * Math.PI * 2)
                return {
                    gain: CYCLIUS_SWING * phase * cps,
                    why: `${pct(CYCLIUS_SWING * phase)} right now, reversing over ${value}h`,
                    moving: true
                }
            }
            case 'clickPerSale':
                return { gain: 0, why: 'needs a selling combo, and nothing sells buildings' }
            case 'lumps':
                return { gain: 0, why: 'faster lumps, which are not income' }
            case 'seasonal':
                return { gain: 0, why: 'seasons are not switched' }
            default:
                return { gain: 0, why: 'no effect' }
        }
    }

    function pct(n) {
        return `${Math.round(n * 1000) / 10}%`
    }

    //* score
    // what a layout is worth. `slots` is [diamond, ruby, jade], -1 for empty.
    function score(slots, state) {
        const tiers = state.promoted ? TIERS.promoted : TIERS.plain
        const income = Math.max(1, (state.cps || 0) + (state.clickCps || 0))
        let gain = 0
        const terms = []
        let moving = false
        let assumed = false

        for (let slot = 0; slot < 3; slot++) {
            const god = slots[slot]
            if (god === -1 || god === undefined || god === null) continue
            for (const term of effectsOf(god)) {
                const out = termGain(term, tiers[slot], state)
                gain += out.gain
                if (out.moving) moving = true
                if (out.assumed) assumed = true
                if (out.gain !== 0 || out.why) {
                    terms.push({ god: nameOf(god), gain: out.gain, why: out.why })
                }
            }
        }

        return { slots: slots.slice(0, 3), gain, score: 1 + gain / income, terms, moving, assumed }
    }

    //* rank
    // every layout, best first. Empty slots are not candidates: a slot with anything
    // in it beats a slot with nothing, and the module fills all three at once when it
    // has the swaps for it.
    function rank(state, limit) {
        const ids = usable()
        const out = []
        for (const diamond of ids) {
            for (const ruby of ids) {
                if (ruby === diamond) continue
                for (const jade of ids) {
                    if (jade === diamond || jade === ruby) continue
                    out.push(score([diamond, ruby, jade], state))
                }
            }
        }
        out.sort((a, b) => b.gain - a.gain)
        return limit ? out.slice(0, limit) : out
    }

    //* best
    // the layout to aim for, with a sentence about why
    function best(state) {
        const top = rank(state, 1)[0]
        if (!top) return { slots: [-1, -1, -1], gain: 0, score: 1, why: 'no usable spirits', terms: [] }
        return {
            ...top,
            why: top.terms
                .filter(t => t.gain !== 0)
                .map(t => `${t.god} ${t.why}`)
                .join(', ')
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.strategy = window.Alakazam.strategy || {}
    window.Alakazam.strategy.pantheon = { score, rank, best, usable, KITTEN_SHARE }
})()
