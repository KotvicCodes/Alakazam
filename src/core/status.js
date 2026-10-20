;(function () {
    //! Live Status
    // independent of HUD visibility and all automation switches
    const { registry, scheduler, store, save, identity, live } = window.Alakazam
    const pageId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    let latest = null
    let publicationError = ''
    let inFlight = null

    function snapshot() {
        const who = identity.fromSave(save.get())
        const modules = scheduler.stats()
        const globals = live.readGlobals()
        // zero-owned products have an empty counter and may not be unlocked;
        // count the entire store rather than only affordable/catalogued products
        const counts = Array.from(document.querySelectorAll('.product'), product => {
            const raw = product.querySelector('.owned')?.textContent?.trim() || ''
            return raw ? window.Alakazam.parse.firstNumberIn(raw) : 0
        })
        const buildings =
            counts.length && counts.every(Number.isFinite)
                ? counts.reduce((sum, count) => sum + count, 0)
                : null
        const blockedReasons = [...new Set(modules.map(mod => mod.restriction).filter(Boolean))]
        return {
            pageId,
            lifecycle: scheduler.isRunning() ? 'running' : 'starting',
            at: Date.now(),
            identity: { known: who.known, legacyId: who.legacyId, runId: who.runId },
            save: save.stats(),
            language: scheduler.language(),
            paused: scheduler.isPaused() || store.setting('enabled') === false,
            hudVisible: store.setting('hud') !== false,
            cookies: globals.cookies,
            cps: globals.cps,
            buildings,
            decision: window.__alakazam.decision?.reason || '',
            modules,
            blockedReasons,
            storageError: store.error(),
            publicationError
        }
    }

    function publish() {
        if (inFlight) return inFlight
        latest = snapshot()
        if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return Promise.resolve(latest)
        inFlight = new Promise(resolve => {
            try {
                chrome.runtime.sendMessage({ type: 'alakazam:publish', status: latest }, result => {
                    publicationError = chrome.runtime.lastError?.message || result?.error || ''
                    latest = result?.status || { ...latest, publicationError }
                    resolve(latest)
                })
            } catch (error) {
                publicationError = error.message
                latest = { ...latest, publicationError }
                resolve(latest)
            }
        }).finally(() => {
            inFlight = null
        })
        return inFlight
    }

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender, respond) => {
            if (message?.type !== 'alakazam:get-status') return
            publish().then(status => respond({ status }))
            return true
        })
    }
    registry.register({ name: 'status', interval: 1000, always: true, tick: publish })
    window.Alakazam.status = { snapshot, publish, latest: () => latest }
})()
