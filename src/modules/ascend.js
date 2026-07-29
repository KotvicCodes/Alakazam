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
    // The pre-ascension loans and the timing rule that keeps it from ascending in
    // the middle of a boost land in the next commit, in front of `ascending`.

    const { save, store, registry, catalog } = window.Alakazam
    const { worthAscending, cookiesFor } = window.Alakazam.strategy.ascend
    const { priority, COST, PERMANENT_PICKS, normalise } = window.Alakazam.data.heavenly
    const act = window.Alakazam.act.ascend

    const INTERVAL_MS = 5000

    // the ascend screen redraws its whole tree after every purchase, so a click has
    // to be given time to land before the next scan
    const REDRAW_MS = 250

    // one tick never spends longer than this on the tree, so a slow game cannot
    // turn a shopping pass into a frozen page
    const SLICE_MS = 2000

    //* Phases
    // The run's position in the ascension sequence. It is a single value rather
    // than a set of booleans because these are genuinely exclusive: the sequence
    // ends the run, so there is never more than one of them in flight.
    //
    //   watching   nothing to do; the target is not met yet
    //   ready      the target is met, waiting for a clean moment to start
    //   ascending  committed: clicking through the Legacy prompt
    //   shopping   on the ascension screen, spending chips on the plan
    //   returning  shopping is done, clicking Reincarnate
    //
    // It is persisted per save so that a page reload part way through resumes
    // rather than leaving the game parked on the ascension screen.
    const PHASES = ['watching', 'ready', 'ascending', 'shopping', 'returning']

    let phase = 'watching'
    let announced = false

    //! Waiting for the save to catch up
    // The save lags. It is rewritten on autosave, up to a minute apart, and this
    // module polls a copy that is itself a couple of seconds behind that.
    //
    // Everywhere else that is harmless. Here it is not. The instant a run ends, the
    // last save still describes the run that just finished: still holding a lifetime
    // of cookies, still saying the target is met. Acting on it would ascend a brand
    // new run with nothing in it, immediately, and go round again.
    //
    // So the reset count from just before the ascension is remembered, and nothing
    // starts again until the save reports a higher one. That is the only signal that
    // what is being read is the new run rather than an echo of the old one.
    let awaitingReset = null

    // crates whose name could not be read, or that were clicked without the chip
    // count moving. either way there is no point going back to them this visit.
    let skipped = new Set()
    let bought = []

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

    function awaitReset(count) {
        if (awaitingReset !== null) return
        awaitingReset = count
        store.set('ascendAwaitReset', count)
    }

    function clearAwait() {
        awaitingReset = null
        store.forget('ascendAwaitReset')
    }

    //! Naming a heavenly crate
    // The tree renders icons, not names. The name behind a crate comes from its
    // tooltip, which costs a hover, so it is cached against the crate's data-id.
    //
    // The cache is keyed by game version as well. Heavenly upgrade ids are stable
    // within a version and are not promised to be across them, and a wrong name is
    // worse here than no name: it would spend a tier's worth of chips on the wrong
    // upgrade. On a version change the cache is simply rebuilt.

    function nameCache() {
        const s = save.get()
        const version = (s && s.version) || 'unknown'
        const held = store.get('heavenlyNames', null)
        if (!held || held.version !== version) return { version, names: {} }
        return held
    }

    async function nameOf(crate) {
        const cache = nameCache()
        if (cache.names[crate.id]) return cache.names[crate.id]

        const tip = await catalog.readTooltip(crate.element)
        // the hover mutex is held by the catalog module; try again next tick
        if (!tip || !tip.name) return null

        cache.names[crate.id] = normalise(tip.name)
        store.set('heavenlyNames', cache)
        return cache.names[crate.id]
    }

    //! Shopping
    // The plan is one flat ordered list, so the rule is simply "the earliest thing
    // on the list that is on screen and affordable". The tree's own prerequisites
    // do the rest: an upgrade whose parents are unbought is ghosted, act/ascend
    // drops it, and it reappears once its parent has been bought.

    // `complete` says whether every crate on screen was actually examined. It is
    // false when the slice ran out or a crate could not be named, and the caller
    // uses it to tell "nothing left to buy" apart from "not finished looking".
    async function bestCrate(available, until) {
        let best = null
        let complete = true

        for (const crate of act.crates()) {
            // naming an unseen crate costs a hover, and the first visit to a full
            // tree has a lot of them. bail out on the slice and come back next tick
            // with whatever was learned already cached.
            if (Date.now() > until) {
                complete = false
                break
            }
            if (skipped.has(crate.id)) continue

            const name = await nameOf(crate)
            if (name === null) {
                // the hover lock is held by the catalog module. not knowing what
                // this crate is is exactly the case that must not read as "done"
                complete = false
                continue
            }

            const rank = priority(name)
            // off-plan upgrades are never bought: chips spent on one are chips the
            // next tier's centrepiece does not get
            if (!Number.isFinite(rank)) {
                skipped.add(crate.id)
                continue
            }
            if (COST[name] > available) continue
            if (!best || rank < best.rank) best = { ...crate, name, rank }
        }

        return { crate: best, complete }
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    //* fillSlot
    // A permanent upgrade slot opens a picker instead of buying anything. Take the
    // first preference that is on offer; if none of them are, cancel out rather
    // than committing the slot to whatever happened to be first in the list, since
    // the slot can be reassigned at any later ascension but not this run.
    async function fillSlot() {
        if (!act.promptIs('permanent')) return false

        const choices = act.permanentChoices()
        let picked = null
        for (const want of PERMANENT_PICKS) {
            for (const choice of choices) {
                const name = await nameOf(choice)
                if (name === want) {
                    picked = choice
                    break
                }
            }
            if (picked) break
        }

        if (!picked) {
            console.log('Alakazam: no preferred permanent upgrade on offer, leaving the slot empty')
            // back out rather than leaving the picker open. It is modal as far as
            // the tree is concerned, so anything left unbought would wait behind it
            // for the rest of the ascension.
            act.cancelPrompt('permanent')
            return false
        }

        act.pickPermanent(picked)
        await wait(REDRAW_MS)
        return act.confirmPrompt('permanent')
    }

    //! shop
    // One pass over the tree, bounded by a time slice.
    //
    // The return value is three-valued rather than a boolean, and that matters more
    // than it looks. The caller reincarnates when shopping reports it is finished,
    // and finishing the run is not undoable, so "I ran out of time" and "there is
    // nothing left worth buying" must never collapse into the same answer. A first
    // visit to a full tree has dozens of crates whose names are not cached yet, at
    // a hover each, and it takes several passes to work through them. Reporting
    // that as "done" would reincarnate with the chips still unspent.
    //
    //   'bought'  something was bought; come straight back
    //   'busy'    out of time, or waiting on the hover lock; come back
    //   'done'    every crate on screen was named and none is worth buying
    async function shop() {
        const until = Date.now() + SLICE_MS
        let any = false

        while (Date.now() < until) {
            // a picker left open from the previous purchase blocks everything else
            if (act.promptIs('permanent')) {
                await fillSlot()
                await wait(REDRAW_MS)
                continue
            }

            const before = act.chips()
            if (!Number.isFinite(before)) return 'busy'

            const scan = await bestCrate(before, until)
            if (!scan.crate) {
                if (any) return 'bought'
                return scan.complete ? 'done' : 'busy'
            }

            act.buy(scan.crate)
            await wait(REDRAW_MS)

            // The chip counter is the only honest confirmation that a purchase
            // happened. A crate can look buyable and refuse: the game checks
            // affordability inside its own handler, and the tree does not redraw on
            // a refusal. Without this check a crate we cannot actually afford would
            // be clicked forever.
            const after = act.chips()
            if (Number.isFinite(after) && after < before) {
                bought.push(scan.crate.name)
                any = true
            } else if (!act.promptIs('permanent')) {
                skipped.add(scan.crate.id)
            }
        }
        return any ? 'bought' : 'busy'
    }

    //! The sequence

    async function drive(s) {
        // the animations are dead time in both directions
        if (act.animating()) return

        if (phase === 'ready') {
            // arriving on the ascend screen without going through the prompt means
            // the player started it themselves; join in rather than fight them
            if (act.onAscendScreen()) {
                awaitReset(s.ascensions)
                setPhase('shopping')
                return
            }
            console.log(
                `Alakazam: ascending for ${Math.round(s.chipsGained)} heavenly chip(s). ${s.why}.`
            )
            // the last moment the save is certain to describe the run being left
            awaitReset(s.ascensions)
            setPhase('ascending')
            act.openLegacy()
            return
        }

        if (phase === 'ascending') {
            if (act.onAscendScreen()) {
                skipped = new Set()
                bought = []
                setPhase('shopping')
                return
            }
            // the prompt names itself, so this can never confirm anything else
            if (act.promptIs('ascend')) {
                act.confirmPrompt('ascend')
                return
            }
            // no prompt and no ascend screen: the click was lost, or the player
            // closed it. open it again rather than sitting here.
            act.openLegacy()
            return
        }

        if (phase === 'shopping') {
            if (!act.onAscendScreen()) {
                // the player reincarnated by hand while we were shopping
                setPhase('watching')
                return
            }
            // only 'done' reincarnates: see the note on shop()
            if ((await shop()) !== 'done') return
            console.log(
                bought.length > 0
                    ? `Alakazam: bought ${bought.join(', ')}, reincarnating.`
                    : 'Alakazam: nothing on the plan is affordable, reincarnating.'
            )
            setPhase('returning')
            return
        }

        if (phase === 'returning') {
            if (!act.onAscendScreen()) {
                setPhase('watching')
                announced = false
                return
            }
            if (act.promptIs('reincarnate')) {
                act.confirmPrompt('reincarnate')
                return
            }
            act.reincarnate()
        }
    }

    async function tick() {
        const s = state()
        if (!s) {
            window.__alakazam.ascend = { phase, blocked: 'save not trustworthy' }
            return
        }

        // an ascension has happened and the save has not admitted it yet
        if (awaitingReset !== null && s.ascensions > awaitingReset) clearAwait()
        const echo = awaitingReset !== null && phase === 'watching'

        // the target coming and going is a real transition, not noise: production
        // is monotonic within a run, so once it is met it stays met
        if (s.ready && !echo && phase === 'watching') setPhase('ready')
        if (!s.ready && phase === 'ready') setPhase('watching')

        if (echo) {
            window.__alakazam.ascend = { ...s, phase, waitingForSave: true }
            return
        }

        if (s.ready && !announced) {
            announced = true
            console.log(
                `Alakazam: ascending is worth it now, ${Math.round(s.chipsGained)} heavenly ` +
                    `chip(s) for ascension ${s.ascensions + 1}. ${s.why}.`
            )
        }
        if (!s.ready) announced = false

        window.__alakazam.ascend = { ...s, phase, bought: bought.slice() }

        // Once committed, the sequence runs on its own: the save is up to a minute
        // stale and stops describing the run at all the moment the ascension starts,
        // so `s` is only consulted for the decision, never for the screen.
        if (phase !== 'watching') await drive(s)
    }

    function setup() {
        // resume whatever phase the last page load left behind
        const saved = store.get('ascendPhase', 'watching')
        if (PHASES.indexOf(saved) !== -1) phase = saved
        const pending = store.get('ascendAwaitReset', null)
        if (typeof pending === 'number') awaitingReset = pending
    }

    registry.register({ name: 'ascend', interval: INTERVAL_MS, setup, tick })

    window.Alakazam.ascend = { state, shop, nameOf, PHASES }
})()
