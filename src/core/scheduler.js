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
    function shouldRun(mod, slot) {
        if (!running) return false
        if (slot.disabled || slot.busy) return false
        // an `always` module runs through both the master switch and a pause,
        // because it is the UI those are operated from
        if (mod.always) return true
        if (paused) return false
        return store.moduleEnabled(mod.setting)
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
        if (slot.failures >= FAILURE_LIMIT) {
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

    function stop() {
        running = false
        if (driver) clearInterval(driver)
        driver = null
    }

    function pause() {
        paused = true
    }

    function resume() {
        paused = false
    }

    function isPaused() {
        return paused
    }

    //* stats
    // what the HUD shows: how each module is doing, and why one went quiet
    function stats() {
        return registry.all().map(mod => {
            const slot = slotFor(mod)
            return {
                name: mod.name,
                interval: mod.interval,
                enabled: store.moduleEnabled(mod.setting),
                disabled: slot.disabled,
                ran: slot.ran,
                failures: slot.failures,
                lastError: slot.lastError
            }
        })
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.scheduler = { start, stop, pause, resume, isPaused, stats, budget }
})()
