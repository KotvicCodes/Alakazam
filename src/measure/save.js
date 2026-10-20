// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Save Watcher
    // Keeps one parsed copy of the save around for every module to share.
    //
    // The game rewrites its save on autosave, so this polls rather than reacting.
    // Polling is cheap because the check is a whole-string fingerprint, not a
    // parse: the expensive decode only happens when the blob has actually changed,
    // which in practice is once a minute.
    //
    // Anything read from here can be up to a minute out of date. That is fine for
    // what it is used for, all of which changes slowly: minigame state, which
    // upgrades and achievements are owned, sugar lump timers, prestige. Live
    // numbers come from measure/live.js instead.

    const { savefile, identity, store, registry } = window.Alakazam

    const TICK_MS = 2000

    let current = savefile.read()
    let fingerprint = savefile.rawFingerprint(current.key)
    let lastChangeAt = Date.now()
    let revision = current.ok && !current.stale ? 1 : 0
    let connected = false
    let activeIdentity = null

    // boot opts into lifecycle reconciliation. Keeping this explicit also lets
    // standalone consumers use the parser/watcher without starting persistence.
    async function connect() {
        connected = true
        await tick()
    }

    async function reconcile() {
        if (!connected) return
        const who = identity.fromSave(current)
        if (current.stale || !who.known) {
            if (!activeIdentity) await store.ready(who)
            return
        }
        if (activeIdentity && activeIdentity.runId === who.runId && store.isReady()) return
        const scheduler = window.Alakazam.scheduler
        await scheduler.reconcile(who)
        activeIdentity = who
    }

    async function tick() {
        const next = savefile.rawFingerprint()
        if (next !== fingerprint || !current.ok) {
            fingerprint = next
            const previouslyOk = current.ok
            current = savefile.read()
            if (current.ok !== previouslyOk || current.ok) lastChangeAt = Date.now()
            if (current.ok && !current.stale) revision++
            window.__alakazam.save = current
        }
        // retry a failed namespace load even when the save itself is unchanged
        await reconcile()
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
            revision,
            changedAt: lastChangeAt,
            savedAt:
                current.ok && current.run && Number.isFinite(current.run.lastDate)
                    ? current.run.lastDate
                    : null,
            familyId: identity.fromSave(current).familyId,
            runId: identity.fromSave(current).runId,
            trusted: trusted(),
            ok: current.ok,
            stale: current.stale,
            reason: current.reason,
            version: current.version,
            // which localStorage key the save was actually found under. worth
            // showing: if it is not CookieClickerGame, that alone explains a lot.
            key: current.key || '',
            secondsSinceChange: Math.round((Date.now() - lastChangeAt) / 1000)
        }
    }

    registry.register({ name: 'saveWatch', interval: TICK_MS, always: true, tick })

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.save = {
        get,
        connect,
        building,
        minigame,
        achievementsWon,
        upgradesBought,
        trusted,
        stats
    }
})()
