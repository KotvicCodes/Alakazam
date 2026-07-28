// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Live Measurement
    // The hot path. Everything here is a plain DOM read of text that is already
    // on screen, so a full pass costs well under a millisecond and can run many
    // times a second.
    //
    // Critically it hovers nothing. The old measurement pass moved the pointer
    // onto every building and every upgrade with a 90ms wait each, which is why a
    // single cycle took seconds and why prices were stale by the time they were
    // used. Tooltip-derived data now lives in measure/catalog.js, on its own
    // slower schedule, and is never in the way of a purchase decision.

    const { parseGameNumber, firstNumberIn } = window.Alakazam.parse

    //! Global counters

    function readGlobals() {
        const cookiesEl = document.getElementById('cookies')
        const cpsEl = document.getElementById('cookiesPerSecond')

        // #cookies text is like "1,234\ncookies\nper second : 5"; the first number
        // is the bank. firstNumberIn stops at that first number.
        const cookies = cookiesEl ? firstNumberIn(cookiesEl.innerText) : NaN

        // #cookiesPerSecond text is like "per second: 5" -> take the number
        const cps = cpsEl ? firstNumberIn(cpsEl.innerText.replace(/per second/i, '')) : NaN

        return {
            cookies: Number.isNaN(cookies) ? 0 : cookies,
            cps: Number.isNaN(cps) ? 0 : cps
        }
    }

    //! Store products
    // the price on a product's face is the authoritative next-unit price, already
    // including every discount in play. it is also re-rendered by the game to show
    // the summed price whenever a bulk amount is selected, which is what makes
    // bulk buying measurable rather than guessed.

    function readProducts() {
        const products = []
        for (const el of document.querySelectorAll('.product.unlocked')) {
            const priceEl = el.querySelector('.price')
            if (!priceEl) continue

            const price = parseGameNumber(priceEl.innerText)
            if (Number.isNaN(price)) continue

            // the name is used for the base-production lookup and for logging, so
            // a miss must not skip the building the way requiring it once did
            const nameEl = el.querySelector('.productName') || el.querySelector('.title')

            products.push({
                index: indexOf(el, products.length),
                name: nameEl ? nameEl.innerText.trim() : '',
                price,
                owned: ownedFrom(el),
                element: el,
                priceElement: priceEl
            })
        }
        return products
    }

    //* indexOf
    // products render as #product0 .. #product19 in the game's own building order,
    // which is the same order the save file uses. that shared index is how live
    // DOM readings get matched up with save records.
    function indexOf(el, fallback) {
        const match = /(\d+)$/.exec(el.id || '')
        return match ? parseInt(match[1], 10) : fallback
    }

    //* ownedFrom
    // the count rendered on the product. the save carries this exactly, so this is
    // only a fallback for when the save cannot be trusted; NaN means "ask the save"
    function ownedFrom(el) {
        const ownedEl = el.querySelector('.owned')
        if (!ownedEl) return NaN
        const n = firstNumberIn(ownedEl.innerText)
        return Number.isNaN(n) ? NaN : n
    }

    //! Upgrades in the store
    // crates carry no price or name on their face, so all that comes from the
    // catalog. what is readable live is which crates exist and what they look
    // like, and the icon position is a stable per-upgrade identity.

    function readUpgradeCrates() {
        const crates = []
        for (const el of document.querySelectorAll('#upgrades .crate.upgrade')) {
            crates.push({ key: crateKey(el), element: el })
        }
        return crates
    }

    //* crateKey
    // the sprite offset the game gives an upgrade's icon is unique to that upgrade
    // and stable across redraws, unlike the crate's positional element id
    function crateKey(el) {
        const pos = el.style && el.style.backgroundPosition ? el.style.backgroundPosition : ''
        return pos || el.id || ''
    }

    //! Shimmers, buffs, wrinklers

    //* readShimmers
    // The class the game actually uses is .goldenCookie, not .golden, so the type
    // is read from the class list as-is rather than guessed at.
    //
    // Wrath cookies share the .goldenCookie class and are told apart only by the
    // sprite the game sets on them, so that is what gets checked. When the sprite
    // cannot be read the shimmer is treated as an ordinary golden cookie, which
    // keeps the safe behaviour of clicking it.
    function readShimmers() {
        const shimmers = []
        document.querySelectorAll('#shimmers .shimmer').forEach(sh => {
            const type = Array.from(sh.classList).find(c => c !== 'shimmer') || 'unknown'
            const image = (sh.style && sh.style.backgroundImage) || ''
            shimmers.push({
                type,
                wrath: /wrath|wrinkler/i.test(image) || sh.classList.contains('wrath'),
                element: sh
            })
        })
        return shimmers
    }

    //* readBuffs
    // buffs render a name and a countdown. the name matters: spending magic on a
    // golden cookie is only worth it under a production buff, and a click buff
    // wants entirely different handling from a production one.
    function readBuffs() {
        const buffs = []
        document.querySelectorAll('#buffs .buff').forEach(b => {
            const text = b.innerText || ''
            const timeText = b.querySelector('.icon + div, .buffName ~ div')
            buffs.push({
                name: text.split('\n')[0].trim(),
                text,
                timeLeft: timeText ? firstNumberIn(timeText.innerText) : firstNumberIn(text),
                element: b
            })
        })
        return buffs
    }

    //* productionBuffs
    // the buffs that multiply cookies per second, which are the ones worth timing
    // a Force the Hand of Fate cast against
    const PRODUCTION_BUFFS =
        /frenzy|dragon harvest|building special|high-five|congregation|luxuriant harvest|ore vein|oiled-up|juicy profits|fervent adoration|manabloom|delicious lifeforms|breakthrough|righteous cataclysm|golden ages|extra cycles|solar flare|winning streak|macrocosm|refactoring|cosmic nursery|brainstorm|deliciousness/i

    function hasProductionBuff() {
        return readBuffs().some(b => PRODUCTION_BUFFS.test(b.name))
    }

    //* readWrinklers
    // Wrinklers are drawn onto #backgroundLeftCanvas, not built as elements: the
    // game's stylesheet has no .wrinkler rule at all. So there is nothing here to
    // find or click, and the old selector this replaced always matched zero.
    //
    // Their count and hoard are in the save instead, which is what the wrinklers
    // module reports from. Popping them would need hit-testing against the canvas;
    // see docs/ROADMAP.md.
    function readWrinklers() {
        return { canvas: document.getElementById('backgroundLeftCanvas'), elements: [] }
    }

    //! snapshot
    // one cheap pass over everything live. safe to call as often as you like.
    function snapshot() {
        const globals = readGlobals()
        return {
            timestamp: Date.now(),
            ...globals,
            products: readProducts(),
            crates: readUpgradeCrates(),
            shimmers: readShimmers(),
            buffs: readBuffs(),
            wrinklers: readWrinklers()
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.live = {
        snapshot,
        readGlobals,
        readProducts,
        readUpgradeCrates,
        readShimmers,
        readBuffs,
        hasProductionBuff,
        readWrinklers,
        crateKey
    }
})()
