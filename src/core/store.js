// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Persistent State
    // Everything Alakazam wants to remember across page refreshes lives here, in
    // chrome.storage.local. Two namespaces:
    //
    //   settings          global, one set of module toggles for every save
    //   legacy:<id>:<key> per save file, keyed by the identity module's legacyId
    //
    // Reads are synchronous against an in-memory cache that is filled once at
    // startup; writes go into that cache immediately and are flushed on a debounce
    // so a busy loop cannot hammer the storage quota.
    //
    // chrome.storage.onChanged doubles as the bridge to the popup, which means no
    // background service worker and no message passing is needed anywhere.
    //
    // Nothing here ever stores raw game data: only our own derived state.

    const FLUSH_DELAY_MS = 500
    const SETTINGS_KEY = 'settings'

    //* Default settings
    // every module checks its own flag before doing anything, so this list is
    // also the authoritative inventory of what Alakazam can be told to stop doing
    const DEFAULTS = {
        enabled: true,
        autoclick: true,
        shimmers: true,
        wrinklers: true,
        purchase: true,
        lumps: true,
        grimoire: true,
        pantheon: true,
        garden: true,
        achievements: true,
        marketTrading: true,
        hud: true
    }

    let namespace = 'legacy:unknown'
    let cache = {}
    let settings = { ...DEFAULTS }
    let loaded = false
    let flushTimer = null
    let dirty = new Set()
    const subscribers = []

    //* backend
    // chrome.storage.local when we are a real extension, an in-memory stand-in
    // otherwise so the module stays usable in tests and on a plain page.
    function backend() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            return chrome.storage.local
        }
        return null
    }

    //! Loading

    //* ready
    // fills the cache for one save file. safe to call again when the player
    // ascends into a new run: the legacy id only changes when the save changes.
    async function ready(legacyId) {
        namespace = 'legacy:' + (legacyId || 'unknown')
        const api = backend()
        if (!api) {
            loaded = true
            return
        }
        const wanted = [SETTINGS_KEY, namespace]
        const got = await new Promise(resolve => {
            try {
                api.get(wanted, resolve)
            } catch (err) {
                resolve({})
            }
        })
        settings = { ...DEFAULTS, ...(got[SETTINGS_KEY] || {}) }
        cache = got[namespace] || {}
        loaded = true
        listen()
    }

    function isReady() {
        return loaded
    }

    //! Per-save values

    function get(key, fallback) {
        return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : fallback
    }

    function set(key, value) {
        cache[key] = value
        markDirty(namespace)
    }

    //* update
    // read-modify-write in one step, for the counters and logs that modules keep
    function update(key, fallback, fn) {
        const next = fn(get(key, fallback))
        set(key, next)
        return next
    }

    function forget(key) {
        delete cache[key]
        markDirty(namespace)
    }

    //! Settings

    function setting(name) {
        return Object.prototype.hasOwnProperty.call(settings, name) ? settings[name] : DEFAULTS[name]
    }

    function setSetting(name, value) {
        settings[name] = value
        markDirty(SETTINGS_KEY)
        notify()
    }

    function allSettings() {
        return { ...settings }
    }

    //* moduleEnabled
    // a module runs only when both the master switch and its own flag are on
    function moduleEnabled(name) {
        return setting('enabled') !== false && setting(name) !== false
    }

    //! Flushing

    function markDirty(which) {
        dirty.add(which)
        if (flushTimer) return
        flushTimer = setTimeout(() => {
            flushTimer = null
            flush()
        }, FLUSH_DELAY_MS)
    }

    //* flush
    // writes whatever changed since the last flush. resolves even without a
    // storage backend so callers can always await it.
    function flush() {
        const api = backend()
        const pending = dirty
        dirty = new Set()
        if (!api || pending.size === 0) return Promise.resolve()

        const payload = {}
        if (pending.has(SETTINGS_KEY)) payload[SETTINGS_KEY] = settings
        if (pending.has(namespace)) payload[namespace] = cache

        return new Promise(resolve => {
            try {
                api.set(payload, resolve)
            } catch (err) {
                resolve()
            }
        })
    }

    //! Change notification
    // doubles as the popup bridge: the popup writes a setting, chrome fires
    // onChanged in the content script, and the module picks it up on its next tick

    let listening = false

    function listen() {
        if (listening) return
        const api = backend()
        if (!api || !chrome.storage.onChanged) return
        listening = true
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return
            if (changes[SETTINGS_KEY] && changes[SETTINGS_KEY].newValue) {
                settings = { ...DEFAULTS, ...changes[SETTINGS_KEY].newValue }
                notify()
            }
        })
    }

    function subscribe(fn) {
        subscribers.push(fn)
    }

    function notify() {
        for (const fn of subscribers) {
            try {
                fn(allSettings())
            } catch (err) {
                console.warn('Alakazam: settings subscriber failed', err)
            }
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.store = {
        ready,
        isReady,
        get,
        set,
        update,
        forget,
        setting,
        setSetting,
        allSettings,
        moduleEnabled,
        subscribe,
        flush,
        DEFAULTS,
        SETTINGS_KEY
    }
})()
