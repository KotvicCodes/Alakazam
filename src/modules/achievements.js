// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Achievement Hunt
    // One-off routines that unlock free achievements a human could also trigger by
    // poking the UI. All clicks route through simulateClick to honour fair-play.
    //
    // These used to run again on every single page load, re-poking the same menus
    // forever. Now each routine is recorded against the save it was run for, so a
    // refresh does not repeat it. The save also carries the achievement bitfield,
    // so a routine can check whether it actually earned anything: if the total did
    // not move, it was either already held or it did not work, and either way it is
    // not worth trying again.
    //
    // The bitfield is used for counting rather than for naming. Achievement ids
    // shift as the game adds more, so mapping an index to a specific achievement
    // would quietly rot; counting does not.

    const { simulateClick } = window.Alakazam.input
    const { save, store, registry } = window.Alakazam

    const INTERVAL_MS = 3000

    // the news ticker has three separate achievements at increasing click counts,
    // and the highest is well into the hundreds. clicks are spread across sessions
    // rather than hammered in one go, and the running total is remembered.
    const TICKER_TARGET = 1000
    const TICKER_PER_TICK = 12

    let ranSetup = false

    function done(name) {
        return store.get('did:' + name, false)
    }

    function markDone(name) {
        store.set('did:' + name, true)
    }

    //! One-off routines

    //* typeInto
    // fill a text field the way a user would: set the value and fire input/change
    function typeInto(el, text) {
        if (!el) return
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
    }

    //* Olden days: open the info log and click the credits entry
    function oldenDays() {
        const logButton = document.querySelector('#logButton div')
        simulateClick(logButton)
        simulateClick(document.querySelector('#oldenDays .icon'))
        simulateClick(logButton)
    }

    //* God complex: rename the bakery to "Orteil", then to "Alakazam"
    // Renaming to Orteil is what unlocks the achievement; renaming to Alakazam
    // afterwards is deliberate branding, not an accident. This runs once per save
    // and never again, so it will not keep overwriting a name you set yourself.
    function godComplex() {
        simulateClick(document.getElementById('bakeryName'))
        typeInto(document.getElementById('bakeryNameInput'), 'Orteil')
        simulateClick(document.getElementById('promptOption0'))

        setTimeout(() => {
            simulateClick(document.getElementById('bakeryName'))
            typeInto(document.getElementById('bakeryNameInput'), 'Alakazam')
            simulateClick(document.getElementById('promptOption0'))
        }, 1000)
    }

    //* Here you go: open stats and click a specific achievement slot
    function hereYouGo() {
        const statsButton = document.querySelector('#statsButton div')
        simulateClick(statsButton)
        setTimeout(() => {
            simulateClick(document.querySelector('[data-id="204"]'))
            simulateClick(statsButton)
        }, 1000)
    }

    //* Tiny cookie: click the tiny cookie in the stats panel
    function tinyCookie() {
        const statsButton = document.querySelector('#statsButton div')
        simulateClick(statsButton)
        simulateClick(document.querySelector('#statsGeneral .listing .price .tinyCookie'))
        simulateClick(statsButton)
    }

    const ONE_OFFS = [
        { name: 'tinyCookie', run: tinyCookie, delay: 0 },
        { name: 'oldenDays', run: oldenDays, delay: 300 },
        { name: 'godComplex', run: godComplex, delay: 900 },
        { name: 'hereYouGo', run: hereYouGo, delay: 2600 }
    ]

    //! Setup

    function setup() {
        const pending = ONE_OFFS.filter(job => !done(job.name))
        if (pending.length === 0) {
            console.log('Alakazam: achievement routines already run for this save, skipping')
            ranSetup = true
            return
        }

        console.log(`Alakazam: running ${pending.length} achievement routine(s) for this save`)
        for (const job of pending) {
            setTimeout(() => {
                try {
                    job.run()
                } catch (err) {
                    console.warn(`Alakazam: achievement routine "${job.name}" failed`, err)
                }
                markDone(job.name)
            }, job.delay)
        }
        ranSetup = true
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

    function tick() {
        if (!ranSetup) return
        clickTicker()
        closeNotes()

        const s = save.get()
        window.__alakazam.achievements = {
            won: save.achievementsWon(),
            known: s.ok && s.achievements ? s.achievements.length : 0,
            tickerClicks: store.get('tickerClicks', 0),
            routinesDone: ONE_OFFS.filter(j => done(j.name)).map(j => j.name)
        }
    }

    registry.register({ name: 'achievements', interval: INTERVAL_MS, setup, tick })

    window.Alakazam.achievements = { ONE_OFFS, done }
})()
