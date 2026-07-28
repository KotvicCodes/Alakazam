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

    const { simulateClick } = window.Alakazam.input
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

    // the news ticker has three separate achievements at increasing click counts,
    // and the highest is well into the hundreds. clicks are spread across sessions
    // rather than hammered in one go, and the running total is remembered.
    const TICKER_TARGET = 1000
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
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    //! One-off routines
    // each declares what has to exist before it is worth trying. `run` is async so
    // it can let a menu draw before reaching into it, which the synchronous
    // versions of these never did.

    //* typeInto
    // fill a text field the way a user would: set the value and fire input/change
    function typeInto(el, text) {
        if (!el) return
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
    }

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

    //* God complex: rename the bakery to "Orteil", then to "Alakazam"
    // Renaming to Orteil is what unlocks the achievement; renaming to Alakazam
    // afterwards is deliberate branding, not an accident. This runs once per save
    // and never again, so it will not keep overwriting a name you set yourself.
    async function godComplex() {
        simulateClick(document.getElementById('bakeryName'))
        await wait(MENU_MS)
        const input = document.getElementById('bakeryNameInput')
        if (!input) return false
        typeInto(input, 'Orteil')
        simulateClick(document.getElementById('promptOption0'))

        await wait(600)
        simulateClick(document.getElementById('bakeryName'))
        await wait(MENU_MS)
        typeInto(document.getElementById('bakeryNameInput'), 'Alakazam')
        simulateClick(document.getElementById('promptOption0'))
        return true
    }

    const ONE_OFFS = [
        { name: 'statsPanel', run: statsPanel, ready: () => !!statsButton() },
        { name: 'oldenDays', run: oldenDays, ready: () => !!logButton() },
        {
            name: 'godComplex',
            run: godComplex,
            ready: () => !!document.getElementById('bakeryName')
        }
    ]

    //! Running them

    // one at a time: they all drive the same menus and would fight each other
    let running = false

    // opening a menu is visible and mildly annoying, so a routine that has to be
    // retried waits rather than going again on the very next tick
    let nextAttemptAt = 0

    async function runPending() {
        if (running || pending.length === 0) return
        if (Date.now() < nextAttemptAt) return
        running = true
        try {
            // every routine that is ready gets its turn this tick, one after the
            // other. doing just one per tick would drag the whole hunt out over
            // most of a minute, and a routine that keeps deferring would hold up
            // all the ones behind it.
            const queue = pending.slice()
            pending = []

            for (const job of queue) {
                if (!job.ready()) {
                    // the menu it needs is not even drawn yet, so this is not an
                    // attempt at all: hold it back and look again next tick
                    pending.push(job)
                    continue
                }

                let worked = false
                try {
                    worked = await job.run()
                } catch (err) {
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
                } else if (giveUp(job.name)) {
                    console.log(`Alakazam: done trying "${job.name}" for this save`)
                } else {
                    console.log(`Alakazam: "${job.name}" found nothing to click, will retry later`)
                    pending.push(job)
                }
            }
            if (pending.length > 0) nextAttemptAt = Date.now() + RETRY_COOLDOWN_MS
        } finally {
            running = false
        }
    }

    function setup() {
        pending = ONE_OFFS.filter(job => !giveUp(job.name))
        if (pending.length === 0) {
            console.log('Alakazam: achievement routines already done for this save')
            return
        }
        console.log(`Alakazam: ${pending.length} achievement routine(s) to try for this save`)
    }

    //! Ongoing work

    //* tickerTarget
    // The news ticker is two stacked text layers, #commentsText1 and
    // #commentsText2, that the game swaps between as the news rotates. Clicking a
    // particular layer is unreliable: half the time it is the hidden one, and
    // clicking the ticker advances the news, which swaps the nodes underneath.
    //
    // So aim at the stable container instead and let the event bubble, which is
    // what happens when a player clicks the ticker anyway.
    function tickerTarget() {
        return (
            document.getElementById('comments') ||
            document.getElementById('commentsText') ||
            document.getElementById('commentsText1')
        )
    }

    function tickerText() {
        const el = document.getElementById('commentsText') || tickerTarget()
        return el ? el.innerText : ''
    }

    //* clickTicker
    // The ticker achievements are pure persistence, but only clicks the game
    // actually registers count, and it registers at most one per news item.
    // Firing a dozen clicks into the same millisecond therefore did almost
    // nothing: the counter here climbed to its target while the game had seen a
    // handful. Now each click is given a moment to land and is only counted when
    // the news item actually changed, which is the observable proof it registered.
    async function clickTicker() {
        if (store.get('tickerClicks', 0) >= TICKER_TARGET) return

        // if clicks never seem to register, stop rather than poking forever
        const tries = store.get('tickerTries', 0)
        if (tries > TICKER_MAX_TRIES && store.get('tickerClicks', 0) === 0) return

        for (let i = 0; i < TICKER_PER_TICK; i++) {
            const target = tickerTarget()
            if (!target) return
            const before = tickerText()
            simulateClick(target)
            await wait(TICKER_GAP_MS)
            store.set('tickerTries', store.get('tickerTries', 0) + 1)
            if (tickerText() !== before) {
                store.set('tickerClicks', store.get('tickerClicks', 0) + 1)
            }
        }
    }

    //* closeNotes
    // the achievement popups stack up and cover the store. dismissing them is what
    // a player does anyway, and it keeps the elements we click unobstructed.
    function closeNotes() {
        document.querySelectorAll('#notes .note .close').forEach(el => simulateClick(el))
    }

    async function tick() {
        await runPending()
        await clickTicker()
        closeNotes()

        const s = save.get()
        window.__alakazam.achievements = {
            won: save.achievementsWon(),
            known: s.ok && s.achievements ? s.achievements.length : 0,
            tickerClicks: store.get('tickerClicks', 0),
            tickerTries: store.get('tickerTries', 0),
            waiting: pending.map(j => j.name),
            attempts: ONE_OFFS.map(j => `${j.name}:${attempts(j.name)}`)
        }
    }

    registry.register({ name: 'achievements', interval: INTERVAL_MS, setup, tick })

    window.Alakazam.achievements = { ONE_OFFS, attempts, giveUp, MAX_ATTEMPTS }
})()
