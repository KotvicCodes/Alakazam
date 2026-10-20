;(function () {
    //! Compact In-Page HUD
    const { store, scheduler, registry, live, save, act, ui, status } = window.Alakazam
    const { formatNumber, formatDuration } = window.Alakazam.parse
    const { text } = ui
    let root, body, summaryBody, pauseButton, foldButton, stripStatus, controls
    let dock = 'bottom-left'
    let dragPosition = null
    const cells = new Map()
    let cellIndex = 0
    let currentSection = ''
    let seen = new Set()

    const CSS = `
#alakazam-hud { position:fixed; z-index:2147483000; box-sizing:border-box; width:350px;
 max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); overflow:auto;
 background:#221810; color:#e9e2d0; border:1px solid #8a7048; border-radius:6px;
 box-shadow:0 3px 14px #0009; font:12px/1.45 system-ui,sans-serif; }
#alakazam-hud [hidden] { display:none !important; }
#alakazam-hud-head { display:flex; align-items:center; gap:6px; padding:5px; cursor:grab; touch-action:none; }
#alakazam-hud-title { font-weight:bold; color:#f2c98a; }
#alakazam-hud-state { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#alakazam-hud button { font:inherit; cursor:pointer; color:#e9e2d0; background:#38291d;
 border:1px solid #8a7048; border-radius:4px; padding:5px 7px; min-height:30px; }
#alakazam-hud button:hover { background:#503c28; }
#alakazam-hud button:focus-visible { outline:3px solid #ffe0a0; outline-offset:1px; }
#alakazam-hud button[aria-pressed=true] { border-color:#d3ae6e; }
#alakazam-hud-body { padding:8px; max-height: min(500px, calc(100vh - 90px)); overflow:auto; }
#alakazam-hud fieldset { margin:8px 0; padding:5px; border:1px solid #6b563a; display:grid; grid-template-columns:1fr 1fr; gap:5px; }
#alakazam-hud legend { color:#f2c98a; padding:0 4px; }
#alakazam-hud fieldset button { text-align:left; }
#alakazam-hud small { display:block; color:#cec0a8; font-size:11px; }
#alakazam-hud .az-row { display:flex; justify-content:space-between; gap:10px; padding:2px 0; }
#alakazam-hud .az-row span:last-child { text-align:right; overflow-wrap:anywhere; color:#f2c98a; }
#alakazam-hud .az-sec { color:#cec0a8; border-top:1px solid #6b563a; padding-top:6px; margin-top:6px; }
#alakazam-hud .az-warn { color:#ffd18b !important; }
`

    function el(tag, props) {
        const node = document.createElement(tag)
        Object.assign(node, props || {})
        return node
    }

    function button(id, label, click) {
        const node = el('button', { id, type: 'button', textContent: label })
        node.addEventListener('click', click)
        return node
    }

    function build() {
        document.head.appendChild(el('style', { textContent: CSS }))
        root = el('section', { id: 'alakazam-hud' })
        root.setAttribute('aria-label', 'Alakazam automation')
        const head = el('div', { id: 'alakazam-hud-head' })
        const title = el('span', { id: 'alakazam-hud-title', textContent: 'Alakazam' })
        stripStatus = el('span', { id: 'alakazam-hud-state' })
        pauseButton = button('alakazam-hud-pause', 'Pause', () => {
            store.setSetting('enabled', store.setting('enabled') === false)
            render()
        })
        foldButton = button('alakazam-hud-fold', 'Configure', () => {
            body.hidden = !body.hidden
            store.set('hudFolded', body.hidden)
            render()
        })
        foldButton.setAttribute('aria-controls', 'alakazam-hud-body')
        head.append(title, stripStatus, pauseButton, foldButton)
        body = el('div', { id: 'alakazam-hud-body' })
        body.hidden = store.get('hudFolded', true)
        const dockButton = button('alakazam-hud-dock', 'Dock: bottom left', () => {
            const docks = ['bottom-left', 'top-left', 'bottom-center']
            dock = docks[(docks.indexOf(dock) + 1) % docks.length]
            store.set('hudDock', dock)
            store.forget('hudPosition')
            place()
            text(dockButton, `Dock: ${dock.replace('-', ' ')}`)
        })
        body.appendChild(dockButton)
        controls = ui.buildControls(body, key => store.setSetting(key, store.setting(key) === false))
        summaryBody = el('div')
        body.appendChild(summaryBody)
        root.append(head, body)
        document.body.appendChild(root)
        dock = store.get('hudDock', 'bottom-left')
        text(dockButton, `Dock: ${dock.replace('-', ' ')}`)
        place()
        makeDraggable(head)
        window.addEventListener('resize', () => place())
        document.addEventListener('fullscreenchange', () => place())
    }

    function clamp(value, low, high) {
        return Math.max(low, Math.min(value, Math.max(low, high)))
    }

    function place(position = dragPosition || store.get('hudPosition', null)) {
        if (!root) return
        const width = root.offsetWidth
        const height = root.offsetHeight
        const left = position
            ? parseFloat(position.left)
            : dock === 'bottom-center'
              ? (window.innerWidth - width) / 2
              : 8
        const top = position
            ? parseFloat(position.top)
            : dock === 'top-left'
              ? 40
              : window.innerHeight - height - 8
        root.style.left = `${clamp(Number.isFinite(left) ? left : 8, 8, window.innerWidth - width - 8)}px`
        root.style.top = `${clamp(Number.isFinite(top) ? top : 8, 8, window.innerHeight - height - 8)}px`
    }

    function remember() {
        store.set('hudPosition', { left: root.style.left, top: root.style.top })
    }

    function makeDraggable(handle) {
        let pointer = null
        let offsetX = 0,
            offsetY = 0
        handle.addEventListener('pointerdown', event => {
            if (!event.isTrusted || event.button !== 0) return
            if ([pauseButton, foldButton].some(node => node.contains(event.target))) return
            pointer = event.pointerId
            const rect = root.getBoundingClientRect()
            offsetX = event.clientX - rect.left
            offsetY = event.clientY - rect.top
            dragPosition = { left: rect.left, top: rect.top }
            handle.setPointerCapture(pointer)
            event.preventDefault()
        })
        handle.addEventListener('pointermove', event => {
            if (pointer === null || event.pointerId !== pointer || !event.isTrusted) return
            dragPosition = { left: event.clientX - offsetX, top: event.clientY - offsetY }
            place()
        })
        const release = event => {
            if (pointer === null || event.pointerId !== pointer) return
            if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer)
            pointer = null
            remember()
            dragPosition = null
        }
        handle.addEventListener('pointerup', release)
        handle.addEventListener('pointercancel', release)
    }

    // Reuse cells, inserting only those that are out of summary order. Readings
    // can first appear long after their section's initial render.
    function showCell(key) {
        const cell = cells.get(key)
        const next = summaryBody.children[cellIndex++] || null
        if (cell.node !== next) summaryBody.insertBefore(cell.node, next)
        cell.node.hidden = false
        seen.add(key)
        return cell
    }

    function section(name) {
        currentSection = name
        const key = `section:${name}`
        if (!cells.has(key)) {
            const node = el('div', { className: 'az-sec', textContent: name })
            cells.set(key, { node })
        }
        showCell(key)
    }

    function row(label, value, warn) {
        const key = `${currentSection}:${label}`
        if (!cells.has(key)) {
            const node = el('div', { className: 'az-row' })
            const labelNode = el('span', { textContent: label })
            const valueNode = el('span')
            node.append(labelNode, valueNode)
            cells.set(key, { node, valueNode })
        }
        const cell = showCell(key)
        text(cell.valueNode, value)
        cell.valueNode.className = warn ? 'az-warn' : ''
    }

    //* paybackText
    // An upgrade whose tooltip could not be parsed is still bought, so its row
    // says why there is no number rather than showing a blank or a misleading
    // "never".
    function paybackText(decision) {
        if (Number.isFinite(decision.payback)) return formatDuration(decision.payback)
        return decision.action === 'buyUpgrade' ? 'effect not readable' : '-'
    }

    //* dragonText
    // one row's worth of dragon: how grown it is and what it is wearing, or what it
    // is waiting for while it is neither. Everything else about it, including the
    // comparison of every aura, goes to the console.
    function dragonText(dragon) {
        const level = `lvl ${dragon.level}/${dragon.max}`
        if (dragon.waiting) return `${level}, ${dragon.waiting}`
        const worn = dragon.aura2 ? `${dragon.aura} + ${dragon.aura2}` : dragon.aura
        return `${level}, ${worn}`
    }

    function summary() {
        const debug = window.__alakazam
        const globals = live.readGlobals()

        // the bank and CpS used to lead this section. Both are rendered by the game
        // in letters twice the size, a few inches above the panel, so the panel was
        // spending its two best rows repeating them.
        section('game')
        const click = window.Alakazam.clicks.stats()
        if (click.clickCps > 0) {
            row('from clicking', format(click.clickCps))
            row('effective', format(globals.cps + click.clickCps))
        }
        // how many clicks the game acts on. what we dispatch used to be shown
        // alongside it and was only ever noise: it is not a number anyone can do
        // anything with, and it made the real one look broken by comparison.
        row(
            'clicks',
            click.measured ? `${click.registeredPerSecond}/s` : `~${click.registeredPerSecond}/s`
        )
        // the action is dropped: every reason already says what it is, and the
        // panel spent nearly all its time showing the word "wait"
        row('decision', debug.decision ? debug.decision.reason : 'starting up')
        // payback on its own row. it used to be inside the reason, which made a
        // sentence long enough to wrap over three lines of the panel
        if (debug.decision) {
            row('payback', paybackText(debug.decision))
        }

        // how much of the store has been catalogued was a progress bar for a job
        // nobody is waiting on: it fills in seconds and never comes up again
        if (!act.store.available()) row('bulk controls', 'not found', true)

        // one row for the dragon, because there is one decision in it worth seeing:
        // which aura is in, or what it is waiting for
        if (debug.dragon) {
            row('dragon', dragonText(debug.dragon))
        }

        const saveStats = save.stats()
        section('save')
        // the version and the note about it are gone. The note said the game was
        // newer than the parser had been read against, which was true of every
        // version after the list in savefile.js and told nobody anything: the parse
        // is trusted or not on its own invariants, and that is what `why` says.
        row('read', saveStats.ok ? `${saveStats.secondsSinceChange}s ago` : 'failed', !saveStats.ok)
        // the reason names the step that failed, so it is worth showing whenever
        // there is one, not only when the parse came out stale
        if (saveStats.reason) row(saveStats.ok ? 'note' : 'why', saveStats.reason, true)
        // only when it is not where it should be, which is the interesting case
        if (saveStats.key && saveStats.key !== 'CookieClickerGame') {
            row('found in', saveStats.key)
        }

        // only while it is actually running: the rest of a run is the ordinary
        // one-at-a-time buying and needs no row of its own
        if (debug.buyAll && debug.buyAll.sweeping) {
            row('buying', `all upgrades, ${debug.buyAll.minutesLeft.toFixed(1)}m left`)
        }

        if (debug.lumps) {
            section('sugar lumps')
            row('banked', debug.lumps.lumps)
            row('current', debug.lumps.type)
            row('ripe in', debug.lumps.ripe ? 'ready now' : `${debug.lumps.hoursToRipe.toFixed(1)}h`)
            // on an upgraded save this is hours below the 24 the guides quote,
            // and until it has been read off the lump it is only the base
            row(
                'lives for',
                `${debug.lumps.lifeSpanHours.toFixed(1)}h` + (debug.lumps.measured ? '' : ' (assumed)')
            )
        }

        if (debug.garden) {
            section('garden')
            row('seeds', debug.garden.unlocked)
            row('goal', debug.garden.goal)
        }

        if (debug.grimoire) {
            section('grimoire')
            row('magic', `${Math.floor(debug.grimoire.magic)}/${debug.grimoire.magicM}`)
            row('next cast', `${Math.round(debug.grimoire.secondsToFthof)}s`)
        }

        // the pantheon section is gone: the temple shows its own swaps and its own
        // slots, and what Alakazam thinks of a layout is a table too wide for a
        // panel. window.Alakazam.pantheon.explain() prints it.

        if (debug.market) {
            section('stock market')
            row('trading', debug.market.trading ? 'on' : 'advisory only')
            row('signals', debug.market.signals.slice(0, 3).join(', ') || 'nothing notable')
        }

        if (debug.ascend) {
            section('ascension')
            if (debug.ascend.blocked) {
                row('status', debug.ascend.blocked, true)
            } else {
                row('prestige', `${format(debug.ascend.current)} lvl`)
                row('chips banked', format(debug.ascend.chipsBanked))
                // what the plan still wants, which is the whole of the decision:
                // it comes down as upgrades are bought and as chips are banked. What
                // ascending would pay right now was next to it and was the same
                // number from the other side, and the sentence naming the rule in
                // force belongs in the log rather than wrapped over three rows.
                if (debug.ascend.chipsNeeded > 0) {
                    row('planned', `${format(debug.ascend.chipsNeeded)} chips`)
                }
                if (debug.ascend.cookiesToTarget > 0) {
                    row('still needs', format(debug.ascend.cookiesToTarget))
                }
                row('phase', debug.ascend.phase)
                if (debug.ascend.loans && debug.ascend.loans.length > 0) {
                    row('loans taken', debug.ascend.loans.join(', '))
                }
                if (debug.ascend.loanWindow !== null && debug.ascend.loanWindow !== undefined) {
                    row('window closes', `${debug.ascend.loanWindow}s`)
                }
                if (debug.ascend.bought && debug.ascend.bought.length > 0) {
                    row('bought', debug.ascend.bought.length)
                }
                // the hoard is only at risk once the run is actually ending
                if (debug.ascend.wrinklerHoard > 0 && debug.ascend.phase !== 'watching') {
                    row('hoard at risk', format(debug.ascend.wrinklerHoard), true)
                }
            }
        }

        // a held code is now redeemed here rather than by hand, so this says where
        // the sequence has got to rather than instructing anyone
        if (debug.gifts && debug.gifts.code) {
            section('gift code')
            row('redeeming', debug.gifts.redeemable ? 'now' : 'once the gifted out hour is up')
            row('expires in', `${debug.gifts.expiresInHours}h`)
        }

        if (debug.wrinklers && debug.wrinklers.active > 0) {
            section('wrinklers')
            row('on the cookie', debug.wrinklers.active)
            if (debug.wrinklers.worthPopping) row('advice', 'pop them by hand', true)
        }

        const broken = scheduler.stats().filter(m => m.disabled || m.failures > 0)
        if (broken.length > 0) {
            section('trouble')
            for (const m of broken) row(m.name, m.lastError, true)
        }
    }

    const format = formatNumber

    function render() {
        if (store.setting('hud') === false) {
            if (root) root.hidden = true
            return
        }
        if (!root) build()
        root.hidden = false
        const snapshot = status.snapshot()
        const paused = snapshot.paused
        text(pauseButton, store.setting('enabled') === false ? 'Resume' : 'Pause')
        pauseButton.setAttribute('aria-pressed', String(store.setting('enabled') === false))
        text(
            stripStatus,
            snapshot.modules.some(mod => mod.disabled || mod.failures)
                ? 'Failure'
                : paused
                  ? 'Paused'
                  : snapshot.blockedReasons.length
                    ? 'Restricted'
                    : 'Running'
        )
        stripStatus.title = ui.headline(snapshot)
        foldButton.setAttribute('aria-expanded', String(!body.hidden))
        ui.updateControls(controls, store.allSettings(), snapshot.modules)
        seen = new Set()
        cellIndex = 0
        summary()
        for (const [key, cell] of cells) cell.node.hidden = !seen.has(key)
        place()
    }

    function setup() {
        store.subscribe(render)
        render()
    }

    registry.register({ name: 'hud', interval: 1000, always: true, setup, tick: render })
    window.Alakazam.hud = { render, format }
})()
