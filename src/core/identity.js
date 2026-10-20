// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Run Identity
    // fullDate identifies a legacy across reloads and ascensions. The random seed
    // belongs to one run and changes on ascension, so it must never namespace
    // cosmetic recovery or long-term automation state.
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
    // bakery names are never part of an identity or printed in logs.
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
        // fullDate survives renames and ascensions; the random seed does not.
        // recovery must not move to a different namespace after a cosmetic edit.
        const legacyId = hash('legacy|' + run.fullDate)
        const runId = hash(run.seed + '|' + run.startDate)
        return {
            known: Number.isFinite(run.fullDate) && run.fullDate > 0,
            legacyId,
            previousLegacyId: hash(run.seed + '|' + run.fullDate),
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
    // to callers on request and never logged. Temporary undo records may persist it.
    function bakeryName(save) {
        const s = save || savefile.read()
        return s && s.ok && s.run ? s.run.bakeryName : ''
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.identity = { current, fromSave, bakeryName, hash }
})()
