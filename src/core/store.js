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
    const quarantine = 'quarantine:' + Math.random().toString(36).slice(2)
    let namespace = quarantine
    let runNamespace = namespace
    let loaded = false
    let flushTimer = null
    let inFlight = null
    let loadQueue = Promise.resolve()
    let loadVersion = 0
    let loadChanges = null
    let lastError = ''
    const records = new Map()
    const baselines = new Map()
    const dirty = new Map()
    const receivedWhileDirty = new Map()
    const subscribers = []
    const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
    const fieldKey = (scope, key) => PREFIX + encodeURIComponent(scope) + ':' + encodeURIComponent(key)
    const RECOVERY_KEYS = new Set(['bakeryNameRecovery', 'cloneRecovery'])
    const recoveryClaims = new Map()
    const receivedVersions = new Map()
    let documentOwner = null
    const mediatedRecovery = () => typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage
    const sameOwner = owner =>
        !!owner &&
        !!documentOwner &&
        owner.tabId === documentOwner.tabId &&
        owner.documentId === documentOwner.documentId

    function journalMessage(message) {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage({ type: 'alakazam:journal', ...message }, result => {
                    const error = chrome.runtime.lastError?.message || result?.error
                    if (error || !result) reject(new Error(error || 'Recovery worker unavailable'))
                    else resolve(result)
                })
            } catch (error) {
                reject(error)
            }
        })
    }

    function claimRecovery(key, initial) {
        if (!mediatedRecovery()) return Promise.resolve(true)
        if (!loaded || !RECOVERY_KEYS.has(key)) return Promise.resolve(false)
        const scope = namespace
        const field = fieldKey(scope, key)
        const ownerField = fieldKey(scope, '@owner:' + key)
        const fieldVersion = receivedVersions.get(field)
        const ownerVersion = receivedVersions.get(ownerField)
        if (recoveryClaims.has(field)) return recoveryClaims.get(field)
        const work = journalMessage({
            operation: 'claim',
            scope,
            key,
            begin: initial !== undefined,
            mark: initial === undefined ? get(key, null) : clone(initial)
        })
            .then(result => {
                // onChanged normally supplies these first. Apply the reply too
                // so an acquired claim is usable before a delayed event arrives.
                if (!dirty.has(field) && receivedVersions.get(field) === fieldVersion)
                    applyStored(field, result.record)
                if (receivedVersions.get(ownerField) === ownerVersion)
                    applyStored(ownerField, result.owner ? { value: result.owner } : undefined)
                if (result.owned) documentOwner = result.owner
                if (!dirty.size) lastError = ''
                return (
                    scope === namespace &&
                    loaded &&
                    result.owned &&
                    sameOwner(read(scope, '@owner:' + key, null))
                )
            })
            .catch(error => {
                report(error)
                return false
            })
            .finally(() => recoveryClaims.delete(field))
        recoveryClaims.set(field, work)
        return work
    }

    function ownsRecovery(key, request = true) {
        if (!mediatedRecovery()) return true
        if (sameOwner(read(namespace, '@owner:' + key, null))) return true
        // A later tick can acquire a crashed/reloaded owner's journal without
        // changing recoverName's synchronous boolean API or opening any prompt.
        if (request && get(key, null)) void claimRecovery(key)
        return false
    }

    // Undo records can originate in old namespaces, current fields or external
    // storage events. Validate at promotion and at read time, leaving malformed
    // evidence untouched rather than letting it drive the live game UI.
    function validRecovery(key, mark) {
        if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return false
        if (typeof mark.legacyId !== 'string' || !mark.legacyId) return false
        for (const flag of ['intervened', 'earned']) {
            if (flag in mark && typeof mark[flag] !== 'boolean') return false
        }
        if (key === 'bakeryNameRecovery') {
            return typeof mark.original === 'string' && typeof mark.expected === 'string'
        }
        const choices = window.Alakazam.data?.clones?.CHOICES
        const genes = value =>
            !!choices &&
            Array.isArray(value) &&
            value.length === choices.length &&
            choices.every(
                (count, i) => Number.isSafeInteger(value[i]) && value[i] >= 0 && value[i] < count
            )
        return (
            genes(mark.original) &&
            genes(mark.expected) &&
            (!('previous' in mark) || genes(mark.previous)) &&
            (!('history' in mark) || (Array.isArray(mark.history) && mark.history.every(genes)))
        )
    }

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
        const who = typeof identity === 'object' && identity ? identity : null
        const target = who
            ? who.known
                ? 'legacy:' + who.familyId
                : quarantine
            : 'legacy:' + (identity || 'unknown')
        // The scheduler has drained old actions before this lifecycle boundary.
        // Invalidate an earlier unrelated scope immediately, even if this read
        // queues behind another load. Unknown/quarantined saves never release it.
        // String namespaces also serve settings-only clients such as the popup;
        // only structured save identities participate in document ownership.
        const announcement =
            who && mediatedRecovery()
                ? journalMessage({ operation: 'namespace', scope: null, version, settled: false })
                : null
        if (announcement) void announcement.catch(() => {}) // request below reports/rethrows
        if (who && (!who.known || target !== namespace)) {
            // This must happen before the read: a failed/delayed load must never
            // leave new UI writes pointed at the previously connected family.
            namespace = quarantine
            runNamespace = quarantine
        }
        const request = async () => {
            // Listen before the read, including on first load. Each queued read
            // gets its own overlay so delayed snapshots cannot undo newer events.
            loadChanges = new Map()
            listen()
            try {
                if (announcement) await announcement
                const all = await call('get', null)
                for (const [key, value] of loadChanges) {
                    if (value === undefined) delete all[key]
                    else all[key] = value
                }
                const runTarget = who && who.known ? 'run:' + who.familyId + ':' + who.runId : target
                const source = Object.assign(
                    {},
                    who?.previousLegacyId && all['legacy:' + who.previousLegacyId],
                    who?.previousRecoveryId && all['legacy:' + who.previousRecoveryId],
                    all[target]
                )
                for (const [key, held] of Object.entries(source)) {
                    if (who && RUN_KEYS.has(key)) continue
                    let value = held
                    if (who && RECOVERY_KEYS.has(key)) {
                        if (
                            !validRecovery(key, held) ||
                            ![who.familyId, who.previousLegacyId, who.previousRecoveryId]
                                .filter(Boolean)
                                .includes(held.legacyId)
                        )
                            continue
                        value = { ...held, legacyId: who.familyId }
                    }
                    const baselineKey = fieldKey(target, '@base:' + key)
                    if (!all[baselineKey] && !records.has(baselineKey)) {
                        write(baselineKey, { value: clone(value) })
                    }
                }
                baselines.set(SETTINGS_KEY, clone(all[SETTINGS_KEY] || {}))
                for (const key of new Set([...records.keys(), ...Object.keys(all)])) {
                    if (key.startsWith(PREFIX) && !dirty.has(key)) applyStored(key, all[key])
                }
                if (!dirty.size) lastError = ''
                // A superseded read may fill the cache, but cannot reselect an
                // old family while a newer request has already quarantined it.
                if (version === loadVersion) {
                    namespace = target
                    runNamespace = runTarget
                    if (announcement)
                        await journalMessage({
                            operation: 'namespace',
                            scope: who?.known ? target : null,
                            version,
                            settled: true
                        })
                    if (version !== loadVersion) return
                    loaded = true
                    // Startup recovery remains synchronous after ready(). A
                    // live foreign document simply makes this claim return false.
                    for (const key of RECOVERY_KEYS) {
                        if (get(key, null)) await claimRecovery(key)
                    }
                }
                notify()
            } catch (err) {
                report(err)
                throw err
            } finally {
                loadChanges = null
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
            if (RUN_KEYS.has(key) || record || get(key, undefined) !== undefined) continue
            if (RECOVERY_KEYS.has(key)) {
                const familyId = destination.slice('legacy:'.length)
                if (!validRecovery(key, value) || ![sourceId, familyId].includes(value.legacyId))
                    continue
                const mark = { ...value, legacyId: familyId }
                if (!(await claimRecovery(key, mark))) continue
                if (namespace !== destination || !loaded)
                    throw new Error('save changed during copy; retry')
                set(key, mark)
            } else set(key, value)
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
        const value = read(scopeFor(key), key, fallback)
        return RECOVERY_KEYS.has(key) && !validRecovery(key, value) ? clone(fallback) : value
    }
    function set(key, value) {
        if (RECOVERY_KEYS.has(key) && !ownsRecovery(key)) return
        write(fieldKey(scopeFor(key), key), { value: clone(value) })
    }
    function forget(key) {
        if (RECOVERY_KEYS.has(key) && !ownsRecovery(key)) return
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
        if (!dirty.size) return true
        if (!backend()) return false
        const pending = new Map(dirty)
        const perform = async () => {
            try {
                let persisted = true
                const regular = new Map(pending)
                if (mediatedRecovery()) {
                    for (const [field, record] of pending) {
                        const parts = field.slice(PREFIX.length).split(':').map(decodeURIComponent)
                        if (parts.length !== 2 || !RECOVERY_KEYS.has(parts[1])) continue
                        regular.delete(field)
                        const version = receivedVersions.get(field)
                        const ownerField = fieldKey(parts[0], '@owner:' + parts[1])
                        const ownerVersion = receivedVersions.get(ownerField)
                        const result = await journalMessage({
                            operation: 'write',
                            scope: parts[0],
                            key: parts[1],
                            record
                        })
                        if (!result.owned) {
                            // A thawed/replaced document must drop its stale
                            // write, without blocking unrelated pending fields
                            // forever or authorizing the next cosmetic input.
                            persisted = false
                            if (receivedVersions.get(field) === version)
                                receivedWhileDirty.set(field, clone(result.record))
                            if (receivedVersions.get(ownerField) === ownerVersion)
                                applyStored(
                                    ownerField,
                                    result.owner ? { value: result.owner } : undefined
                                )
                        }
                    }
                }
                if (regular.size) await call('set', Object.fromEntries(regular))
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
                return persisted
            } catch (err) {
                report(err)
                throw err
            }
        }
        inFlight = perform()
        try {
            return await inFlight
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
            let relevant = false
            for (const [key, change] of Object.entries(changes)) {
                if (!key.startsWith(PREFIX)) continue
                relevant = true
                receivedVersions.set(key, (receivedVersions.get(key) || 0) + 1)
                if (loadChanges) loadChanges.set(key, clone(change.newValue))
                if (dirty.has(key)) receivedWhileDirty.set(key, clone(change.newValue))
                else applyStored(key, change.newValue)
            }
            if (relevant) notify()
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
        error: () => lastError,
        ready,
        copyLegacy,
        isReady,
        get,
        ownsRecovery,
        claimRecovery,
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
