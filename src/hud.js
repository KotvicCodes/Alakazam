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
    const { formatNumber, formatDuration } = window.Alakazam.parse

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
        ascend: 'Ascension',
        clones: 'Clone look',
        gifts: 'Gift codes',
        hud: 'This panel'
    }

    let root = null
    let body = null
    let lastStatusAt = 0

    // The panel sits on top of the game, so it is styled to look like part of it:
    // dark roasted brown, cream text outlined in black, and gold on anything that
    // is a number, which is how Cookie Clicker draws its own furniture. The same
    // palette is in popup.css, which cannot be shared with this file because this
    // stylesheet is injected into the game's document rather than linked. Change a
    // colour in one and change it in the other.
    //
    // Every id and class is prefixed so the extension's own selectors, which scan
    // the game's DOM, can never mistake the panel for part of the store.
    const CSS = `
#alakazam-hud {
    position: fixed; top: 12px; right: 12px; width: 268px; z-index: 2147483000;
    font: 11px/1.45 ui-monospace, Menlo, Consolas, monospace;
    color: #e9e2d0;
    background: linear-gradient(180deg, rgba(43,31,20,0.97) 0%, rgba(28,20,13,0.97) 55%, rgba(20,13,8,0.97) 100%);
    border: 1px solid #6b563a; border-radius: 5px;
    box-shadow: 0 6px 22px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,240,214,0.09);
    user-select: none;
}
#alakazam-hud-head {
    display: flex; align-items: center; justify-content: space-between; gap: 6px;
    padding: 5px 8px; cursor: move;
    background: linear-gradient(180deg, rgba(122,98,66,0.5) 0%, rgba(74,58,38,0.5) 100%);
    border-bottom: 1px solid #6b563a; border-radius: 4px 4px 0 0;
    box-shadow: inset 0 1px 0 rgba(255,240,214,0.12);
}
#alakazam-hud-title {
    font-family: Georgia, 'Times New Roman', serif; font-size: 12px; font-weight: 700;
    letter-spacing: 0.03em; color: #f2c98a;
    text-shadow: 0 1px 0 rgba(0,0,0,0.85), 0 0 10px rgba(232,178,58,0.25);
}
#alakazam-hud-fold {
    cursor: pointer; padding: 0 5px; border: 1px solid #6b563a; border-radius: 2px;
    background: rgba(0,0,0,0.28); color: #a5906c;
}
#alakazam-hud-fold:hover { color: #e9e2d0; background: rgba(0,0,0,0.4); }
#alakazam-hud-body { padding: 7px 8px 9px; max-height: 62vh; overflow-y: auto; }
#alakazam-hud .az-row { display: flex; justify-content: space-between; gap: 8px; }
#alakazam-hud .az-row span:first-child { color: #a5906c; }
#alakazam-hud .az-row span:last-child {
    color: #f2c98a; text-align: right; word-break: break-word;
    text-shadow: 0 1px 0 rgba(0,0,0,0.75);
}
#alakazam-hud .az-sec {
    margin: 7px 0 3px; padding-top: 5px; border-top: 1px solid rgba(107,86,58,0.5);
    color: #8a7355; text-transform: uppercase; font-size: 9px; letter-spacing: 0.09em;
}
#alakazam-hud .az-toggles { display: flex; flex-wrap: wrap; gap: 3px; }
#alakazam-hud .az-tog {
    cursor: pointer; padding: 2px 5px; border-radius: 2px; font-size: 10px;
    border: 1px solid #5a4830; background: rgba(0,0,0,0.32); color: #7d6f57;
    text-shadow: 0 1px 0 rgba(0,0,0,0.75);
}
#alakazam-hud .az-tog:hover { color: #e9e2d0; }
/* an enabled module is the same brown lit from within rather than a second
   colour, so a dozen of them on at once does not turn the panel into a paint box */
#alakazam-hud .az-tog.on {
    background: rgba(232,178,58,0.11); border-color: #8a7048; color: #e9e2d0;
}
#alakazam-hud .az-tog.on:hover { background: rgba(232,178,58,0.18); }
/* the master switch is the exception: it is the control that turns everything
   back on, so it is the one thing worth reading across the room */
#alakazam-hud .az-tog.master {
    flex: 1 0 100%; text-align: center; padding: 3px; font-weight: 700;
    letter-spacing: 0.08em; background: #4f7d3a; border-color: #6fa653; color: #f0f7e8;
}
#alakazam-hud .az-tog.master.off { background: #7d3a3a; border-color: #a65353; color: #f7e8e8; }
#alakazam-hud.az-folded #alakazam-hud-body { display: none; }
#alakazam-hud .az-warn { color: #d98a4a; }
#alakazam-hud.az-dragging {
    opacity: 0.9; box-shadow: 0 12px 34px rgba(0,0,0,0.75); transform: scale(1.02);
}
#alakazam-hud.az-dragging #alakazam-hud-head {
    cursor: grabbing;
    background: linear-gradient(180deg, rgba(158,128,86,0.6) 0%, rgba(104,82,54,0.6) 100%);
}
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

        // the fold button lives inside the drag handle, so the drag has to be told
        // to leave it alone: see the note in makeDraggable
        makeDraggable(head, fold)
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
    //
    // `ignore` is what makes the minimize button work. Pointer capture retargets
    // every later pointer event, and the click, at the capturing element. The fold
    // button sits inside the header, so grabbing it started a drag on the header,
    // the header swallowed the click, and the button did nothing at all: it moved
    // the panel instead. A pointerdown that starts on the button is left alone.
    function makeDraggable(handle, ignore) {
        let pointer = null

        handle.addEventListener('pointerdown', event => {
            // real input only. the autoclicker fires a stream of synthetic pointer
            // events at the big cookie and they bubble everywhere.
            if (!event.isTrusted || event.button !== 0) return
            if (ignore && (event.target === ignore || ignore.contains(event.target))) return
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

    //* paybackText
    // An upgrade whose tooltip could not be parsed is still bought, so its row
    // says why there is no number rather than showing a blank or a misleading
    // "never".
    function paybackText(decision) {
        if (Number.isFinite(decision.payback)) return formatDuration(decision.payback)
        return decision.action === 'buyUpgrade' ? 'effect not readable' : '-'
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
            html += row('from clicking', format(click.clickCps))
            html += row('effective', format(globals.cps + click.clickCps))
        }
        // how many clicks the game acts on. what we dispatch used to be shown
        // alongside it and was only ever noise: it is not a number anyone can do
        // anything with, and it made the real one look broken by comparison.
        html += row(
            'clicks',
            click.measured ? `${click.registeredPerSecond}/s` : `~${click.registeredPerSecond}/s`
        )
        // the action is dropped: every reason already says what it is, and the
        // panel spent nearly all its time showing the word "wait"
        html += row('decision', debug.decision ? debug.decision.reason : 'starting up')
        // payback on its own row. it used to be inside the reason, which made a
        // sentence long enough to wrap over three lines of the panel
        if (debug.decision) {
            html += row('payback', paybackText(debug.decision))
        }

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
        // the reason names the step that failed, so it is worth showing whenever
        // there is one, not only when the parse came out stale
        if (saveStats.reason) html += row(saveStats.ok ? 'note' : 'why', saveStats.reason, true)
        // only when it is not where it should be, which is the interesting case
        if (saveStats.key && saveStats.key !== 'CookieClickerGame') {
            html += row('found in', saveStats.key)
        }
        if (debug.identity) html += row('save id', debug.identity.legacyId)

        if (debug.lumps) {
            html += section('sugar lumps')
            html += row('banked', debug.lumps.lumps)
            html += row('current', debug.lumps.type)
            html += row(
                'ripe in',
                debug.lumps.ripe ? 'ready now' : `${debug.lumps.hoursToRipe.toFixed(1)}h`
            )
            // on an upgraded save this is hours below the 24 the guides quote,
            // and until it has been read off the lump it is only the base
            html += row(
                'lives for',
                `${debug.lumps.lifeSpanHours.toFixed(1)}h` + (debug.lumps.measured ? '' : ' (assumed)')
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

        if (debug.ascend) {
            html += section('ascension')
            if (debug.ascend.blocked) {
                html += row('status', debug.ascend.blocked, true)
            } else {
                html += row('prestige', `${format(debug.ascend.current)} lvl`)
                html += row('chips banked', format(debug.ascend.chipsBanked))
                html += row('ascending pays', `${format(debug.ascend.chipsGained)} chips`)
                // the target is the plan's, and past the plan there is not one to
                // name; the reason line says which rule is in force either way
                html += row('plan', debug.ascend.why)
                if (debug.ascend.cookiesToTarget > 0) {
                    html += row('still needs', format(debug.ascend.cookiesToTarget))
                }
                html += row('phase', debug.ascend.phase)
                if (debug.ascend.loans && debug.ascend.loans.length > 0) {
                    html += row('loans taken', debug.ascend.loans.join(', '))
                }
                if (debug.ascend.loanWindow !== null && debug.ascend.loanWindow !== undefined) {
                    html += row('window closes', `${debug.ascend.loanWindow}s`)
                }
                if (debug.ascend.bought && debug.ascend.bought.length > 0) {
                    html += row('bought', debug.ascend.bought.length)
                }
                // the hoard is only at risk once the run is actually ending
                if (debug.ascend.wrinklerHoard > 0 && debug.ascend.phase !== 'watching') {
                    html += row('hoard at risk', format(debug.ascend.wrinklerHoard), true)
                }
            }
        }

        // the code is the deliverable, so it gets its own section and the whole
        // string: it is meant to be selected and pasted back into the game
        if (debug.gifts && debug.gifts.code) {
            html += section('gift code')
            html += row('redeem in', 'Options -> Redeem')
            html += row('after', 'your next ascension')
            html += row('expires in', `${debug.gifts.expiresInHours}h`)
            html += row('code', debug.gifts.code)
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

    // the panel used to carry its own magnitude table, which stopped at 10^24 and
    // rendered anything past that as seventeen digits and a wrong suffix. the
    // shared one in parse.js is the game's own, all the way up.
    const format = formatNumber

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
