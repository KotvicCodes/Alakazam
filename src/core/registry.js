// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Module Registry
    // Every behaviour Alakazam has is a module that registers itself here at load
    // time. main.js does not import any of them and does not know their names, so
    // adding a module means adding one file plus one manifest line, and the load
    // order in the manifest only has to be right for src/core.
    //
    // A module is:
    //   name      unique, and by default also the settings key that gates it
    //   interval  'frame' to run once per animation frame, or milliseconds
    //   tick(ctx) the work. may be async; the scheduler will not re-enter it
    //   setting   optional settings key when it differs from the name
    //   setup()   optional one-off, awaited once before the first tick
    //
    // Nothing here runs anything: the scheduler owns all cadence.

    const modules = []

    //* register
    // called at file load time by each module. duplicate names replace the older
    // registration so reloading a script during development does not double up.
    function register(mod) {
        if (!mod || !mod.name || typeof mod.tick !== 'function') {
            console.warn('Alakazam: ignoring malformed module', mod && mod.name)
            return
        }
        const entry = {
            name: mod.name,
            interval: mod.interval === 'frame' ? 'frame' : Math.max(0, mod.interval || 1000),
            setting: mod.setting || mod.name,
            // `always` modules ignore the master switch. only the HUD uses it, and
            // it has to: pausing everything must not freeze the one piece of UI
            // that can unpause it again
            always: mod.always === true,
            setup: typeof mod.setup === 'function' ? mod.setup : null,
            tick: mod.tick
        }
        const existing = modules.findIndex(m => m.name === entry.name)
        if (existing !== -1) modules[existing] = entry
        else modules.push(entry)
    }

    function all() {
        return modules.slice()
    }

    function get(name) {
        return modules.find(m => m.name === name) || null
    }

    // the shared console debug handle. created here rather than in main.js so a
    // module can never tick before it exists, whatever the boot order turns out
    // to be; main.js fills in the identity and save once it has them.
    window.__alakazam = window.__alakazam || {}

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.registry = { register, all, get }
})()
