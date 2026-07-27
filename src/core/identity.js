// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Run Identity
    // Cookie Clicker has no accounts, but every save carries a five-letter `seed`
    // plus the timestamps for when the save was created and when the current
    // ascension began. Together those identify a save as well as an account id
    // would, and they are stable across page refreshes.
    //
    //   legacyId -> one save file, survives ascension. namespaces everything we
    //               remember long term: seed log, settings, achievement work.
    //   runId    -> one ascension. namespaces anything that resets when the
    //               player ascends.
    //
    // The seed is also what makes the game's random events reproducible, which is
    // what any future golden cookie prediction would be built on. It is captured
    // here so that work does not need a second pass over the save.

    const { savefile } = window.Alakazam

    //* hash
    // FNV-1a, 32 bit, rendered as 8 hex characters. we only need a short stable
    // key for storage namespacing, so a non-cryptographic hash is the right tool.
    // hashing rather than storing the raw fields also keeps the bakery name, which
    // is user data, out of anything we persist or print.
    function hash(str) {
        let h = 0x811c9dc5
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i)
            // 32 bit FNV prime multiply, kept in integer range
            h = Math.imul(h, 0x01000193) >>> 0
        }
        return h.toString(16).padStart(8, '0')
    }

    //* fromSave
    // pure: derive identity from an already parsed save. exported separately so
    // it can be tested without a browser.
    function fromSave(save) {
        if (!save || !save.ok || !save.run) {
            return { known: false, legacyId: 'unknown', runId: 'unknown', seed: '', ascensions: 0 }
        }
        const run = save.run
        // fullDate never changes for a save file; startDate changes every ascension
        const legacyId = hash(run.seed + '|' + run.fullDate)
        const runId = hash(run.seed + '|' + run.startDate)
        return {
            known: run.seed !== '',
            legacyId,
            runId,
            seed: run.seed,
            ascensions: save.scalars ? save.scalars.resets : 0
        }
    }

    //* current
    // reads the save and derives identity. cheap enough to call on demand, but
    // callers that need it every tick should hold onto the result and refresh it
    // only when the run id changes (that is, when the player ascends).
    function current() {
        return fromSave(savefile.read())
    }

    //* bakeryName
    // the player's own bakery name, needed so the achievement routines can put it
    // back after temporarily renaming the bakery. treated as user data: returned
    // to callers on request, never logged and never persisted.
    function bakeryName(save) {
        const s = save || savefile.read()
        return s && s.ok && s.run ? s.run.bakeryName : ''
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.identity = { current, fromSave, bakeryName, hash }
})()
