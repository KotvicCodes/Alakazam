//! DOM-Only Measurement Layer
// Everything here reads only what a human sees in the rendered page. Exact
// per-building production and upgrade prices come from the game's own hover
// tooltips (the same numbers a player reads when hovering), never from the
// Game object. snapshot() is async because reading a tooltip means moving the
// pointer onto an element and waiting a frame for the game to draw it.

const { parseGameNumber, firstNumberIn } = window.Alakazam.parse
const { hoverOn, hoverOff } = window.Alakazam.input

//* nextFrame
// waits one animation frame; the game redraws its tooltip on its own loop, so
// after hovering we yield a frame (or two) before reading #tooltip
function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()))
}

//* readTooltip
// hovers an element, lets the game populate #tooltip, returns the tooltip root
// element (or null). caller reads what it needs, then we hover back off.
async function readTooltip(el) {
    hoverOn(el)
    await nextFrame()
    await nextFrame()
    const tip = document.getElementById('tooltip')
    // clone-free read: return the live node only while it is shown for this el
    const text = tip ? tip.innerText : ''
    const priceEl = tip ? tip.querySelector('.price') : null
    const nameEl = tip ? tip.querySelector('.name') : null
    hoverOff(el)
    return {
        text,
        price: priceEl ? parseGameNumber(priceEl.innerText) : NaN,
        name: nameEl ? nameEl.innerText.trim() : ''
    }
}

//! Global Counters
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

//! Buildings
// per building: name, on-store price (shown on the product), and exact per-unit
// production pulled from the hover tooltip's "each X produces Y ... per second".
async function readBuildings(bank) {
    const buildings = []
    const products = document.querySelectorAll('.product.unlocked')

    for (const product of products) {
        const nameEl = product.querySelector('.name')
        const priceEl = product.querySelector('.price')
        if (!nameEl || !priceEl) continue

        const name = nameEl.innerText.trim()
        const price = parseGameNumber(priceEl.innerText)
        if (Number.isNaN(price)) continue

        // pull per-unit CpS from the tooltip's "each ... produces N cookies per second"
        const tip = await readTooltip(product)
        const perUnit = perUnitCpsFromTooltip(tip.text)

        buildings.push({
            name,
            price,
            perUnitCps: perUnit,       // NaN if the line was not found
            affordable: bank >= price,
            element: product
        })
    }
    return buildings
}

//* perUnitCpsFromTooltip
// the first "produces ... cookies per second" sentence in a building tooltip is
// the per-single-unit figure ("each cursor produces 0.1 cookies per second")
function perUnitCpsFromTooltip(text) {
    if (!text) return NaN
    // grab whatever sits between "produces" and "cookies per second" (a number
    // in any display form: "0.1", "134B", "1.234 million", "1.2e9") and let
    // parseGameNumber decode it, rather than hard-coding number shapes here
    const match = text.match(/produces\s+(.+?)\s+cookies?\s+per\s+second/i)
    return match ? parseGameNumber(match[1]) : NaN
}

//! Upgrades In Store
// upgrade crates show no price on their face; price and effect only appear in
// the tooltip, so every store crate is hovered. each is classified so the
// strategy engine can skip toggles and one-off switches.
async function readUpgrades(bank) {
    const upgrades = []
    const crates = document.querySelectorAll('#upgrades .crate.upgrade')

    for (const crate of crates) {
        const tip = await readTooltip(crate)
        const price = !Number.isNaN(tip.price) ? tip.price : firstNumberIn(tip.text)
        if (Number.isNaN(price)) continue

        upgrades.push({
            name: tip.name || firstLine(tip.text),
            price,
            description: tip.text,
            kind: classifyUpgrade(tip.text),
            affordable: bank >= price,
            element: crate
        })
    }
    return upgrades
}

function firstLine(text) {
    return (text || '').split('\n')[0].trim()
}

//* classifyUpgrade
// 'skip'  -> toggles, pledges, season switchers: never auto-buy
// 'buy'   -> ordinary production/click upgrades: safe to auto-buy
// tuning this list is where most upgrade-strategy work will happen later
function classifyUpgrade(text) {
    const t = (text || '').toLowerCase()
    if (/switch|toggle|pledge|covenant|\bpact\b|turn all|vault|elder/.test(t)) return 'skip'
    return 'buy'
}

//! Shimmers (golden cookies, reindeer, wrath)
function readShimmers() {
    const shimmers = []
    document.querySelectorAll('#shimmers .shimmer').forEach(sh => {
        // the shimmer type is in its class list (golden, wrath, reindeer)
        const type = Array.from(sh.classList).find(c => c !== 'shimmer') || 'unknown'
        shimmers.push({ type, element: sh })
    })
    return shimmers
}

//! Buffs (frenzy, click frenzy, ...)
function readBuffs() {
    const buffs = []
    document.querySelectorAll('#buffs .buff').forEach(b => {
        // buffs render a countdown; capture whatever number is shown
        const timeText = b.querySelector('.icon + div, .buffName ~ div')
        buffs.push({
            timeLeft: timeText ? firstNumberIn(timeText.innerText) : NaN,
            element: b
        })
    })
    return buffs
}

//! Sugar lumps and wrinklers (lightweight presence for now)
function readMisc() {
    const lumpsEl = document.getElementById('lumps')
    const lumps = {
        present: !!lumpsEl,
        // best-effort ripe hint; verify the exact class against a live game
        ripe: !!(lumpsEl && /ripe/i.test(lumpsEl.className))
    }
    const wrinklers = document.querySelectorAll('.wrinkler').length
    return { lumps, wrinklers }
}

//! snapshot
// assembles the full picture. tooltip sweeps (buildings + upgrades) make this
// take a beat, so callers run it on the slow loop, not every frame.
async function snapshot() {
    const globals = readGlobals()
    // sweeps are sequential: only one tooltip can be shown at a time
    const buildings = await readBuildings(globals.cookies)
    const upgrades = await readUpgrades(globals.cookies)

    return {
        timestamp: Date.now(),
        ...globals,
        buildings,
        upgrades,
        shimmers: readShimmers(),
        buffs: readBuffs(),
        ...readMisc()
    }
}

window.Alakazam = window.Alakazam || {}
window.Alakazam.measure = { snapshot, readGlobals, readShimmers }
