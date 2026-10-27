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
    // price reads wait for a changed store face after either kind of switch.
    // quantities are scored only in Buy/1 and execution must change ownership.

    let activeContext = null
    const simulateClick = node =>
        (activeContext || window.Alakazam.safety.scope('purchase')).input('simulateClick', node)
    const { parseGameNumber } = window.Alakazam.parse
    const { PRICE_GROWTH } = window.Alakazam.data.buildings

    const MODE_IDS = { buy: 'storeBulkBuy', sell: 'storeBulkSell' }
    const AMOUNT_IDS = { 1: 'storeBulk1', 10: 'storeBulk10', 100: 'storeBulk100', max: 'storeBulkMax' }

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

    //! Store Transactions

    let redraw = null

    function prices() {
        return Array.from(document.querySelectorAll('.product.unlocked .price'))
            .map(node => node.innerText)
            .join('|')
    }

    function clearRedraw() {
        redraw?.observer?.disconnect()
        redraw = null
    }

    function observeRedraw(mode, amount) {
        clearRedraw()
        const pending = { before: prices(), mode, amount, drawn: false }
        redraw = pending
        // text assignments may redraw the same price (for example when a
        // cancelled switch is restored before the next frame)
        if (window.MutationObserver) {
            pending.observer = new MutationObserver(records => {
                pending.drawn ||= records.some(record => {
                    const node =
                        record.target.nodeType === 3 ? record.target.parentElement : record.target
                    return node?.classList?.contains('price')
                })
            })
            const products = el('products')
            if (products)
                pending.observer.observe(products, {
                    childList: true,
                    characterData: true,
                    subtree: true
                })
        }
    }

    function change(mode, amount, refresh = false) {
        if (refresh || currentMode() !== mode || currentAmount() !== amount) {
            observeRedraw(mode, amount)
        }
        // mode first: the game converts Sell/all to Buy/100 automatically
        if (currentMode() !== mode) setMode(mode)
        if (refresh || currentAmount() !== amount) setAmount(amount)
    }

    async function ready(lease) {
        if (!lease.valid()) return false
        if (!redraw) return true
        if (redraw.refresh || currentMode() !== redraw.mode || currentAmount() !== redraw.amount) {
            // an unobserved purchase may not draw, or the player may have changed
            // controls since release. Reapply their current quantity to request
            // a fresh draw, even if it writes identical prices.
            change(currentMode(), currentAmount(), true)
        }
        const pending = redraw
        const drawn = await window.Alakazam.transactions.until(lease, () => {
            if (currentMode() !== pending.mode || currentAmount() !== pending.amount) return false
            return pending.drawn || prices() !== pending.before
        })
        if (!drawn || !lease.valid()) return false
        // a changed face proves a redraw took place; a fixed sleep alone does not
        if (redraw === pending) clearRedraw()
        return true
    }

    function unitProducts() {
        if (redraw || currentMode() !== 'buy' || currentAmount() !== 1) return []
        return window.Alakazam.live.readProducts()
    }

    async function withBulk(mode, amount, body, lease) {
        const context = lease && typeof lease.check === 'function' ? lease : null
        if (context) lease = null
        const own = !lease
        lease = lease || window.Alakazam.transactions.acquire(context?.owner || 'purchase', context)
        if (!lease || !lease.valid()) return null
        const previousContext = activeContext
        activeContext = lease.ctx
        const prevMode = currentMode()
        const prevAmount = currentAmount()
        try {
            if (!available()) {
                warnOnce()
                if (mode !== 'buy' || amount !== 1 || prevMode !== 'buy' || prevAmount !== 1) return null
            } else {
                // finish any restoration redraw before interpreting another price
                if (!(await ready(lease))) return null
                change(mode, amount)
                if (!(await ready(lease))) return null
            }
            if (!lease.valid() || currentMode() !== mode || currentAmount() !== amount) return null
            lease.ctx.check()
            return await body(lease)
        } finally {
            // preserve controls the player chose while this transaction was waiting
            try {
                if (!lease.userControls && currentMode() === mode && currentAmount() === amount) {
                    lease.ctx.cleanup(() => change(prevMode, prevAmount))
                } else {
                    clearRedraw()
                }
            } finally {
                activeContext = previousContext
                if (own) lease.release()
            }
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

    const refusals = new Map()

    function purchaseState(product, count, budget, cookies) {
        const { safety, identity, save } = window.Alakazam
        return {
            element: product.element,
            priceElement: product.priceElement,
            price: product.priceElement.innerText,
            classes: product.element.className,
            owned: product.owned,
            count,
            budget,
            cookies,
            controls: safety.revision('store'),
            run: identity.fromSave(save.get()).runId
        }
    }

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
    async function buy(product, count, maxSpend, lease) {
        let result = { bought: false, cost: 0, amount: 0, reason: 'store unavailable or cancelled' }
        await withBulk(
            'buy',
            count,
            async token => {
                const live = window.Alakazam.live
                const current = live.readProducts().find(p => p.index === product.index)
                if (!current || !Number.isInteger(current.owned) || current.owned < 0) return
                const cost = readBulkPrice(current)
                const cookies = live.readGlobals().cookies
                const budget = Math.min(maxSpend ?? Infinity, cookies)
                if (!Number.isFinite(cost) || cost <= 0 || cost > budget) {
                    result.reason = 'verified price exceeded budget or unavailable'
                    return
                }
                if (!token.valid()) return
                const state = purchaseState(current, count, budget, cookies)
                const refused = refusals.get(current.index)
                if (refused && Object.keys(state).every(key => Object.is(state[key], refused[key]))) {
                    result.reason = 'unchanged refused purchase'
                    return
                }
                refusals.delete(current.index)
                // observe before clicking: a real redraw may retain the same price
                observeRedraw('buy', count)
                simulateClick(current.element)
                const after = await window.Alakazam.transactions.until(token, () => {
                    const p = live.readProducts().find(p => p.index === current.index)
                    return p && p.owned > current.owned ? p : null
                })
                if (!after) {
                    // a refused click may never draw; request a fresh quantity
                    // draw under the next valid lease before allowing another buy
                    if (redraw) redraw.refresh = true
                    // identical redraws do not prove affordability: rounded prices
                    // can keep looking affordable across ordinary scheduler ticks.
                    // cancelled observation is inconclusive, so only remember a
                    // refusal while we still own the transaction.
                    if (token.valid()) refusals.set(current.index, state)
                    result.reason = 'purchase not observed'
                    return
                }
                const amount = after.owned - current.owned
                result = { bought: true, cost, amount }
                // do not score another purchase against a price face from before this one
                if (readBulkPrice(after) === cost) {
                    await ready(token)
                } else {
                    clearRedraw()
                }
            },
            lease
        )
        return result
    }

    async function sell(product, count, lease) {
        let sold = false
        await withBulk(
            'sell',
            count,
            async token => {
                const live = window.Alakazam.live
                const before = live.readProducts().find(p => p.index === product.index)
                if (!before || !(before.owned > 0) || !token.valid()) return
                simulateClick(before.element)
                sold = !!(await window.Alakazam.transactions.until(token, () => {
                    const after = live.readProducts().find(p => p.index === product.index)
                    return after && after.owned < before.owned
                }))
            },
            lease
        )
        return sold
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.act = window.Alakazam.act || {}
    window.Alakazam.act.store = {
        available,
        ready,
        unitProducts,
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
