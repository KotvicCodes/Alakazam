// all content scripts share a scope; keep implementation names private
;(function () {
    //! Persistent State
    // v2 stores one Chrome storage entry per field. Unrelated tab/popup writes
    // cannot replace one another. Writes to the same field are last-writer-wins;
    // update() is a local convenience, not a distributed atomic counter.
    const FLUSH_DELAY_MS = 500
    const SETTINGS_KEY = 'settings'
    const PREFIX = 'az2:'
    const DEFAULTS = {
        enabled: true,
        autoclick: true,
        shimmers: true,
        wrinklers: true,
        purchase: true,
        lumps: true,
        grimoire: true,
        pantheon: true,
        dragon: true,
        garden: true,
        achievements: true,
        marketTrading: true,
        ascend: true,
        clones: true,
        gifts: true,
        hud: true
    }

    const RUN_KEYS = new Set([
        'ascendPhase',
        'ascendAwaitReset',
        'runStartedAt',
        'spellsCast',
        'pantheonSwaps',
        'gardenHarvests',
        'wrinklerAdviceAt',
        'giftCheckedAt'
    ])
    let namespace = 'quarantine:' + Math.random().toString(36).slice(2)
    let runNamespace = namespace
    let loaded = false
    let flushTimer = null
    let inFlight = null
    let loadQueue = Promise.resolve()
    let loadVersion = 0
    let lastError = ''
    const records = new Map()
    const baselines = new Map()
    const dirty = new Map()
    const receivedWhileDirty = new Map()
    const subscribers = []
    const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
    const fieldKey = (scope, key) => PREFIX + encodeURIComponent(scope) + ':' + encodeURIComponent(key)

    function backend() {
        return typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null
    }

    function call(method, argument) {
        const api = backend()
        if (!api) return Promise.resolve({})
        return new Promise((resolve, reject) => {
            try {
                api[method](argument, result => {
                    const error = chrome.runtime && chrome.runtime.lastError
                    if (error) reject(new Error(error.message))
                    else resolve(result || {})
                })
            } catch (err) {
                reject(err)
            }
        })
    }

    function report(err) {
        lastError = err.message || String(err)
        console.warn('Alakazam: storage failed; pending writes retained for retry', err)
    }

    //* Loading & Migration
    // copy only the matching old seed namespace, never delete it. Baseline entries
    // are per field and separate from user writes, so concurrent migrations cannot
    // overwrite newer values or unrelated copied fields. Untagged old run state is deliberately not imported.
    // Unknown startup data is quarantined and never attached to a discovered save.
    function ready(identity) {
        const version = ++loadVersion
        loaded = false
        const request = async () => {
            try {
                const all = await call('get', null)
                const who = typeof identity === 'object' && identity ? identity : null
                const target = who
                    ? who.known
                        ? 'legacy:' + who.familyId
                        : namespace
                    : 'legacy:' + (identity || 'unknown')
                const runTarget = who && who.known ? 'run:' + who.familyId + ':' + who.runId : target
                const source = all[target] || (who && all['legacy:' + who.previousLegacyId]) || {}
                for (const [key, value] of Object.entries(source)) {
                    if (who && RUN_KEYS.has(key)) continue
                    const baselineKey = fieldKey(target, '@base:' + key)
                    if (!all[baselineKey] && !records.has(baselineKey)) {
                        write(baselineKey, { value: clone(value) })
                    }
                }
                baselines.set(SETTINGS_KEY, clone(all[SETTINGS_KEY] || {}))
                for (const [key, value] of Object.entries(all)) {
                    if (key.startsWith(PREFIX) && !dirty.has(key)) records.set(key, clone(value))
                }
                namespace = target
                runNamespace = runTarget
                loaded = version === loadVersion
                if (!dirty.size) lastError = ''
                listen()
                notify()
            } catch (err) {
                report(err)
                throw err
            }
        }
        const next = loadQueue.then(request, request)
        loadQueue = next.catch(() => {})
        return next
    }

    // For namespaces from earlier ascensions the old hash contains no recoverable
    // family metadata. An explicit copy is required; never guess from timestamps
    // or choose the most recently written namespace.
    async function copyLegacy(sourceId) {
        if (!loaded || !namespace.startsWith('legacy:v2-')) throw new Error('discover a save first')
        if (!/^[a-f0-9]{8}$/.test(sourceId)) throw new Error('expected an old legacy hash')
        const destination = namespace
        const sourceKey = 'legacy:' + sourceId
        const all = await call('get', [sourceKey])
        if (namespace !== destination || !loaded) throw new Error('save changed during copy; retry')
        if (!all[sourceKey]) throw new Error('legacy namespace not found')
        for (const [key, value] of Object.entries(all[sourceKey])) {
            const record = records.get(fieldKey(namespace, key))
            if (!RUN_KEYS.has(key) && !record && get(key, undefined) === undefined) set(key, value)
        }
        await flush()
    }

    function isReady() {
        return loaded
    }
    function scopeFor(key) {
        return RUN_KEYS.has(key) ? runNamespace : namespace
    }
    function read(scope, key, fallback) {
        const record = records.get(fieldKey(scope, key))
        if (record) return clone(record.deleted ? fallback : record.value)
        const copied = records.get(fieldKey(scope, '@base:' + key))
        if (copied) return clone(copied.value)
        const baseline = baselines.get(scope) || {}
        return clone(Object.prototype.hasOwnProperty.call(baseline, key) ? baseline[key] : fallback)
    }
    function get(key, fallback) {
        return read(scopeFor(key), key, fallback)
    }
    function set(key, value) {
        write(fieldKey(scopeFor(key), key), { value: clone(value) })
    }
    function forget(key) {
        write(fieldKey(scopeFor(key), key), { deleted: true })
    }
    function update(key, fallback, fn) {
        const next = fn(get(key, fallback))
        set(key, next)
        return next
    }
    function setting(name) {
        return read(SETTINGS_KEY, name, DEFAULTS[name])
    }
    function setSetting(name, value) {
        write(fieldKey(SETTINGS_KEY, name), { value: clone(value) })
        notify()
    }
    function allSettings() {
        return Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, setting(key)]))
    }
    function moduleEnabled(name) {
        return setting('enabled') !== false && setting(name) !== false
    }

    function write(key, record) {
        records.set(key, record)
        dirty.set(key, record)
        if (flushTimer) return
        flushTimer = setTimeout(() => {
            flushTimer = null
            flush().catch(() => {}) // report() and stats() retain the failure
        }, FLUSH_DELAY_MS)
    }

    async function flush() {
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = null
        if (inFlight) {
            // this caller owns a retry; a previous failure must not cancel it
            await inFlight.catch(() => {})
            return flush()
        }
        if (!dirty.size) return
        const pending = new Map(dirty)
        const perform = async () => {
            try {
                await call('set', Object.fromEntries(pending))
                let changed = false
                for (const [key, record] of pending) {
                    if (dirty.get(key) !== record) continue
                    dirty.delete(key)
                    // events reflect storage order, which may be newer than our
                    // completed write when its callback was delayed by Chrome.
                    if (receivedWhileDirty.has(key)) {
                        applyStored(key, receivedWhileDirty.get(key))
                        receivedWhileDirty.delete(key)
                        changed = true
                    }
                }
                lastError = ''
                if (changed) notify()
            } catch (err) {
                report(err)
                throw err
            }
        }
        inFlight = perform()
        try {
            await inFlight
        } finally {
            inFlight = null
        }
    }

    function applyStored(key, record) {
        if (record === undefined) records.delete(key)
        else records.set(key, clone(record))
    }

    let listening = false
    function listen() {
        if (listening || !backend() || !chrome.storage.onChanged) return
        listening = true
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return
            for (const [key, change] of Object.entries(changes)) {
                if (!key.startsWith(PREFIX)) continue
                if (dirty.has(key)) receivedWhileDirty.set(key, clone(change.newValue))
                else applyStored(key, change.newValue)
            }
            notify()
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
    function stats() {
        return { ready: loaded, pending: dirty.size, error: lastError }
    }
    window.Alakazam = window.Alakazam || {}
    window.Alakazam.store = {
        ready,
        copyLegacy,
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
        stats,
        fieldKey,
        DEFAULTS,
        SETTINGS_KEY
    }
})()
