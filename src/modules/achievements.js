// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Achievement Hunt
    // One-off routines that unlock free achievements a human could also trigger by
    // poking the UI. All clicks route through simulateClick to honour fair-play.
    //
    // Getting the retry policy right here took two goes, and both failures are
    // worth remembering.
    //
    // Marking a routine done after a single run made a routine that silently
    // found nothing, which is what happens on a fresh save where the menus are
    // barely populated, never run again for that save.
    //
    // Then only counting an attempt when the routine found its target made the
    // opposite mistake: a routine whose target is simply not there, because the
    // achievement is already owned or the entry does not exist in this version,
    // went back on the queue and reopened the same menu every few seconds
    // forever. Visibly, and annoyingly.
    //
    // The rule that works: opening a menu is the costly, visible part, so it
    // counts as an attempt whether or not the target was inside. Finding the
    // target retires the routine immediately. Not finding it earns a retry, but
    // only a few, and only after a cooldown. A routine whose menu is not even
    // drawn yet costs nothing and is simply looked at again next tick.

    const { simulateClick, typeInto } = window.Alakazam.safety.input('achievements')
    const { save, store, registry } = window.Alakazam

    const INTERVAL_MS = 3000

    // how many real attempts a routine gets before it is left alone. attempts only
    // count when the UI was actually present, so this is not a timing budget.
    const MAX_ATTEMPTS = 4

    // the game builds its menus when you click, but give each one a beat to appear
    // before reaching inside it
    const MENU_MS = 350

    // how long to leave a routine alone before retrying it. reopening the stats
    // panel every few seconds is exactly the kind of thrashing this avoids.
    const RETRY_COOLDOWN_MS = 60000

    // Tabloid addiction is the only click-count achievement on the news ticker and
    // unlocks at 50 clicks. Stopping there matters: every manual click resets
    // Game.TickerAge, which suppresses the natural rotations that Fortune Cookies
    // only spawn on.
    const TICKER_TARGET = 50
    const TICKER_PER_TICK = 6

    // the game swaps the news item on each registered click, so leave a beat for
    // that to happen before checking whether it did
    const TICKER_GAP_MS = 120

    // if this many clicks go by without a single one registering, something about
    // the ticker has changed and hammering it forever helps nobody
    const TICKER_MAX_TRIES = 200

    let pending = []

    function attempts(name) {
        return store.get('attempts:' + name, 0)
    }

    function giveUp(name) {
        return attempts(name) >= MAX_ATTEMPTS
    }

    function countAttempt(name) {
        store.set('attempts:' + name, attempts(name) + 1)
    }

    function wait(ms) {
        return window.Alakazam.safety.wait('achievements', ms)
    }

    //! One-off routines
    // each declares what has to exist before it is worth trying. `run` is async so
    // it can let a menu draw before reaching into it, which the synchronous
    // versions of these never did.

    function statsButton() {
        return document.querySelector('#statsButton div')
    }

    function logButton() {
        return document.querySelector('#logButton div')
    }

    //* Stats panel: the tiny cookie and the "here you go" achievement slot
    // Both of these live in the stats panel, so they share one visit. Opening it
    // twice in a row for two clicks was needless churn on screen.
    async function statsPanel() {
        simulateClick(statsButton())
        await wait(MENU_MS)

        const tiny = document.querySelector('#statsGeneral .listing .price .tinyCookie')
        if (tiny) simulateClick(tiny)

        const slot = document.querySelector('[data-id="204"]')
        if (slot) simulateClick(slot)

        await wait(80)
        simulateClick(statsButton())
        return !!tiny && !!slot
    }

    //* Olden days: open the info log and click the credits entry
    async function oldenDays() {
        simulateClick(logButton())
        await wait(MENU_MS)
        const entry = document.querySelector('#oldenDays .icon')
        const found = !!entry
        simulateClick(entry)
        await wait(80)
        simulateClick(logButton())
        return found
    }

    //* God complex
    // Journal the live input before renaming. Recovery compares our last write
    // with the live name, so a later player rename always wins.
    const NAME_KEY = 'bakeryNameRecovery'
    let restoredName = null

    function finishNameRecovery(mark) {
        if (!store.ownsRecovery(NAME_KEY)) return
        const { savefile, identity, safety } = window.Alakazam
        const saved = savefile.read()
        if (
            saved.ok &&
            identity.fromSave(saved).legacyId === mark.legacyId &&
            saved.run?.bakeryName === mark.original
        ) {
            store.forget(NAME_KEY)
            restoredName = null
        } else {
            // A live restoration does not replace an earlier autosave of Orteil.
            if (JSON.stringify(mark) !== JSON.stringify(restoredName?.mark))
                store.set(NAME_KEY, { ...mark })
            restoredName = {
                mark: { ...mark },
                runId: identity.current().runId,
                revision: safety.revision('prompt'),
                unchanged: safety.cosmeticCheck()
            }
        }
    }

    function recoverName(runId, unchanged) {
        const { safety, identity } = window.Alakazam
        const mark = store.get(NAME_KEY, null)
        const who = identity.current()
        if (!mark || !who.known || mark.legacyId !== who.legacyId) return false
        if (!store.ownsRecovery(NAME_KEY)) return false
        // a cancelled task may undo its own run, never a replacement run
        if (runId && who.runId !== runId) return false
        if (unchanged && !unchanged()) return false
        // Imports can leave the journal and run unchanged while replacing the
        // live name. Check the label too: file loads do not use a prompt. An
        // already open prompt needs its actual input checked below.
        if (
            !mark.intervened &&
            restoredName &&
            restoredName.runId === who.runId &&
            restoredName.revision === safety.revision('prompt') &&
            restoredName.unchanged() &&
            JSON.stringify(mark) === JSON.stringify(restoredName.mark) &&
            !safety.prompt()
        ) {
            finishNameRecovery(mark)
            return true
        }
        const ctx = safety.scope('achievements')
        return ctx.cleanup(() => {
            const proven =
                restoredName?.runId === who.runId && restoredName.unchanged()
                    ? restoredName.unchanged
                    : safety.cosmeticIdentity(ctx, who)
            if (!proven) return false
            if (mark.intervened) {
                store.forget(NAME_KEY)
                return false
            }
            if (safety.prompt() && !safety.ownsPrompt('achievements', 'NameBakery')) return false
            if (!safety.prompt()) ctx.input('simulateClick', document.getElementById('bakeryName'))
            if (!proven() || !safety.ownsPrompt('achievements', 'NameBakery')) return false
            const input = document.getElementById('bakeryNameInput')
            if (!input) return false
            if (String(input.value) === mark.original) {
                ctx.input('simulateClick', document.getElementById('promptOption2'))
                finishNameRecovery(mark)
                return true
            }
            // an unsubmitted player edit is also a deliberate choice
            if (String(input.value) === mark.expected) {
                ctx.input('typeInto', input, mark.original)
                ctx.input('simulateClick', document.getElementById('promptOption0'))
                if (safety.prompt()) return false
                ctx.input('simulateClick', document.getElementById('bakeryName'))
                if (!safety.ownsPrompt('achievements', 'NameBakery')) return false
                const restored = document.getElementById('bakeryNameInput')
                const verified = restored && String(restored.value) === mark.original
                ctx.input('simulateClick', document.getElementById('promptOption2'))
                if (verified) finishNameRecovery(mark)
                return !!verified
            }
            // leave their new value intact, and dismiss only the prompt we opened
            const cancel = document.getElementById('promptOption2')
            if (cancel) ctx.input('simulateClick', cancel)
            store.forget(NAME_KEY)
            return false
        })
    }

    async function godComplex() {
        const { safety, identity } = window.Alakazam
        const ctx = safety.scope('achievements')
        const who = identity.current()
        if (!who.known || safety.prompt() || store.get(NAME_KEY, null)) return false
        if (!safety.cosmeticIdentity(ctx, who)) return false
        let unchanged = safety.cosmeticCheck()
        simulateClick(document.getElementById('bakeryName'))
        const ownedPrompt = safety.prompt()
        try {
            await wait(MENU_MS)
            if (!unchanged() || !safety.ownsPrompt('achievements', 'NameBakery')) return false
            const input = document.getElementById('bakeryNameInput')
            if (!input) return false
            if (store.get(NAME_KEY, null)) return false
            const original = String(input.value)
            const mark = { legacyId: who.legacyId, original, expected: 'Orteil' }
            if (!store.ownsRecovery(NAME_KEY, false)) {
                if (!(await store.claimRecovery(NAME_KEY, mark))) return false
                ctx.check()
                if (!unchanged() || identity.current().runId !== who.runId) return false
            }
            store.set(NAME_KEY, mark)
            // persist the undo record before any mutation can reach the game save
            if (!(await store.flush().catch(() => false))) return false
            ctx.check()
            if (!unchanged() || !store.ownsRecovery(NAME_KEY)) return false
            if (!safety.ownsPrompt('achievements', 'NameBakery') || String(input.value) !== original) {
                store.forget(NAME_KEY)
                return false
            }
            typeInto(input, 'Orteil')
            simulateClick(document.getElementById('promptOption0'))
            unchanged = safety.cosmeticCheck()
            await wait(600)
            return true
        } finally {
            try {
                recoverName(who.runId, unchanged)
            } finally {
                safety.dismissCosmeticPrompt(ctx, ownedPrompt)
            }
        }
    }

    //* Just wrong: sell a grandma once at least two are owned
    // Selling the last grandma locks Elder Pledge and collects wrinklers, so wait
    // until at least two are held before selling one.
    function grandmaCount() {
        const liveOwned = window.Alakazam.live?.readProducts().find(p => p.index === 1)?.owned
        if (Number.isFinite(liveOwned)) return liveOwned
        return save.building(1)?.amount || 0
    }

    function justWrongReady() {
        if (!window.Alakazam.act?.store?.available()) return false
        const phase = window.__alakazam?.ascend?.phase
        if (phase && phase !== 'watching') return false
        return grandmaCount() >= 2
    }

    async function justWrong() {
        if (!justWrongReady()) return false
        const ctx = window.Alakazam.safety.scope('achievements')
        let lease = null
        const deadline = Date.now() + MENU_MS
        while (!lease && Date.now() <= deadline) {
            ctx.check()
            lease = window.Alakazam.transactions.acquire('achievements', ctx)
            if (!lease) await wait(25)
        }
        if (!lease) return false
        try {
            if (!justWrongReady()) return false
            const grandma = window.Alakazam.live?.readProducts().find(p => p.index === 1) || {
                index: 1
            }
            const res = await window.Alakazam.act.store.sell(grandma, 1, lease)
            ctx.check()
            return res !== null && res !== false
        } finally {
            lease.release()
        }
    }

    const ONE_OFFS = [
        { name: 'statsPanel', run: statsPanel, ready: () => !!statsButton() },
        { name: 'oldenDays', run: oldenDays, ready: () => !!logButton() },
        {
            name: 'godComplex',
            run: godComplex,
            ready: () => !!document.getElementById('bakeryName')
        },
        { name: 'justWrong', run: justWrong, ready: justWrongReady }
    ]

    //! Running them

    // one at a time: they all drive the same menus and would fight each other
    let running = false

    // opening a menu is visible and mildly annoying, so a routine that has to be
    // retried waits rather than going again on the very next tick
    const retryAt = new Map()

    async function runPending() {
        if (running || pending.length === 0) return
        running = true
        try {
            // every routine that is ready gets its turn this tick, one after the
            // other. doing just one per tick would drag the whole hunt out over
            // most of a minute, and a routine that keeps deferring would hold up
            // all the ones behind it.
            const queue = pending.slice()
            pending = []

            for (const job of queue) {
                if (Date.now() < (retryAt.get(job.name) || 0) || !job.ready()) {
                    // the menu it needs is not even drawn yet, or it is still on
                    // cooldown from a previous attempt: hold it back for later
                    pending.push(job)
                    continue
                }

                let worked = false
                try {
                    worked = await job.run()
                } catch (err) {
                    if (window.Alakazam.safety.isCancellation(err)) {
                        pending.push(...queue.slice(queue.indexOf(job)))
                        throw err
                    }
                    console.warn(`Alakazam: achievement routine "${job.name}" failed`, err)
                }

                // Opening a menu is the expensive, visible part, and it happened
                // whether or not the thing we wanted was inside. So it counts as
                // an attempt either way. Only counting successes meant a routine
                // whose target simply is not there, because the achievement is
                // already owned or the entry does not exist in this version, sat
                // in the queue reopening the same menu every few seconds forever.
                countAttempt(job.name)

                if (worked) {
                    // found it: no reason to ever come back
                    store.set('attempts:' + job.name, MAX_ATTEMPTS)
                    retryAt.delete(job.name)
                } else if (giveUp(job.name)) {
                    console.log(`Alakazam: done trying "${job.name}" for this save`)
                    retryAt.delete(job.name)
                } else {
                    console.log(`Alakazam: "${job.name}" found nothing to click, will retry later`)
                    retryAt.set(job.name, Date.now() + RETRY_COOLDOWN_MS)
                    pending.push(job)
                }
            }
        } finally {
            running = false
        }
    }

    function setup() {
        recoverName()
        pending = ONE_OFFS.filter(job => !giveUp(job.name))
        if (pending.length === 0) {
            console.log('Alakazam: achievement routines already done for this save')
            return
        }
        console.log(`Alakazam: ${pending.length} achievement routine(s) to try for this save`)
    }

    //! Ongoing work

    //* tickerTarget
    // Cookie Clicker attaches its ticker click handler directly to #commentsText1
    // (Game.tickerL), not to #comments or #commentsText. Since DOM events bubble up
    // from child to ancestor and never down, clicks aimed at #comments miss the
    // listener in the real game. Prefer #commentsText1 and keep the outer containers
    // as fallbacks for simplified test DOMs.
    function tickerTarget() {
        return (
            document.getElementById('commentsText1') ||
            document.getElementById('commentsText') ||
            document.getElementById('comments')
        )
    }

    function tickerText() {
        const el =
            document.getElementById('commentsText1') ||
            document.getElementById('commentsText') ||
            tickerTarget()
        return el ? el.innerText : ''
    }

    //* hasFortune
    // Fortune cookies render a <span class="fortune"> inside the active ticker line.
    // Ignore #commentsText2 so the outgoing layer does not look like a second fortune
    // while it fades out after a click.
    function hasFortune() {
        const fortune =
            document.querySelector('#commentsText1 .fortune') ||
            document.querySelector('#comments .fortune')
        if (!fortune) return false
        const below = document.getElementById('commentsText2')
        return !(below && below.contains && below.contains(fortune))
    }

    //* clickTicker
    // The ticker achievement is pure persistence, but only clicks the game actually
    // registers count, and it registers at most one per news item. Firing a dozen
    // clicks into the same millisecond therefore did almost nothing: the counter
    // here climbed to its target while the game had seen a handful. Now each click
    // is given a moment to land and is only counted when the news item actually
    // changed, which is the observable proof it registered.
    //
    // Once Tabloid addiction is done, ordinary ticker clicking stops so manual
    // clicks do not keep resetting Game.TickerAge, but fortune headlines are still
    // clicked whenever they appear to unlock O Fortuna and the fortune upgrades.
    async function clickTicker() {
        const needClicks =
            store.get('tickerClicks', 0) < TICKER_TARGET &&
            !(store.get('tickerTries', 0) > TICKER_MAX_TRIES && store.get('tickerClicks', 0) === 0)
        if (!needClicks && !hasFortune()) return

        const steps = needClicks ? TICKER_PER_TICK : 1
        for (let i = 0; i < steps; i++) {
            if (i > 0 && store.get('tickerClicks', 0) >= TICKER_TARGET && !hasFortune()) break
            const target = tickerTarget()
            if (!target) return
            const fortune = hasFortune()
            const before = tickerText()
            simulateClick(target)
            await wait(TICKER_GAP_MS)
            store.set('tickerTries', store.get('tickerTries', 0) + 1)
            const changed = tickerText() !== before
            if (fortune && (!hasFortune() || changed)) {
                store.set('fortunesClicked', store.get('fortunesClicked', 0) + 1)
            }
            if (changed) {
                store.set('tickerClicks', store.get('tickerClicks', 0) + 1)
            }
            if (fortune && hasFortune()) break
        }
    }

    //* closeNotes
    // the achievement popups stack up and cover the store. dismissing them is what
    // a player does anyway, and it keeps the elements we click unobstructed.
    function closeNotes() {
        document.querySelectorAll('#notes .note .close').forEach(el => simulateClick(el))
    }

    async function tick() {
        recoverName()
        await runPending()
        await clickTicker()
        closeNotes()

        const s = save.get()
        window.__alakazam.achievements = {
            won: save.achievementsWon(),
            known: s.ok && s.achievements ? s.achievements.length : 0,
            tickerClicks: store.get('tickerClicks', 0),
            tickerTries: store.get('tickerTries', 0),
            fortunesClicked: store.get('fortunesClicked', 0),
            waiting: pending.map(j => j.name),
            attempts: ONE_OFFS.map(j => `${j.name}:${attempts(j.name)}`)
        }
    }

    registry.register({
        reset: () => {
            pending = []
            retryAt.clear()
            setup()
        },
        name: 'achievements',
        interval: INTERVAL_MS,
        setup,
        tick
    })

    window.Alakazam.achievements = {
        ONE_OFFS,
        attempts,
        giveUp,
        MAX_ATTEMPTS,
        TICKER_TARGET,
        tickerTarget,
        tickerText,
        clickTicker,
        justWrong,
        godComplex,
        recoverName
    }
})()
