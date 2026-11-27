// wrapped in an IIFE because content scripts share a scope
export const api = (function () {
    //! Transaction Ownership
    // one automated transaction at a time; settings, pauses and real input revoke
    // its lease, including while a module is asleep waiting for the game to draw
    const { store } = window.Alakazam
    let owner = null
    const heldModifiers = new Set()
    const modifier = event =>
        (event as KeyboardEvent).key === 'Shift' || (event as KeyboardEvent).keyCode === 16
            ? 'Shift'
            : (event as KeyboardEvent).key === 'Control' || (event as KeyboardEvent).keyCode === 17
              ? 'Control'
              : null

    function cancel() {
        if (owner) owner.cancelled = true
    }

    for (const type of ['pointerdown', 'keydown', 'wheel']) {
        document.addEventListener(
            type,
            event => {
                if (!event.isTrusted) return
                if (type === 'keydown') {
                    const key = modifier(event)
                    if (key) heldModifiers.add(key)
                    // Cookie Clicker clears its key state on Tab as well.
                    if ((event as KeyboardEvent).key === 'Tab' || (event as KeyboardEvent).keyCode === 9)
                        heldModifiers.clear()
                }
                cancel()
                if (owner && /^storeBulk/.test((event.target as HTMLElement)?.id || ''))
                    owner.userControls = true
            },
            true
        )
    }
    document.addEventListener(
        'keyup',
        event => {
            if (event.isTrusted) heldModifiers.delete(modifier(event))
        },
        true
    )
    // Match the game's reset when a tab becomes hidden/visible. A plain blur
    // does not reset Game.keys, so it cannot safely authorize another purchase.
    window.addEventListener('visibilitychange', event => {
        if (!event.isTrusted) return
        heldModifiers.clear()
        cancel()
    })
    store.subscribe(() => {
        if (owner && !store.moduleEnabled(owner.setting)) cancel()
    })

    function acquire(setting, context?: any) {
        const moduleName = setting === 'marketTrading' ? 'market' : setting
        const ctx = context || window.Alakazam.safety.scope(moduleName)
        if (
            owner ||
            heldModifiers.size > 0 ||
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
                    heldModifiers.size === 0 &&
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

    return { acquire, cancel, until }
})()
window.Alakazam.transactions = api
