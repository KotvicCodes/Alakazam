// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! In-Page HUD
    // A panel over the game showing what Alakazam is doing and letting each module
    // be switched off. Until now the only way to see any of this was the console,
    // and the only way to change anything was to edit a constant and reload.
    //
    // It also writes a status summary into storage every few seconds so the
    // toolbar popup, which runs in a different context and cannot see this page,
    // has something to display.
    //
    // Everything is namespaced under alakazam- ids so the extension's own
    // selectors can never pick its panel up as part of the game.

    const { store, scheduler, registry, live, catalog, save, act } = window.Alakazam

    const INTERVAL_MS = 1000
    const STATUS_WRITE_MS = 5000

    const LABELS = {
        enabled: 'Master switch',
        autoclick: 'Autoclicker',
        shimmers: 'Golden cookies',
        wrinklers: 'Wrinklers',
        purchase: 'Buying',
        lumps: 'Sugar lumps',
        grimoire: 'Grimoire',
        pantheon: 'Pantheon',
        garden: 'Garden',
        achievements: 'Achievements',
        marketTrading: 'Stock trading',
        hud: 'This panel'
    }

    let root = null
    let body = null
    let lastStatusAt = 0

    const CSS = `
#alakazam-hud {
    position: fixed; top: 12px; right: 12px; width: 268px; z-index: 2147483000;
    font: 11px/1.45 ui-monospace, Menlo, Consolas, monospace;
    color: #e9e2d0; background: rgba(24,18,12,0.94);
    border: 1px solid #6b563a; border-radius: 6px;
    box-shadow: 0 6px 22px rgba(0,0,0,0.55); user-select: none;
}
#alakazam-hud-head {
    display: flex; align-items: center; justify-content: space-between; gap: 6px;
    padding: 6px 8px; cursor: move; background: rgba(107,86,58,0.35);
    border-bottom: 1px solid #6b563a; border-radius: 5px 5px 0 0;
}
#alakazam-hud-title { font-weight: 700; letter-spacing: 0.04em; }
#alakazam-hud-fold {
    cursor: pointer; padding: 0 5px; border: 1px solid #6b563a; border-radius: 3px;
    background: rgba(0,0,0,0.25);
}
#alakazam-hud-body { padding: 7px 8px 9px; max-height: 62vh; overflow-y: auto; }
#alakazam-hud .az-row { display: flex; justify-content: space-between; gap: 8px; }
#alakazam-hud .az-row span:last-child { color: #f2c98a; text-align: right; word-break: break-word; }
#alakazam-hud .az-sec {
    margin: 7px 0 3px; padding-top: 5px; border-top: 1px solid rgba(107,86,58,0.5);
    color: #a5906c; text-transform: uppercase; font-size: 9px; letter-spacing: 0.09em;
}
#alakazam-hud .az-toggles { display: flex; flex-wrap: wrap; gap: 3px; }
#alakazam-hud .az-tog {
    cursor: pointer; padding: 2px 5px; border-radius: 3px; font-size: 10px;
    border: 1px solid #6b563a; background: rgba(0,0,0,0.3); color: #8a7c62;
}
#alakazam-hud .az-tog.on { background: #4f7d3a; border-color: #6fa653; color: #f0f7e8; }
#alakazam-hud .az-tog.master { flex: 1 0 100%; text-align: center; padding: 3px; }
#alakazam-hud .az-tog.master.off { background: #7d3a3a; border-color: #a65353; color: #f7e8e8; }
#alakazam-hud.az-folded #alakazam-hud-body { display: none; }
#alakazam-hud .az-warn { color: #e0894f; }
#alakazam-hud.az-dragging {
    opacity: 0.88; box-shadow: 0 12px 34px rgba(0,0,0,0.7); transform: scale(1.02);
}
#alakazam-hud.az-dragging #alakazam-hud-head { cursor: grabbing; background: rgba(143,116,78,0.55); }
`

    //! Building the panel

    function el(tag, props) {
        const node = document.createElement(tag)
        Object.assign(node, props || {})
        return node
    }

    function build() {
        const style = el('style', { textContent: CSS })
        document.head.appendChild(style)

        root = el('div', { id: 'alakazam-hud' })
        const head = el('div', { id: 'alakazam-hud-head' })
        // the loaded version, straight from the manifest. worth showing: knowing
        // which build is actually running in the tab is otherwise guesswork.
        const version =
            typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest
                ? chrome.runtime.getManifest().version
                : ''
        const title = el('div', {
            id: 'alakazam-hud-title',
            textContent: version ? `ALAKAZAM v${version}` : 'ALAKAZAM'
        })
        const fold = el('div', { id: 'alakazam-hud-fold', textContent: '-' })
        head.appendChild(title)
        head.appendChild(fold)

        body = el('div', { id: 'alakazam-hud-body' })
        root.appendChild(head)
        root.appendChild(body)
        document.body.appendChild(root)

        if (store.get('hudFolded', false)) root.classList.add('az-folded')

        // put the panel back where it was left last time
        const position = store.get('hudPosition', null)
        if (position && position.left) {
            root.style.left = position.left
            root.style.top = position.top
            root.style.right = 'auto'
        }

        fold.addEventListener('click', event => {
            event.stopPropagation()
            const folded = root.classList.toggle('az-folded')
            fold.textContent = folded ? '+' : '-'
            store.set('hudFolded', folded)
        })
        fold.textContent = root.classList.contains('az-folded') ? '+' : '-'

        makeDraggable(head)
    }

    //* makeDraggable
    // Real listeners on real events: this is our own UI, not the game, so there is
    // nothing to simulate here.
    //
    // The isTrusted checks are load bearing, not defensive. The autoclicker fires
    // around fifty synthetic mousemove events every frame at the big cookie, and
    // those bubble all the way to the document. Without this the panel followed
    // them and snapped to the cookie the instant you grabbed it, which looked like
    // it was jumping to wherever you had clicked.
    function makeDraggable(handle) {
        let pointer = null

        handle.addEventListener('pointerdown', event => {
            // real input only. the autoclicker fires a stream of synthetic pointer
            // events at the big cookie and they bubble everywhere.
            if (!event.isTrusted || event.button !== 0) return
            pointer = event.pointerId

            // Pointer capture is the reason this works at all. Listening on the
            // document meant competing with everything else on the page for the
            // move events; capturing routes them straight here for the whole drag,
            // whatever the cursor happens to be over.
            if (handle.setPointerCapture) handle.setPointerCapture(pointer)

            root.classList.add('az-dragging')
            // snap the panel under the cursor rather than preserving the grab
            // offset. this is deliberate: it is the bit that felt good to grab.
            moveTo(event.clientX, event.clientY)
            event.preventDefault()
        })

        handle.addEventListener('pointermove', event => {
            if (pointer === null || event.pointerId !== pointer || !event.isTrusted) return
            moveTo(event.clientX, event.clientY)
        })

        const release = event => {
            if (pointer === null || (event && event.pointerId !== pointer)) return
            if (handle.releasePointerCapture && handle.hasPointerCapture(pointer)) {
                handle.releasePointerCapture(pointer)
            }
            pointer = null
            root.classList.remove('az-dragging')
            remember()
        }
        handle.addEventListener('pointerup', release)
        handle.addEventListener('pointercancel', release)
    }

    //* moveTo
    // centre the panel's header on a point, clamped so it can never be dragged
    // somewhere it cannot be grabbed again
    function moveTo(x, y) {
        const width = root.offsetWidth || 268
        const header = root.firstChild ? root.firstChild.offsetHeight || 26 : 26
        const left = clamp(x - width / 2, 4, window.innerWidth - width - 4)
        const top = clamp(y - header / 2, 4, window.innerHeight - header - 4)
        root.style.left = `${left}px`
        root.style.top = `${top}px`
        root.style.right = 'auto'
    }

    //* remember
    // the panel stays where you put it, across reloads
    function remember() {
        store.set('hudPosition', { left: root.style.left, top: root.style.top })
    }

    // low wins over high, so a viewport too small for the panel pins it to the
    // top left rather than collapsing to a negative position
    function clamp(value, low, high) {
        return Math.max(low, Math.min(value, Math.max(low, high)))
    }

    //! Rendering

    function row(label, value, warn) {
        return `<div class="az-row"><span>${label}</span><span class="${warn ? 'az-warn' : ''}">${escape(value)}</span></div>`
    }

    function section(name) {
        return `<div class="az-sec">${name}</div>`
    }

    function escape(value) {
        return String(value === undefined || value === null ? '-' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
    }

    function toggles() {
        const settings = store.allSettings()
        let html = '<div class="az-toggles">'
        const master = settings.enabled !== false
        html += `<div class="az-tog master ${master ? 'on' : 'off'}" data-key="enabled">${
            master ? 'RUNNING' : 'PAUSED'
        }</div>`
        for (const key of Object.keys(LABELS)) {
            if (key === 'enabled') continue
            const on = settings[key] !== false
            html += `<div class="az-tog ${on ? 'on' : ''}" data-key="${key}">${LABELS[key]}</div>`
        }
        return html + '</div>'
    }

    function summary() {
        const debug = window.__alakazam
        const globals = live.readGlobals()
        let html = ''

        html += section('game')
        html += row('cookies', format(globals.cookies))
        html += row('per second', format(globals.cps))
        const click = window.Alakazam.clicks.stats()
        if (click.clickCps > 0) {
            html += row('from clicking', `${format(click.clickCps)} (${click.clicksPerSecond}/s)`)
            html += row('effective', format(globals.cps + click.clickCps))
        }
        html += row(
            'decision',
            debug.decision ? `${debug.decision.action}: ${debug.decision.reason}` : 'starting up'
        )

        const cat = catalog.stats()
        html += row('catalog', `${cat.buildings} bldg / ${cat.upgrades} upg`)
        if (!act.store.available()) html += row('bulk controls', 'not found', true)

        const saveStats = save.stats()
        html += section('save')
        html += row('version', saveStats.version || 'unreadable')
        html += row(
            'read',
            saveStats.ok ? `${saveStats.secondsSinceChange}s ago` : 'failed',
            !saveStats.ok
        )
        if (saveStats.stale) html += row('warning', saveStats.reason, true)
        if (debug.identity) html += row('save id', debug.identity.legacyId)

        if (debug.lumps) {
            html += section('sugar lumps')
            html += row('banked', debug.lumps.lumps)
            html += row('current', debug.lumps.type)
            html += row(
                'ripe in',
                debug.lumps.ripe ? 'ready now' : `${debug.lumps.hoursToRipe.toFixed(1)}h`
            )
        }

        if (debug.garden) {
            html += section('garden')
            html += row('seeds', debug.garden.unlocked)
            html += row('goal', debug.garden.goal)
        }

        if (debug.grimoire) {
            html += section('grimoire')
            html += row('magic', `${Math.floor(debug.grimoire.magic)}/${debug.grimoire.magicM}`)
            html += row('next cast', `${Math.round(debug.grimoire.secondsToFthof)}s`)
        }

        if (debug.pantheon) {
            html += section('pantheon')
            html += row('swaps', debug.pantheon.swaps)
            html += row('slots wrong', debug.pantheon.wrong.length)
        }

        if (debug.market) {
            html += section('stock market')
            html += row('trading', debug.market.trading ? 'on' : 'advisory only')
            html += row('signals', debug.market.signals.slice(0, 3).join(', ') || 'nothing notable')
        }

        if (debug.wrinklers && debug.wrinklers.active > 0) {
            html += section('wrinklers')
            html += row('on the cookie', debug.wrinklers.active)
            if (debug.wrinklers.worthPopping) html += row('advice', 'pop them by hand', true)
        }

        const broken = scheduler.stats().filter(m => m.disabled)
        if (broken.length > 0) {
            html += section('trouble')
            for (const m of broken) html += row(m.name, m.lastError, true)
        }

        return html
    }

    function format(n) {
        if (!Number.isFinite(n)) return '-'
        if (n < 1000) return String(Math.round(n))
        const units = [
            [1e24, 'Sp'],
            [1e21, 'Sx'],
            [1e18, 'Qi'],
            [1e15, 'Qa'],
            [1e12, 'T'],
            [1e9, 'B'],
            [1e6, 'M'],
            [1e3, 'k']
        ]
        for (const [v, s] of units) if (n >= v) return `${(n / v).toFixed(2)}${s}`
        return String(Math.round(n))
    }

    function render() {
        if (!body) return
        body.innerHTML = toggles() + summary()
        for (const node of body.querySelectorAll('.az-tog')) {
            node.addEventListener('click', () => {
                const key = node.getAttribute('data-key')
                store.setSetting(key, store.setting(key) === false)
                render()
            })
        }
    }

    //! Status for the popup
    // the popup runs in its own context and cannot reach this page, so the bridge
    // is storage: written here, read there, no service worker in between

    function writeStatus() {
        const debug = window.__alakazam
        const globals = live.readGlobals()
        store.set('status', {
            at: Date.now(),
            cookies: globals.cookies,
            cps: globals.cps,
            decision: debug.decision ? `${debug.decision.action}: ${debug.decision.reason}` : '',
            lumps: debug.lumps ? debug.lumps.lumps : null,
            seeds: debug.garden ? debug.garden.unlocked : null,
            modules: scheduler.stats().map(m => ({ name: m.name, on: m.enabled, off: m.disabled }))
        })
    }

    //! Module

    function setup() {
        if (store.setting('hud') === false) return
        build()
        render()
        store.subscribe(render)
    }

    function tick() {
        if (store.setting('hud') === false) {
            if (root) root.style.display = 'none'
            return
        }
        if (!root) return
        root.style.display = ''
        render()

        if (Date.now() - lastStatusAt > STATUS_WRITE_MS) {
            lastStatusAt = Date.now()
            writeStatus()
        }
    }

    // `always` so the panel keeps updating even with the master switch off. It is
    // the control that turns everything back on, so it cannot be something the
    // master switch is able to stop.
    registry.register({ name: 'hud', interval: INTERVAL_MS, always: true, setup, tick })

    window.Alakazam.hud = { render, format }
})()
