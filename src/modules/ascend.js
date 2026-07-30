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
    //! When, not just whether
    // Meeting the target is only half the decision. Ascending in the middle of a
    // boost throws the boost away: a frenzy is three or four minutes of multiplied
    // production and the cookies it would have made count toward prestige, so
    // pulling the lever mid-frenzy is strictly worse than pulling it four minutes
    // later. So a met target waits for a clean moment.
    //
    // Loans invert that rule, and the inversion is the point. A loan is a boost now
    // paid for with a penalty later, and the penalty belongs to the run, so ending
    // the run before it lands is how the trade is won rather than lost. The
    // sequence therefore is: wait out anything that is already running, take every
    // loan on offer, earn under the stacked multiplier, and ascend in the last
    // seconds before the shortest loan expires and its interest begins.
    //
    // That last step is also the game's "Debt evasion" achievement.

    const { save, store, registry, catalog, buffs } = window.Alakazam
    const { worthAscending, cookiesFor } = window.Alakazam.strategy.ascend
    const { priority, COST, PERMANENT_PICKS, KITTEN, normalise } = window.Alakazam.data.heavenly
    const loanData = window.Alakazam.data.loans
    const act = window.Alakazam.act.ascend
    const loanAct = window.Alakazam.act.loans

    // Once the target is met this module is timing an ascension against a forty
    // second loan window, so it cannot be a slow poller. A tick is a save read and
    // a couple of DOM reads except during the sequence itself, so a second costs
    // nothing worth measuring.
    const INTERVAL_MS = 1000

    // the ascend screen redraws its whole tree after every purchase, so a click has
    // to be given time to land before the next scan
    const REDRAW_MS = 250

    // one tick never spends longer than this on the tree, so a slow game cannot
    // turn a shopping pass into a frozen page
    const SLICE_MS = 2000

    //* ASCEND_MARGIN_S
    // How much of the shortest loan window to leave unspent.
    //
    // Ascending takes a few real seconds: a click, a prompt, and a five second
    // animation before the ascension screen even appears. The buff has to still be
    // alive when the run actually ends, not when the button is pressed, so the
    // margin covers the animation with room to spare. Cutting it finer risks the
    // interest phase starting mid-ascension, which is the one outcome the whole
    // sequence exists to avoid.
    const ASCEND_MARGIN_S = 12

    //* HARVEST_FLOOR_S
    // and how little of it is worth waiting for. Below this the remaining boost is
    // worth less than the risk of missing the window, so it leaves immediately.
    const HARVEST_FLOOR_S = 15

    // if the loan buffs cannot be read at all, do not sit in the harvest phase
    // forever waiting for a signal that is not coming
    const HARVEST_TIMEOUT_MS = 45000

    //* Phases
    // The run's position in the ascension sequence. It is a single value rather
    // than a set of booleans because these are genuinely exclusive: the sequence
    // ends the run, so there is never more than one of them in flight.
    //
    //   watching   nothing to do; the target is not met yet
    //   ready      the target is met, waiting out any boost already running
    //   loans      taking every loan slot the bank offers, cheapest window last
    //   harvest    earning under the stacked loans until the window nearly closes
    //   ascending  committed: clicking through the Legacy prompt
    //   shopping   on the ascension screen, spending chips on the plan
    //   returning  shopping is done, clicking Reincarnate
    //
    // It is persisted per save so that a page reload part way through resumes
    // rather than leaving the game parked on the ascension screen.
    const PHASES = ['watching', 'ready', 'loans', 'harvest', 'ascending', 'shopping', 'returning']

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

    // loans taken during this pre-ascension sequence, and when the harvest started
    let taken = []
    let harvestFrom = 0

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
        // `prices` came later than `names`, so a cache without one is an old shape
        // and is rebuilt rather than read half way
        if (!held || held.version !== version || !held.prices) {
            return { version, names: {}, prices: {} }
        }
        return held
    }

    //* describe
    // a crate's name and the price its tooltip quotes, both cached together. The
    // price is what ranks the permanent slot picker: see fillSlot.
    async function describe(crate) {
        const cache = nameCache()
        if (cache.names[crate.id]) {
            return { name: cache.names[crate.id], price: cache.prices[crate.id] }
        }

        const tip = await catalog.readTooltip(crate.element)
        // the hover mutex is held by the catalog module; try again next tick
        if (!tip || !tip.name) return null

        cache.names[crate.id] = normalise(tip.name)
        cache.prices[crate.id] = Number.isFinite(tip.price) ? tip.price : null
        store.set('heavenlyNames', cache)
        return { name: cache.names[crate.id], price: cache.prices[crate.id] }
    }

    async function nameOf(crate) {
        const found = await describe(crate)
        return found ? found.name : null
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

    //* bestPermanent
    // Which of the offered upgrades to make permanent.
    //
    // The dearest kitten wins. Kittens multiply production by a figure that grows
    // with milk, milk grows with achievements, and achievements are the one thing
    // an ascension never takes away, so a kitten is worth strictly more in every
    // future run than it was in this one. Which kitten is the strongest depends
    // entirely on how far the save has come, and their tiers are three orders of
    // magnitude apart in price, so the price the crate's own tooltip quotes ranks
    // them without a table to keep up to date.
    //
    // The named list is the fallback, for the click multipliers and for a save
    // whose prices could not be read.
    function bestPermanent(choices) {
        // a price of zero is a tooltip that had nothing to say, not a free upgrade
        const priced = choices.filter(c => KITTEN.test(c.name) && c.price > 0)
        if (priced.length > 0) {
            return priced.reduce((best, c) => (c.price > best.price ? c : best))
        }
        for (const want of PERMANENT_PICKS) {
            const hit = choices.find(c => c.name === want)
            if (hit) return hit
        }
        return null
    }

    //* fillSlot
    // A permanent upgrade slot opens a picker instead of buying anything. Rank
    // what is on offer and take the best; if nothing on offer is worth a slot,
    // cancel out rather than committing it to whatever happened to be first in the
    // list, since the slot can be reassigned at any later ascension but not this
    // run.
    //
    // Every choice has to be named before any of them can be ranked, and a name
    // costs a hover. On a first ascension there are a great many of them, so this
    // shares the caller's time slice and simply comes back next tick with whatever
    // it learned cached.
    async function fillSlot(until) {
        if (!act.promptIs('permanent')) return false

        const choices = []
        for (const choice of act.permanentChoices()) {
            if (Date.now() > until) return false
            const found = await describe(choice)
            // the hover lock is held elsewhere. Ranking a partial list would pick
            // a weaker upgrade than the one we have not looked at yet.
            if (!found) return false
            choices.push({ ...choice, ...found })
        }

        const picked = bestPermanent(choices)
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
                await fillSlot(until)
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
            } else {
                // it looked buyable and refused. Whatever the reason, going back to
                // it is how a shopping pass turns into a loop that never finishes.
                skipped.add(scan.crate.id)
            }
        }
        return any ? 'bought' : 'busy'
    }

    //! Loans

    //* loanWindow
    // seconds left before the shortest loan taken this sequence expires and its
    // interest phase begins. NaN when that loan is not running, which happens both
    // before it is taken and if the buff cannot be identified.
    function loanWindow() {
        if (taken.indexOf(loanData.SHORTEST) === -1) return NaN
        const loan = loanData.byId(loanData.SHORTEST)
        return buffs.remaining(loanData.buffPattern(loan.id), loan.boostSeconds)
    }

    //* interestStarted
    // whether any loan has already flipped into its penalty half. If this is ever
    // true the sequence was too slow, and it is worth saying so out loud rather
    // than carrying on as if the plan had worked.
    function interestStarted() {
        return taken.some(id => buffs.named(loanData.interestPattern(id)).length > 0)
    }

    //* takeLoans
    // One loan per tick, in the order src/data/loans.js sets out, which is not
    // their numbering: the forty second one goes last so the window it opens is as
    // wide as possible. Returns whether there is still one to take.
    function takeLoans() {
        for (const id of loanData.ORDER) {
            if (taken.indexOf(id) !== -1) continue
            if (!loanAct.offered(id)) continue
            if (loanAct.take(id)) {
                taken.push(id)
                const loan = loanData.byId(id)
                console.log(
                    `Alakazam: took ${loan.name} for x${loan.multiplier} production, ` +
                        'and will ascend before the interest lands.'
                )
                return true
            }
        }
        return loanData.ORDER.some(id => taken.indexOf(id) === -1 && loanAct.offered(id))
    }

    //! The sequence

    //* hoardAtRisk
    // Wrinklers hold cookies that are returned when they are popped and lost when
    // the run ends. Alakazam cannot pop them, because they are drawn onto a canvas
    // rather than built as elements: see docs/ROADMAP.md item 1. Until that is
    // solved the only honest thing to do is say what is about to be lost.
    function hoardAtRisk() {
        const w = window.Alakazam.wrinklers ? window.Alakazam.wrinklers.state() : null
        return w && w.active > 0 ? w.hoard : 0
    }

    function commit(s, why) {
        const hoard = hoardAtRisk()
        if (hoard > 0) {
            console.warn(
                `Alakazam: ascending with wrinklers still on the cookie. Their hoard is lost. ` +
                    'Popping them is not something Alakazam can do yet (they are drawn on a ' +
                    'canvas, not clickable elements), so pop them by hand to keep it.'
            )
        }
        console.log(`Alakazam: ascending for ${Math.round(s.chipsGained)} heavenly chip(s). ${why}.`)
        // the last moment the save is certain to describe the run being left
        awaitReset(s.ascensions)
        setPhase('ascending')
        act.openLegacy()
    }

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

            // Do not leave in the middle of something good. Anything already
            // running is production that has been paid for and not yet collected,
            // and it is a few minutes at most.
            if (buffs.hasProductionBuff()) return

            // A buff is named from its tooltip, one per tick, so for up to a second
            // after one appears it is on screen but not yet identified. Treating
            // that as "nothing running" is how the sequence would start half a
            // second into a frenzy and throw the rest of it away. An unidentified
            // buff is a reason to wait, not a reason to go.
            if (buffs.active().some(b => !b.name)) return

            taken = []
            harvestFrom = 0
            setPhase('loans')
            return
        }

        if (phase === 'loans') {
            if (takeLoans()) return
            if (taken.length === 0) {
                // no bank, or every slot already spent. nothing to wait for.
                commit(s, s.why)
                return
            }
            harvestFrom = Date.now()
            setPhase('harvest')
            return
        }

        if (phase === 'harvest') {
            // Something has gone wrong if this is true: the run is now being
            // punished by a loan it was supposed to outrun. Leave immediately, and
            // say so, rather than sitting under the penalty.
            if (interestStarted()) {
                console.warn(
                    'Alakazam: a loan reached its interest phase before the ascension did. ' +
                        'Leaving now; the penalty dies with the run either way.'
                )
                commit(s, 'loan window missed')
                return
            }

            const left = loanWindow()
            if (Number.isFinite(left)) {
                // everything above the margin is production still worth collecting
                if (left > Math.max(ASCEND_MARGIN_S, HARVEST_FLOOR_S)) return
                commit(s, `${Math.round(left)}s left on the loan window`)
                return
            }

            // the loan buff could not be identified. Buffs are named from their
            // tooltips and that can be blocked by the player using the mouse, so
            // rather than wait for a signal that may never come, leave on a timer.
            if (Date.now() - harvestFrom > HARVEST_TIMEOUT_MS) {
                commit(s, 'loan window could not be read')
            }
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

        const window_ = loanWindow()
        window.__alakazam.ascend = {
            ...s,
            phase,
            bought: bought.slice(),
            loans: taken.slice(),
            loanWindow: Number.isFinite(window_) ? Math.round(window_) : null,
            // popping is not built yet, so this is the honest half: say what is
            // about to be thrown away rather than quietly throwing it away
            wrinklerHoard: hoardAtRisk()
        }

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

    window.Alakazam.ascend = { state, shop, nameOf, loanWindow, takeLoans, PHASES }
})()
