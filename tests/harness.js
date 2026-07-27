//! Extension harness
// Loads the content scripts, in manifest order, into a vm context wired to a fake
// document. Returns the window.Alakazam namespace plus the pieces a test needs to
// poke at the page.

const fs = require('fs')
const vm = require('vm')
const path = require('path')
const game = require('./game')

const ROOT = path.join(__dirname, '..')

function boot(opts = {}) {
    const g = game.build(opts.game || {})
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))
    // main.js is the page bootstrap: it waits three seconds and then starts the
    // scheduler on its own. Tests drive the scheduler themselves, so it is left
    // out unless a test explicitly asks for the real boot sequence.
    const files = manifest.content_scripts[0].js.filter(
        f => opts.includeMain === true || f !== 'src/main.js'
    )

    const disk = opts.disk || {}
    const storageListeners = []
    const chrome = {
        storage: {
            local: {
                get: (keys, cb) => {
                    const o = {}
                    for (const k of keys) if (k in disk) o[k] = disk[k]
                    cb(o)
                },
                set: (obj, cb) => {
                    const changes = {}
                    for (const k in obj) {
                        changes[k] = { oldValue: disk[k], newValue: obj[k] }
                        disk[k] = obj[k]
                    }
                    storageListeners.forEach(fn => fn(changes, 'local'))
                    cb && cb()
                }
            },
            onChanged: { addListener: fn => storageListeners.push(fn) }
        }
    }

    const rafQueue = []
    const events = []

    class FakeEvent {
        constructor(type, init = {}) {
            Object.assign(this, init)
            this.type = type
            this.isTrusted = false
        }
    }

    const ctx = {
        console,
        document: g.doc,
        chrome,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        requestAnimationFrame: fn => rafQueue.push(fn),
        MouseEvent: FakeEvent,
        PointerEvent: FakeEvent,
        Event: FakeEvent,
        atob: s => Buffer.from(s, 'base64').toString('binary'),
        localStorage: { getItem: k => (opts.save && k === 'CookieClickerGame' ? opts.save : null) }
    }
    ctx.window = ctx
    ctx.PointerEvent = FakeEvent
    vm.createContext(ctx)

    for (const f of files) {
        vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f })
    }

    return {
        A: ctx.window.Alakazam,
        debug: () => ctx.window.__alakazam,
        ctx,
        game: g,
        disk,
        rafQueue,
        frame: () => {
            const q = rafQueue.splice(0, rafQueue.length)
            q.forEach(fn => fn())
        },
        events
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

module.exports = { boot, sleep, ROOT }
