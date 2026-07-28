// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Achievement Hunt
    // One-off routines that unlock free achievements a human could also trigger by
    // poking the UI. All clicks route through simulateClick to honour fair-play.
    //
    // These originally re-ran on every single page load, which was wasteful but
    // self-healing: a routine that failed because the game had not finished
    // drawing simply got another go next time. Recording them as done after one
    // run stopped the waste and threw away the healing with it. A routine that
    // silently found none of its elements, which is exactly what happens on a
    // fresh save where the menus are still nearly empty, was marked finished and
    // never attempted again.
    //
    // So a routine is now only considered attempted when its elements were
    // actually there, and it gets a few goes across page loads before being given
    // up on. Re-running one that already worked costs nothing: the achievement is
    // owned, and poking the menu again does nothing.

    const { simulateClick } = window.Alakazam.input
    const { save, store, registry } = window.Alakazam

    const INTERVAL_MS = 3000

    // how many real attempts a routine gets before it is left alone. attempts only
    // count when the UI was actually present, so this is not a timing budget.
    const MAX_ATTEMPTS = 4

    // the game builds its menus when you click, but give each one a beat to appear
    // before reaching inside it
    const MENU_MS = 350

    // the news ticker has three separate achievements at increasing click counts,
    // and the highest is well into the hundreds. clicks are spread across sessions
    // rather than hammered in one go, and the running total is remembered.
    const TICKER_TARGET = 1000
    const TICKER_PER_TICK = 12

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

    //* Tiny cookie: click the tiny cookie in the stats panel
    async function tinyCookie() {
        simulateClick(statsButton())
        await wait(MENU_MS)
        const tiny = document.querySelector('#statsGeneral .listing .price .tinyCookie')
        const found = !!tiny
        simulateClick(tiny)
        await wait(80)
        simulateClick(statsButton())
        return found
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

    //* Here you go: open stats and click a specific achievement slot
    async function hereYouGo() {
        simulateClick(statsButton())
        await wait(MENU_MS)
        const slot = document.querySelector('[data-id="204"]')
        const found = !!slot
        simulateClick(slot)
        await wait(80)
        simulateClick(statsButton())
        return found
    }

    const ONE_OFFS = [
        { name: 'tinyCookie', run: tinyCookie, ready: () => !!statsButton() },
        { name: 'oldenDays', run: oldenDays, ready: () => !!logButton() },
        {
            name: 'godComplex',
            run: godComplex,
            ready: () => !!document.getElementById('bakeryName')
        },
        { name: 'hereYouGo', run: hereYouGo, ready: () => !!statsButton() }
    ]

    //! Running them

    // one at a time: they all drive the same menus and would fight each other
    let running = false

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

                if (worked) {
                    countAttempt(job.name)
                    if (giveUp(job.name)) {
                        console.log(`Alakazam: done trying "${job.name}" for this save`)
                    }
                } else {
                    // the menu was there but what we needed inside it was not, so
                    // this does not count against the budget either: the game may
                    // still be filling it in, or the entry may not exist yet on a
                    // fresh save
                    console.log(`Alakazam: "${job.name}" had nothing to click yet, will retry`)
                    pending.push(job)
                }
            }
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

    //* clickTicker
    // the news ticker rewards sheer persistence rather than timing, so a few
    // clicks per tick get there without flooding anything
    function clickTicker() {
        const total = store.get('tickerClicks', 0)
        if (total >= TICKER_TARGET) return
        const comments = document.getElementById('commentsText1')
        if (!comments) return
        for (let i = 0; i < TICKER_PER_TICK; i++) simulateClick(comments)
        store.set('tickerClicks', total + TICKER_PER_TICK)
    }

    //* closeNotes
    // the achievement popups stack up and cover the store. dismissing them is what
    // a player does anyway, and it keeps the elements we click unobstructed.
    function closeNotes() {
        document.querySelectorAll('#notes .note .close').forEach(el => simulateClick(el))
    }

    async function tick() {
        await runPending()
        clickTicker()
        closeNotes()

        const s = save.get()
        window.__alakazam.achievements = {
            won: save.achievementsWon(),
            known: s.ok && s.achievements ? s.achievements.length : 0,
            tickerClicks: store.get('tickerClicks', 0),
            waiting: pending.map(j => j.name),
            attempts: ONE_OFFS.map(j => `${j.name}:${attempts(j.name)}`)
        }
    }

    registry.register({ name: 'achievements', interval: INTERVAL_MS, setup, tick })

    window.Alakazam.achievements = { ONE_OFFS, attempts, giveUp, MAX_ATTEMPTS }
})()
