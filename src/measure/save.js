// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Save Watcher
    // Keeps one parsed copy of the save around for every module to share.
    //
    // The game rewrites its save on autosave, so this polls rather than reacting.
    // Polling is cheap because the check is a length-and-prefix fingerprint, not a
    // parse: the expensive decode only happens when the blob has actually changed,
    // which in practice is once a minute.
    //
    // Anything read from here can be up to a minute out of date. That is fine for
    // what it is used for, all of which changes slowly: minigame state, which
    // upgrades and achievements are owned, sugar lump timers, prestige. Live
    // numbers come from measure/live.js instead.

    const { savefile, registry } = window.Alakazam

    const TICK_MS = 2000

    let current = savefile.read()
    let fingerprint = savefile.rawFingerprint()
    let lastChangeAt = Date.now()
    let generation = 0

    //* tick
    // The fingerprint check exists to skip the decode when nothing has changed.
    // It must not be allowed to skip a retry: a read that failed has no state to
    // preserve, and if the reason it failed was transient then waiting for the
    // save to change means waiting for the next autosave to try again. A failed
    // read is retried every tick until it works.
    function tick() {
        const next = savefile.rawFingerprint()
        if (next === fingerprint && current.ok) return
        fingerprint = next
        const previouslyOk = current.ok
        current = savefile.read()
        // a retry that fails again is not a change, and must not keep resetting
        // the age shown in the panel
        if (current.ok !== previouslyOk || current.ok) {
            lastChangeAt = Date.now()
            generation++
        }
        window.__alakazam.save = current
    }

    //* get
    // the last parsed save. always an object: on failure it carries ok false and
    // a reason, so callers can check rather than guard against null.
    function get() {
        return current
    }

    //* building
    // one building's save record by index, matching the store's product order
    function building(index) {
        if (!current.ok || !current.buildings) return null
        return current.buildings[index] || null
    }

    //* minigame
    // the parsed sub-save for a minigame, or null when it is not unlocked yet.
    // 'garden' | 'market' | 'pantheon' | 'grimoire'
    function minigame(kind) {
        const at = { garden: 2, market: 5, pantheon: 6, grimoire: 7 }[kind]
        const b = building(at)
        return b ? b.minigame : null
    }

    //* achievementsWon
    // how many achievements are held. the bitfield itself is on the save object
    // for modules that need to know which specific ones are missing.
    function achievementsWon() {
        if (!current.ok || !current.achievements) return 0
        return current.achievements.reduce((n, won) => n + (won ? 1 : 0), 0)
    }

    //* upgradesBought
    // used as a cheap change signal: when this moves, every building's per-unit
    // production may have changed too
    function upgradesBought() {
        if (!current.ok || !current.upgrades) return 0
        return current.upgrades.reduce((n, u) => n + (u.bought ? 1 : 0), 0)
    }

    //* trusted
    // whether the positional scalar fields can be believed. modules that need
    // exact numbers check this and fall back to the DOM when it is false.
    function trusted() {
        return current.ok && !current.stale
    }

    function stats() {
        return {
            ok: current.ok,
            stale: current.stale,
            reason: current.reason,
            version: current.version,
            // which localStorage key the save was actually found under. worth
            // showing: if it is not CookieClickerGame, that alone explains a lot.
            key: current.key || '',
            generation,
            secondsSinceChange: Math.round((Date.now() - lastChangeAt) / 1000)
        }
    }

    registry.register({ name: 'saveWatch', interval: TICK_MS, setting: 'enabled', tick })

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.save = {
        get,
        building,
        minigame,
        achievementsWon,
        upgradesBought,
        trusted,
        stats
    }
})()
