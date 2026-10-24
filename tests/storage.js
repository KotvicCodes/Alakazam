//! Chrome Storage Fixture
// Chrome serializes on both sides of the boundary. Never share object references
// between callers, persisted data, callbacks, or onChanged listeners.
function storageFixture(disk = {}) {
    const listeners = []
    const failures = new Map()
    let deferred = null
    let deferredCallback = null
    let deferredGetCallback = null
    const clone = value => (value === undefined ? undefined : structuredClone(value))
    function chrome() {
        const runtime = {}
        function finish(method, cb, result) {
            const failure = failures.get(method)
            if (failure) {
                failures.delete(method)
                runtime.lastError = { message: failure }
                cb && cb()
                delete runtime.lastError
                return false
            }
            cb && cb(clone(result))
            return true
        }
        return {
            runtime,
            storage: {
                local: {
                    get(keys, cb) {
                        const acceptCallback = deferredGetCallback
                        deferredGetCallback = null
                        const result = {}
                        for (const key of keys === null ? Object.keys(disk) : keys) {
                            if (key in disk) result[key] = clone(disk[key])
                        }
                        if (acceptCallback) acceptCallback(() => finish('get', cb, result))
                        else finish('get', cb, result)
                    },
                    remove(keys, cb) {
                        const changes = {}
                        for (const key of keys) {
                            changes[key] = { oldValue: clone(disk[key]) }
                            delete disk[key]
                        }
                        for (const fn of listeners) fn(clone(changes), 'local')
                        finish('remove', cb)
                    },
                    set(values, cb) {
                        const acceptCallback = deferredCallback
                        deferredCallback = null
                        const snapshot = clone(values)
                        const commit = () => {
                            if (failures.has('set')) {
                                finish('set', cb)
                                return
                            }
                            const changes = {}
                            for (const [key, value] of Object.entries(snapshot)) {
                                changes[key] = { oldValue: clone(disk[key]), newValue: clone(value) }
                                disk[key] = clone(value)
                            }
                            for (const fn of listeners) fn(clone(changes), 'local')
                            if (acceptCallback) acceptCallback(() => finish('set', cb))
                            else finish('set', cb)
                        }
                        if (deferred) {
                            const accept = deferred
                            deferred = null
                            accept(commit)
                        } else commit()
                    }
                },
                onChanged: { addListener: fn => listeners.push(fn) }
            }
        }
    }
    return {
        disk,
        chrome,
        failNext: (method, message = 'storage unavailable') => failures.set(method, message),
        deferNextGetCallback: () =>
            new Promise(resolve => {
                deferredGetCallback = resolve
            }),
        deferNextSetCallback: () =>
            new Promise(resolve => {
                deferredCallback = resolve
            }),
        deferNextSet: () =>
            new Promise(resolve => {
                deferred = resolve
            })
    }
}
module.exports = { storageFixture }
