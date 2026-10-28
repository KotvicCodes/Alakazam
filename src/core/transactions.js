// wrapped in an IIFE because content scripts share a scope
;(function () {
    //! Transaction Ownership
    // one automated transaction at a time; settings, pauses and real input revoke
    // its lease, including while a module is asleep waiting for the game to draw
    const { store } = window.Alakazam
    let owner = null

    function cancel() {
        if (owner) owner.cancelled = true
    }

    for (const type of ['pointerdown', 'keydown', 'wheel']) {
        document.addEventListener(
            type,
            event => {
                if (!event.isTrusted) return
                cancel()
                if (owner && /^storeBulk/.test(event.target?.id || '')) owner.userControls = true
            },
            true
        )
    }
    store.subscribe(() => {
        if (owner && !store.moduleEnabled(owner.setting)) cancel()
    })

    function acquire(setting, context) {
        const moduleName = setting === 'marketTrading' ? 'market' : setting
        const ctx = context || window.Alakazam.safety.scope(moduleName)
        if (
            owner ||
            !ctx.active ||
            !store.moduleEnabled(setting) ||
            window.Alakazam.scheduler.isPaused()
        )
            return null
        const resource = window.Alakazam.safety.acquire('store', ctx.owner)
        if (!resource) return null
        const lease = {
            ctx,
            setting,
            cancelled: false,
            userControls: false,
            valid() {
                return (
                    owner === lease &&
                    !lease.cancelled &&
                    ctx.active &&
                    resource.valid() &&
                    store.moduleEnabled(setting) &&
                    !window.Alakazam.scheduler.isPaused()
                )
            },
            release() {
                if (owner === lease) owner = null
                resource.release()
            }
        }
        owner = lease
        return lease
    }

    async function until(lease, read, timeout = 1000) {
        const deadline = Date.now() + timeout
        while (lease.valid()) {
            const result = read()
            if (result) return result
            if (Date.now() >= deadline) break
            await new Promise(resolve => setTimeout(resolve, 25))
        }
        return null
    }

    window.Alakazam.transactions = { acquire, cancel, until }
})()
