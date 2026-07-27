// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Alakazam Main
    // Orchestrates the fair-play autoplayer: a fast loop that clicks the big cookie
    // and grabs shimmers, and a slow loop that measures the DOM, asks the strategy
    // engine for the best purchase, and executes it. All actions go through the
    // input layer's dispatched events; nothing here calls .click() or the Game API.

    console.log('Alakazam: content script loaded')

    const { simulateClick, startAutoclicker } = window.Alakazam.input
    const { snapshot } = window.Alakazam.measure
    const { decide } = window.Alakazam.strategy

    //* config
    const STARTUP_DELAY_MS = 3000 // let the game finish loading
    const SHIMMER_INTERVAL_MS = 50 // how often to look for golden cookies
    const STRATEGY_INTERVAL_MS = 2000 // how often to re-measure and buy

    //! Bootstrap
    setTimeout(() => {
        const bigCookie = document.getElementById('bigCookie')
        if (!bigCookie) {
            console.warn('Alakazam: #bigCookie not found, is this Cookie Clicker?')
            return
        }

        // fast: burst-click the big cookie every frame (fair-play dispatched events)
        startAutoclicker(bigCookie)
        console.log('Alakazam: autoclicker started')

        // fast: sweep for shimmers (golden cookies, reindeer) and click them
        setInterval(grabShimmers, SHIMMER_INTERVAL_MS)

        // slow: measure -> decide -> buy
        setInterval(runStrategy, STRATEGY_INTERVAL_MS)

        achievementHunt()
    }, STARTUP_DELAY_MS)

    //! Shimmer grabbing
    function grabShimmers() {
        document.querySelectorAll('#shimmers .shimmer').forEach(sh => simulateClick(sh))
    }

    //! Strategy loop
    let strategyRunning = false

    async function runStrategy() {
        // snapshot() sweeps tooltips and can take longer than one interval; never
        // overlap two runs (that would fight over which tooltip is shown)
        if (strategyRunning) return
        strategyRunning = true
        try {
            const snap = await snapshot()
            // expose the latest measurement for inspection in the console
            window.__alakazam = snap

            const decision = decide(snap)
            if (decision.action === 'buyUpgrade' || decision.action === 'buyBuilding') {
                simulateClick(decision.target.element)
            }
            logSnapshot(snap, decision)
        } catch (err) {
            console.warn('Alakazam: strategy loop error', err)
        } finally {
            strategyRunning = false
        }
    }

    //* logSnapshot
    // one compact structured line per cycle so the measured data is inspectable
    function logSnapshot(snap, decision) {
        console.log('Alakazam', {
            cookies: snap.cookies,
            cps: snap.cps,
            buildings: snap.buildings.length,
            upgrades: snap.upgrades.length,
            shimmers: snap.shimmers.length,
            decision: `${decision.action}: ${decision.reason}`
        })
    }

    //! Achievement Hunt
    // one-off routines that unlock free achievements a human could also trigger by
    // poking the UI. all clicks route through simulateClick to honor fair-play.
    function achievementHunt() {
        console.log('Alakazam: achievement hunt started')
        tinyCookie()
        oldenDays()
        godComplex()
        setTimeout(hereYouGo, 500)
        tabloidAddiction()
    }

    //* typeInto
    // fill a text field the way a user would: set the value and fire input/change
    function typeInto(el, text) {
        if (!el) return
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
    }

    //* Tabloid addiction: click the news ticker repeatedly
    function tabloidAddiction() {
        const comments = document.getElementById('commentsText1')
        let clicks = 0
        const timer = setInterval(() => {
            if (clicks >= 75) {
                clearInterval(timer)
                return
            }
            simulateClick(comments)
            clicks++
        }, 100)
    }

    //* Olden days: open the info log and click the credits entry
    function oldenDays() {
        const logButton = document.querySelector('#logButton div')
        simulateClick(logButton)
        simulateClick(document.querySelector('#oldenDays .icon'))
        simulateClick(logButton)
    }

    //* God complex: rename the bakery to "Orteil", then back
    function godComplex() {
        const bakeryName = document.getElementById('bakeryName')
        simulateClick(bakeryName)
        typeInto(document.getElementById('bakeryNameInput'), 'Orteil')
        simulateClick(document.getElementById('promptOption0'))

        setTimeout(() => {
            simulateClick(document.getElementById('bakeryName'))
            typeInto(document.getElementById('bakeryNameInput'), 'Alakazam')
            simulateClick(document.getElementById('promptOption0'))
        }, 1000)
    }

    //* Here you go: open stats and click a specific achievement slot
    function hereYouGo() {
        const statsButton = document.querySelector('#statsButton div')
        simulateClick(statsButton)
        setTimeout(() => {
            simulateClick(document.querySelector('[data-id="204"]'))
            simulateClick(statsButton)
        }, 1000)
    }

    //* Tiny cookie: click the tiny cookie in the stats panel
    function tinyCookie() {
        const statsButton = document.querySelector('#statsButton div')
        simulateClick(statsButton)
        simulateClick(document.querySelector('#statsGeneral .listing .price .tinyCookie'))
        simulateClick(statsButton)
    }
})()
