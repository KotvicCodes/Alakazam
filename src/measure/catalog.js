// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Tooltip Catalog
    // The cold path. Some numbers exist only in the game's hover tooltips: exact
    // per-unit building production, and every upgrade's name, price and effect.
    // Reading one means physically moving the pointer onto an element and waiting
    // for the game to draw, so it is expensive and it is visible to the player.
    //
    // Three rules make that affordable:
    //
    //   1. One at a time. Only one tooltip can be shown, so a mutex guards the
    //      hover. Nothing else in the extension may hover.
    //   2. A little at a time. Each tick refreshes one building and a couple of
    //      unseen upgrades, round robin, instead of sweeping everything. The whole
    //      store still comes round in a few seconds, and no single pass is long.
    //   3. Never over the player. If a real mouse moved recently we skip the tick
    //      entirely, so Alakazam does not yank the tooltip out from under someone
    //      reading it. Real events carry isTrusted; ours never do.
    //
    // Purchases do not wait on any of this. Prices come from the product faces in
    // measure/live.js, so a stale catalog only makes scoring slightly out of date,
    // never a purchase wrong.

    const { hoverOn, hoverOff } = window.Alakazam.input
    const { parseGameNumber, firstNumberIn } = window.Alakazam.parse
    const { live, registry } = window.Alakazam

    const SETTLE_MS = 90 // the game draws its tooltip on its own loop, not on hover
    const TICK_MS = 400
    const USER_GRACE_MS = 1500 // how long to stay off the tooltip after a real move
    const CRATES_PER_TICK = 2
    const UPGRADE_TTL_MS = 5 * 60 * 1000

    const buildingCache = new Map() // product index -> { cps, at }
    const upgradeCache = new Map() // crate key   -> { name, price, description, kind, at }

    let lastUserMoveAt = 0
    let hovering = false
    let nextBuilding = 0
    let hovers = 0

    //! Staying out of the player's way

    // capture phase so we see the move before the game does. our own dispatched
    // events report isTrusted false, which is exactly the discriminator we need.
    document.addEventListener(
        'mousemove',
        event => {
            if (event.isTrusted) lastUserMoveAt = Date.now()
        },
        true
    )

    function userIsBusy() {
        return Date.now() - lastUserMoveAt < USER_GRACE_MS
    }

    //! The hover mutex

    function settle() {
        return new Promise(resolve => setTimeout(resolve, SETTLE_MS))
    }

    //* readTooltip
    // hovers an element, lets the game populate #tooltip, reads it, hovers off.
    // returns null rather than throwing when the lock is already held.
    async function readTooltip(el) {
        if (!el || hovering) return null
        hovering = true
        try {
            hoverOn(el)
            await settle()
            const tip = document.getElementById('tooltip')
            const priceEl = tip ? tip.querySelector('.price') : null
            const nameEl = tip ? tip.querySelector('.name') : null
            const out = {
                text: tip ? tip.innerText : '',
                price: priceEl ? parseGameNumber(priceEl.innerText) : NaN,
                name: nameEl ? nameEl.innerText.trim() : ''
            }
            hoverOff(el)
            hovers++
            return out
        } finally {
            hovering = false
        }
    }

    //! Buildings

    //* perUnitCpsFromTooltip
    // the first "produces ... cookies per second" sentence in a building tooltip
    // is the per-single-unit figure ("each cursor produces 0.1 cookies per second")
    function perUnitCpsFromTooltip(text) {
        if (!text) return NaN
        // grab whatever sits between "produces" and "cookies per second" (a number
        // in any display form: "0.1", "134B", "1.234 million", "1.2e9") and let
        // parseGameNumber decode it, rather than hard-coding number shapes here
        const match = text.match(/produces\s+(.+?)\s+cookies?\s+per\s+second/i)
        return match ? parseGameNumber(match[1]) : NaN
    }

    async function refreshBuilding(product) {
        const tip = await readTooltip(product.element)
        if (!tip) return
        const cps = perUnitCpsFromTooltip(tip.text)
        // before you own one, the tooltip is flavour text with no production line.
        // keep whatever we had rather than overwriting it with NaN.
        if (Number.isFinite(cps) && cps > 0) {
            buildingCache.set(product.index, { cps, at: Date.now() })
        }
    }

    //* buildingCps
    // the last measured per-unit production for a building, or NaN if we have not
    // managed to read it yet. callers fall back to published base production.
    function buildingCps(index) {
        const hit = buildingCache.get(index)
        return hit ? hit.cps : NaN
    }

    //! Upgrades

    //* classifyUpgrade
    // 'skip'  -> toggles, pledges, season switchers: never auto-buy
    // 'buy'   -> ordinary production/click upgrades: safe to auto-buy
    function classifyUpgrade(text) {
        const t = (text || '').toLowerCase()
        if (/switch|toggle|pledge|covenant|\bpact\b|turn all|vault|elder/.test(t)) return 'skip'
        return 'buy'
    }

    async function refreshCrate(crate) {
        const tip = await readTooltip(crate.element)
        if (!tip) return
        const price = !Number.isNaN(tip.price) ? tip.price : firstNumberIn(tip.text)
        if (Number.isNaN(price)) return
        upgradeCache.set(crate.key, {
            name: tip.name || (tip.text || '').split('\n')[0].trim(),
            price,
            description: tip.text,
            kind: classifyUpgrade(tip.text),
            at: Date.now()
        })
    }

    //* upgradeFor
    // what we know about the upgrade behind a crate, or null if it has not come
    // round in the rotation yet. an unknown crate is simply not bought this tick.
    function upgradeFor(key) {
        return upgradeCache.get(key) || null
    }

    function isStale(entry) {
        return !entry || Date.now() - entry.at > UPGRADE_TTL_MS
    }

    //! The tick

    async function tick() {
        if (userIsBusy() || hovering) return

        const products = live.readProducts()
        if (products.length > 0) {
            // one building per tick, round robin: the whole store comes round in a
            // few seconds and no single pass ever blocks anything
            nextBuilding = nextBuilding % products.length
            await refreshBuilding(products[nextBuilding])
            nextBuilding++
        }

        // unseen crates first, then whichever known ones have gone stale
        const crates = live.readUpgradeCrates()
        const unseen = crates.filter(c => !upgradeCache.has(c.key))
        const stale = crates.filter(c => upgradeCache.has(c.key) && isStale(upgradeCache.get(c.key)))
        const queue = unseen.concat(stale).slice(0, CRATES_PER_TICK)

        for (const crate of queue) {
            if (userIsBusy()) return
            await refreshCrate(crate)
        }
    }

    function stats() {
        return {
            buildings: buildingCache.size,
            upgrades: upgradeCache.size,
            hovers,
            waitingOnUser: userIsBusy()
        }
    }

    // gated on the purchase flag: scoring what to buy is the only thing that
    // needs tooltip data, so there is no reason to hover when buying is off
    registry.register({ name: 'catalog', interval: TICK_MS, setting: 'purchase', tick })

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.catalog = {
        buildingCps,
        upgradeFor,
        classifyUpgrade,
        perUnitCpsFromTooltip,
        readTooltip,
        stats
    }
})()
