//! Fake Cookie Clicker
// A small but real simulator: hovering repopulates #tooltip the way the game
// does, the store has working bulk controls, and clicking a product actually
// buys (or sells), deducts cookies, raises the price by 15% per unit and
// re-renders the price faces for the selected bulk amount.

const { El, makeDocument } = require('./dom')

const BUILDINGS = [
    ['Cursor', 0.1, 15],
    ['Grandma', 1, 100],
    ['Farm', 8, 1100],
    ['Mine', 47, 12000],
    ['Factory', 260, 130000],
    ['Bank', 1400, 1400000],
    ['Temple', 7800, 20000000],
    ['Wizard tower', 44000, 330000000]
]

const GROWTH = 1.15

function build(opts = {}) {
    const doc = makeDocument()
    const state = {
        bank: opts.bank != null ? opts.bank : 1e6,
        cps: opts.cps != null ? opts.cps : 25,
        owned: (opts.owned || BUILDINGS.map(() => 0)).slice(),
        mode: 'buy',
        amount: 1,
        log: []
    }

    doc.body.append(new El('div', { id: 'bigCookie' }))
    const cookies = new El('div', { id: 'cookies' })
    const cpsEl = new El('div', { id: 'cookiesPerSecond' })
    const tooltip = new El('div', { id: 'tooltip' })
    doc.body.append(cookies, cpsEl, tooltip)

    function unitPrice(i, extra = 0) {
        return Math.ceil(BUILDINGS[i][2] * Math.pow(GROWTH, state.owned[i] + extra))
    }
    function sumPrice(i, n) {
        let total = 0
        for (let k = 0; k < n; k++) total += unitPrice(i, k)
        return total
    }

    function setTooltip(name, priceText, body) {
        tooltip.children = []
        tooltip.text = ''
        tooltip.append(
            new El('div', { class: 'name', text: name }),
            new El('div', { class: 'price', text: String(priceText) }),
            new El('div', { text: body })
        )
    }

    // ---- bulk controls ----
    const store = new El('div', { id: 'store' })
    doc.body.append(store)
    const bulk = {}
    const mk = (id, cls) => {
        const e = new El('div', { id, class: cls })
        store.append(e)
        bulk[id] = e
        return e
    }
    mk('storeBulkBuy', 'storePreButton storeBulkMode selected')
    mk('storeBulkSell', 'storePreButton storeBulkMode')
    mk('storeBulk1', 'storePreButton storeBulkAmount selected')
    mk('storeBulk10', 'storePreButton storeBulkAmount')
    mk('storeBulk100', 'storePreButton storeBulkAmount')
    mk('storeBulkMax', 'storePreButton storeBulkAmount')

    function selectMode(mode) {
        state.mode = mode
        bulk.storeBulkBuy.classes.delete('selected')
        bulk.storeBulkSell.classes.delete('selected')
        bulk[mode === 'buy' ? 'storeBulkBuy' : 'storeBulkSell'].classes.add('selected')
        refresh()
    }
    function selectAmount(a) {
        state.amount = a
        for (const k of ['storeBulk1', 'storeBulk10', 'storeBulk100', 'storeBulkMax'])
            bulk[k].classes.delete('selected')
        bulk['storeBulk' + (a === 'max' ? 'Max' : a)].classes.add('selected')
        refresh()
    }
    bulk.storeBulkBuy.addEventListener('click', () => selectMode('buy'))
    bulk.storeBulkSell.addEventListener('click', () => selectMode('sell'))
    bulk.storeBulk1.addEventListener('click', () => selectAmount(1))
    bulk.storeBulk10.addEventListener('click', () => selectAmount(10))
    bulk.storeBulk100.addEventListener('click', () => selectAmount(100))
    bulk.storeBulkMax.addEventListener('click', () => selectAmount('max'))

    // ---- products ----
    const products = new El('div', { id: 'products' })
    doc.body.append(products)
    const priceEls = []
    const ownedEls = []

    BUILDINGS.forEach(([name, baseCps], i) => {
        const el = new El('div', { id: 'product' + i, class: 'product unlocked' })
        const priceEl = new El('div', { class: 'price', text: '' })
        const ownedEl = new El('div', { class: 'owned', text: '0' })
        priceEls.push(priceEl)
        ownedEls.push(ownedEl)
        el.append(new El('div', { class: 'productName title', text: name }), priceEl, ownedEl)

        el.addEventListener('mouseover', () => {
            const per = baseCps * (opts.cpsMultiplier || 1)
            setTooltip(
                name,
                fmt(unitPrice(i)),
                state.owned[i] > 0
                    ? `each ${name} produces ${per} cookies per second`
                    : 'a mysterious building you do not own yet'
            )
        })

        el.addEventListener('click', () => {
            const n = state.amount === 'max' ? maxAffordable(i) : state.amount
            if (state.mode === 'buy') {
                const cost = sumPrice(i, n)
                if (n <= 0 || cost > state.bank) {
                    state.log.push(`REJECT buy ${n} ${name} (cost ${cost} > bank ${state.bank})`)
                    return
                }
                state.bank -= cost
                state.owned[i] += n
                state.log.push(`buy ${n} ${name} for ${cost}`)
            } else {
                const n2 = Math.min(n, state.owned[i])
                if (n2 <= 0) return
                let refund = 0
                for (let k = 1; k <= n2; k++) refund += Math.floor(unitPrice(i, -k) * 0.25)
                state.owned[i] -= n2
                state.bank += refund
                state.log.push(`sell ${n2} ${name} for ${refund}`)
            }
            refresh()
        })
        products.append(el)
    })

    function maxAffordable(i) {
        let n = 0
        let total = 0
        while (total + unitPrice(i, n) <= state.bank && n < 1000) {
            total += unitPrice(i, n)
            n++
        }
        return n
    }

    // ---- upgrades ----
    const upgrades = new El('div', { id: 'upgrades' })
    doc.body.append(upgrades)
    const CRATES = opts.crates || [
        { name: 'Reinforced index finger', price: 100, body: 'clicking gains +1% of your CpS' },
        { name: 'Forwards from grandma', price: 1000, body: 'grandmas are twice as efficient' },
        { name: 'Elder Pledge', price: 500, body: 'pledge to the elders, ends the grandmapocalypse' }
    ]
    CRATES.forEach((c, i) => {
        const el = new El('div', {
            class: 'crate upgrade',
            id: 'upgrade' + i,
            style: { backgroundPosition: `${-48 * i}px 0px` }
        })
        el.addEventListener('mouseover', () => setTooltip(c.name, fmt(c.price), c.body))
        el.addEventListener('click', () => {
            if (state.bank < c.price) return
            state.bank -= c.price
            state.log.push(`buy upgrade ${c.name}`)
            upgrades.children = upgrades.children.filter(x => x !== el)
            refresh()
        })
        upgrades.append(el)
    })

    doc.body.append(
        new El('div', { id: 'shimmers' }),
        new El('div', { id: 'buffs' }),
        new El('div', { id: 'wrinklers' })
    )

    function refresh() {
        cookies.innerText = `${fmt(state.bank)}\ncookies\nper second : ${state.cps}`
        cpsEl.innerText = `per second: ${state.cps}`
        BUILDINGS.forEach((b, i) => {
            const n = state.amount === 'max' ? Math.max(1, maxAffordable(i)) : state.amount
            priceEls[i].innerText = fmt(sumPrice(i, n))
            ownedEls[i].innerText = String(state.owned[i])
        })
    }
    refresh()

    return { doc, state, refresh, tooltip, bulk, BUILDINGS, unitPrice, sumPrice, selectAmount }
}

function fmt(n) {
    n = Math.round(n)
    if (n < 1e6) return n.toLocaleString('en-US')
    const units = [
        [1e24, 'septillion'],
        [1e21, 'sextillion'],
        [1e18, 'quintillion'],
        [1e15, 'quadrillion'],
        [1e12, 'trillion'],
        [1e9, 'billion'],
        [1e6, 'million']
    ]
    for (const [v, name] of units) if (n >= v) return `${(n / v).toFixed(3)} ${name}`
    return String(n)
}

module.exports = { build, fmt, BUILDINGS, GROWTH }
