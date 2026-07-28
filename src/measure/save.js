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

    function tick() {
        const next = savefile.rawFingerprint()
        if (next === fingerprint) return
        fingerprint = next
        current = savefile.read()
        lastChangeAt = Date.now()
        generation++
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
