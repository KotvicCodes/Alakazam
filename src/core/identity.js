// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Save & Run Identity
    // fullDate survives ascension, renaming and imports. Imports with the same
    // creation timestamp deliberately share family state; a hard reset starts a
    // new family. The seed belongs only to the run. Variant keys stay isolated.

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
        const run = save && save.run
        if (
            !save ||
            !save.ok ||
            !run ||
            !run.seed ||
            !Number.isFinite(run.fullDate) ||
            run.fullDate <= 0 ||
            !Number.isFinite(run.startDate) ||
            run.startDate <= 0
        ) {
            return { known: false, familyId: 'unknown', legacyId: 'unknown', runId: 'unknown' }
        }
        const variant = save.key || savefile.SAVE_KEY
        const familyId = 'v2-' + hash(variant + '|' + run.fullDate)
        const ascensions = save.scalars ? save.scalars.resets : 0
        return {
            known: true,
            familyId,
            legacyId: familyId,
            // old namespaces carry no variant metadata; import them only on the canonical key
            previousLegacyId: variant === savefile.SAVE_KEY ? hash(run.seed + '|' + run.fullDate) : null,
            previousRecoveryId: variant === savefile.SAVE_KEY ? hash('legacy|' + run.fullDate) : null,
            runId: hash(familyId + '|' + run.seed + '|' + run.startDate + '|' + ascensions),
            seed: run.seed,
            ascensions
        }
    }

    //* current
    // reads the save and derives identity. cheap enough to call on demand, but
    // callers that need it every tick should hold onto the result and refresh it
    // only when the run id changes (that is, when the player ascends).
    function current() {
        const saved = savefile.read()
        // plausible metadata in a stale parse cannot authorize live automation
        return fromSave(saved.stale ? null : saved)
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
