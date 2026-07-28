// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Alakazam Main
    // Bootstrap only. Every behaviour lives in a module under src/modules that
    // registers itself at load time, and the scheduler owns all cadence. main.js
    // exists to wait for the game, work out which save it is looking at, load the
    // state belonging to that save, and start the loops.
    //
    // Nothing here knows the name of a single module.

    const { savefile, identity, store, scheduler } = window.Alakazam

    const STARTUP_DELAY_MS = 3000 // let the game finish loading

    console.log('Alakazam: content script loaded')

    setTimeout(boot, STARTUP_DELAY_MS)

    async function boot() {
        if (!document.getElementById('bigCookie')) {
            console.warn('Alakazam: #bigCookie not found, is this Cookie Clicker?')
            return
        }

        const save = savefile.read()
        const who = identity.fromSave(save)

        // shared debug handle: modules hang their latest measurements off this so
        // everything Alakazam has computed is inspectable from the console. the
        // registry creates it at load time, so this only adds to it.
        window.__alakazam.identity = who
        window.__alakazam.save = save

        if (save.stale) {
            console.warn(
                `Alakazam: save could not be fully trusted (${save.reason}), falling back to the DOM where it matters`
            )
        }
        // the seed and bakery name stay out of the log: only the derived ids
        console.log(`Alakazam: save ${who.legacyId}, run ${who.runId}, ${who.ascensions} ascension(s)`)

        await store.ready(who.legacyId)
        await scheduler.start()
    }
})()
