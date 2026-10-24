// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Scheduler
    // One animation frame loop and one millisecond driver run every registered
    // module. This replaces the pair of hardcoded setIntervals the extension used
    // to have, and fixes the three problems they caused:
    //
    //   - a module that throws no longer takes the whole loop down with it. Each
    //     tick is isolated, and a module that keeps throwing is switched off and
    //     reported once instead of filling the console forever.
    //   - a slow module no longer delays a fast one. Ticks are never re-entered,
    //     so a measurement pass that overruns just skips its own next slot.
    //   - clicks are budgeted. Modules that act get a per-tick allowance, so a
    //     purchase drain loop cannot monopolise the frame.

    const { registry, store } = window.Alakazam

    // how often the millisecond driver wakes up to look for due modules. finer
    // than any module's interval, so cadence is accurate without a timer each.
    const DRIVER_MS = 50

    // consecutive failures before a module is switched off for the session
    const FAILURE_LIMIT = 5

    const state = new Map()
    let transitioning = false
    let running = false
    let paused = false
    let driver = null

    //* budget
    // a small allowance handed to each tick. modules that click call take() and
    // stop when it returns false, which is what keeps a drain loop bounded.
    function budget(max) {
        let left = max
        return {
            take(n) {
                const want = n || 1
                if (left < want) return false
                left -= want
                return true
            },
            get left() {
                return left
            }
        }
    }

    function slotFor(mod) {
        if (!state.has(mod.name)) {
            state.set(mod.name, {
                dueAt: 0,
                busy: false,
                failures: 0,
                disabled: false,
                ran: 0,
                lastError: ''
            })
        }
        return state.get(mod.name)
    }

    //* shouldRun
    // a module runs only when the scheduler is live, the module has not been
    // disabled by repeated failure, and both the master switch and its own
    // settings flag are on
    const INDEPENDENT = new Set(['autoclick', 'shimmers', 'wrinklers'])

    function language() {
        try {
            return (localStorage.getItem('CookieClickerLang') || 'EN').toUpperCase()
        } catch {
            return 'unknown'
        }
    }

    function restriction(mod) {
        if (mod.always || INDEPENDENT.has(mod.name)) return ''
        if (mod.name === 'clicks') return ''
        if (language() !== 'EN') return `Unsupported language: ${language()} (requires English)`
        const who = window.__alakazam.identity
        if (who && !who.known) return 'Save identity unresolved'
        return ''
    }

    function moduleState(mod, slot) {
        const blocked = restriction(mod)
        let state = 'running'
        let reason = ''
        if (slot.disabled) {
            state = 'failed'
            reason = slot.lastError || 'Module disabled after failure'
        } else if (mod.name !== 'saveWatch' && transitioning) {
            state = 'blocked'
            reason = 'Save lifecycle transition'
        } else if (!store.isReady() && !mod.always) {
            state = 'blocked'
            reason = 'Storage not ready'
        } else if (!running) {
            state = 'stopped'
        } else if (!mod.always && store.setting(mod.setting) === false) {
            state = 'off'
        } else if (blocked) {
            state = 'blocked'
            reason = blocked
        } else if (!mod.always && (paused || store.setting('enabled') === false)) {
            state = 'paused'
        } else if (mod.name === 'hud' && store.setting('hud') === false) {
            state = 'hidden'
        } else if (slot.busy) {
            state = 'busy'
        }
        return { state, reason, restriction: blocked }
    }

    function shouldRun(mod, slot) {
        const { state } = moduleState(mod, slot)
        // hidden HUD ticks still detect later enabling; status never depends on it
        return !slot.busy && ['running', 'hidden'].includes(state)
    }

    //* runTick
    // invokes one module and absorbs whatever it does wrong. handles both sync
    // and async ticks: an async tick holds its own busy flag until it settles.
    function runTick(mod, slot, ctx) {
        slot.busy = true
        let result
        try {
            result = mod.tick(ctx)
        } catch (err) {
            slot.busy = false
            noteFailure(mod, slot, err)
            return
        }

        if (!result || typeof result.then !== 'function') {
            slot.busy = false
            noteSuccess(slot)
            return
        }

        result.then(
            () => {
                slot.busy = false
                noteSuccess(slot)
            },
            err => {
                slot.busy = false
                noteFailure(mod, slot, err)
            }
        )
    }

    function noteSuccess(slot) {
        slot.failures = 0
        slot.ran++
    }

    function noteFailure(mod, slot, err) {
        slot.failures++
        slot.lastError = err && err.message ? err.message : String(err)
        if (slot.failures >= FAILURE_LIMIT && mod.name !== 'saveWatch') {
            slot.disabled = true
            console.warn(
                `Alakazam: module "${mod.name}" failed ${slot.failures} times in a row and was switched off`,
                err
            )
        }
    }

    //! Frame loop
    // modules declaring interval 'frame' run here, once per animation frame

    function frameLoop() {
        if (!running) return
        const ctx = { now: Date.now(), budget: budget(200) }
        for (const mod of registry.all()) {
            if (mod.interval !== 'frame') continue
            const slot = slotFor(mod)
            if (!shouldRun(mod, slot)) continue
            runTick(mod, slot, ctx)
        }
        requestAnimationFrame(frameLoop)
    }

    //! Millisecond driver
    // modules with a numeric interval are checked here against their own due time

    function driverTick() {
        if (!running) return
        const now = Date.now()
        for (const mod of registry.all()) {
            if (mod.interval === 'frame') continue
            const slot = slotFor(mod)
            if (now < slot.dueAt) continue
            if (!shouldRun(mod, slot)) {
                // keep the schedule moving so a disabled module does not come back
                // and immediately fire a backlog of missed ticks
                slot.dueAt = now + mod.interval
                continue
            }
            slot.dueAt = now + mod.interval
            runTick(mod, slot, { now, budget: budget(60) })
        }
    }

    //! Lifecycle

    //* start
    // runs each module's setup once, then begins both loops. setup failures
    // disable only that module.
    async function start() {
        if (running) return
        running = true

        for (const mod of registry.all()) {
            if (!mod.setup) continue
            const slot = slotFor(mod)
            try {
                await mod.setup()
            } catch (err) {
                slot.disabled = true
                slot.failures++
                slot.lastError = err && err.message ? err.message : String(err)
                console.warn(`Alakazam: module "${mod.name}" failed to set up and was switched off`, err)
            }
        }

        driver = setInterval(driverTick, DRIVER_MS)
        requestAnimationFrame(frameLoop)
        console.log(
            'Alakazam: scheduler started with',
            registry.all().length,
            'modules:',
            registry
                .all()
                .map(m => m.name)
                .join(', ')
        )
    }

    // drain old async actions before switching the namespace they write to.
    // saveWatch owns this transition and must not wait on its own busy slot.
    async function reconcile(who) {
        transitioning = true
        try {
            while ([...state.entries()].some(([name, slot]) => name !== 'saveWatch' && slot.busy)) {
                await new Promise(resolve => setTimeout(resolve, 10))
            }
            const previousIdentity = window.__alakazam.identity
            await store.ready(who)
            window.__alakazam.identity = who
            for (const mod of registry.all()) {
                if (mod.reset) await mod.reset({ previousIdentity, identity: who })
            }
        } finally {
            transitioning = false
        }
    }

    function stop() {
        window.Alakazam.transactions?.cancel()
        running = false
        window.Alakazam.safety.invalidate()
        if (driver) clearInterval(driver)
        driver = null
    }

    function pause() {
        window.Alakazam.transactions?.cancel()
        paused = true
        window.Alakazam.safety.pause()
    }

    function resume() {
        paused = false
        window.Alakazam.safety.resume()
    }

    function isPaused() {
        return paused
    }

    //* stats
    // what the HUD shows: how each module is doing, and why one went quiet
    function stats() {
        return registry.all().map(mod => {
            const slot = slotFor(mod)
            const report = moduleState(mod, slot)
            return {
                ...report,
                name: mod.name,
                setting: mod.setting,
                interval: mod.interval,
                enabled: ['running', 'busy'].includes(report.state),
                disabled: slot.disabled,
                ran: slot.ran,
                failures: slot.failures,
                lastError: slot.lastError
            }
        })
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.scheduler = {
        reconcile,
        start,
        stop,
        pause,
        resume,
        isPaused,
        isRunning: () => running,
        stats,
        budget,
        language
    }
})()
