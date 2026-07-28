// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Store Controls
    // The store's buy/sell mode and its 1/10/100/all amount are a single global
    // setting shared with the player. Clicking a product does whatever that
    // setting currently says, which makes it genuinely dangerous state: leave it
    // on Sell and the next click sells a building; leave it on 100 and the player's
    // own next click buys a hundred.
    //
    // So every change goes through withBulk(), which restores the previous mode in
    // a finally block. Nothing else in the extension may touch these elements.
    //
    // All of this degrades safely. If the bulk controls cannot be found the module
    // reports unavailable, callers fall back to buying one at a time, and no
    // feature breaks: buy-one is the game's default mode.

    const { simulateClick } = window.Alakazam.input
    const { parseGameNumber } = window.Alakazam.parse
    const { PRICE_GROWTH } = window.Alakazam.data.buildings

    const MODE_IDS = { buy: 'storeBulkBuy', sell: 'storeBulkSell' }
    const AMOUNT_IDS = { 1: 'storeBulk1', 10: 'storeBulk10', 100: 'storeBulk100', max: 'storeBulkMax' }

    // how long to let the game redraw the store after changing the bulk amount:
    // the price faces are rewritten on its draw loop, not synchronously
    const REDRAW_MS = 40

    let warned = false
    // what we last set, used when the game gives us no selected marker to read
    let assumedMode = 'buy'
    let assumedAmount = 1

    function el(id) {
        return document.getElementById(id)
    }

    //* available
    // whether the bulk controls exist. checked rather than assumed because these
    // ids are the one part of the store markup the extension cannot verify from
    // the game's published minigame sources.
    function available() {
        return !!(el(MODE_IDS.buy) && el(AMOUNT_IDS[1]) && el(AMOUNT_IDS[10]))
    }

    function warnOnce() {
        if (warned) return
        warned = true
        console.warn(
            'Alakazam: store bulk controls not found, falling back to buying one at a time. ' +
                'Expected #storeBulkBuy / #storeBulk1 / #storeBulk10 / #storeBulk100.'
        )
    }

    //* currentMode / currentAmount
    // the game marks the active buttons with a class. when that marker is missing
    // or renamed we fall back to whatever we last set ourselves.
    function isSelected(node) {
        return !!node && (node.classList.contains('selected') || node.classList.contains('on'))
    }

    function currentMode() {
        if (isSelected(el(MODE_IDS.sell))) return 'sell'
        if (isSelected(el(MODE_IDS.buy))) return 'buy'
        return assumedMode
    }

    function currentAmount() {
        for (const key of Object.keys(AMOUNT_IDS)) {
            if (isSelected(el(AMOUNT_IDS[key]))) return key === 'max' ? 'max' : Number(key)
        }
        return assumedAmount
    }

    function setMode(mode) {
        const node = el(MODE_IDS[mode])
        if (!node) return false
        simulateClick(node)
        assumedMode = mode
        return true
    }

    function setAmount(amount) {
        const node = el(AMOUNT_IDS[amount])
        if (!node) return false
        simulateClick(node)
        assumedAmount = amount
        return true
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    //! withBulk
    // Set the store to a mode and amount, run the body, put the store back exactly
    // as it was. The restore runs even when the body throws, which is the whole
    // reason this exists: a crash mid-purchase must never leave the store in Sell.
    //
    // Buying one at a time needs no mode change at all, so it skips the controls
    // entirely and keeps working even when they are missing.
    async function withBulk(mode, amount, body) {
        if (mode === 'buy' && amount === 1 && currentMode() === 'buy' && currentAmount() === 1) {
            return body()
        }
        if (!available()) {
            warnOnce()
            // only buy-one is safe without the controls; anything else is refused
            // rather than silently doing something different from what was asked
            if (mode === 'buy' && amount === 1) return body()
            return null
        }

        const prevMode = currentMode()
        const prevAmount = currentAmount()

        try {
            if (prevMode !== mode) setMode(mode)
            if (prevAmount !== amount) setAmount(amount)
            // let the game rewrite the price faces for the new amount
            if (prevAmount !== amount) await wait(REDRAW_MS)
            return await body()
        } finally {
            if (currentAmount() !== prevAmount) setAmount(prevAmount)
            if (currentMode() !== prevMode) setMode(prevMode)
        }
    }

    //! Prices

    //* sumPrice
    // what buying `count` of a building costs in total, given the price its next
    // single unit is showing.
    //
    // Every unit costs 15% more than the one before, and every discount in the
    // game (Season switch, Dotjeiess, Crafty Pixies, ...) is a flat multiplier
    // over that same curve. So the total is a plain geometric series and can be
    // derived from the one price already on screen, with no extra DOM work:
    //
    //   p + 1.15p + 1.15^2 p + ... = p * (1.15^n - 1) / 0.15
    //
    // The game rounds each unit up, so this can be under the true total by at most
    // one cookie per unit. Callers confirm against the rendered bulk price before
    // committing, and treat this as the number to score with.
    function sumPrice(nextUnitPrice, count) {
        if (!Number.isFinite(nextUnitPrice) || count <= 0) return Infinity
        if (count === 1) return nextUnitPrice
        const growth = PRICE_GROWTH
        return (nextUnitPrice * (Math.pow(growth, count) - 1)) / (growth - 1)
    }

    //* priceAfter
    // what the next unit will cost once `count` more have been bought. used to
    // check whether a building would still be the best buy after a bulk purchase.
    function priceAfter(nextUnitPrice, count) {
        return nextUnitPrice * Math.pow(PRICE_GROWTH, count)
    }

    //* readBulkPrice
    // the authoritative total for a bulk purchase: the game's own rendered price
    // for the currently selected amount. only worth reading right before
    // committing, since it costs a mode switch and a redraw wait.
    function readBulkPrice(product) {
        const priceEl = product.element ? product.element.querySelector('.price') : null
        if (!priceEl) return NaN
        return parseGameNumber(priceEl.innerText)
    }

    //! Buying and selling

    //* buy
    // Buy `count` of a product, spending no more than `maxSpend`.
    //
    // The estimate from sumPrice is what the decision was scored on; the price
    // face rendered once the bulk amount is selected is the game's own total for
    // exactly this purchase. Checking the second against the budget inside the
    // mode switch is what stops a bad estimate from emptying the bank, and it
    // costs nothing extra because the mode switch already happened.
    //
    // Returns { bought, cost } so the caller can keep its own running balance
    // without waiting for the game to redraw the cookie counter.
    async function buy(product, count, maxSpend) {
        const budget = Number.isFinite(maxSpend) ? maxSpend : Infinity
        let result = { bought: false, cost: 0 }

        await withBulk('buy', count, () => {
            const rendered = readBulkPrice(product)
            const cost = Number.isFinite(rendered) ? rendered : sumPrice(product.price, count)
            if (cost > budget) {
                result = { bought: false, cost: 0, reason: 'rendered price exceeded budget' }
                return
            }
            simulateClick(product.element)
            result = { bought: true, cost }
        })

        return result
    }

    //* sell
    // sell `count` of a product. selling is how Godzamok's click boost is earned
    // and how a couple of achievements are unlocked, and it is the reason the
    // restore in withBulk has to be airtight.
    async function sell(product, count) {
        let issued = false
        await withBulk('sell', count, () => {
            simulateClick(product.element)
            issued = true
        })
        return issued
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.act = window.Alakazam.act || {}
    window.Alakazam.act.store = {
        available,
        withBulk,
        buy,
        sell,
        sumPrice,
        priceAfter,
        readBulkPrice,
        currentMode,
        currentAmount
    }
})()
