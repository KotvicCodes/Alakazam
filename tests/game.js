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

    // #game carries the mode classes the real game keys its stylesheet off, which
    // is also how the extension tells the ascension screen from ordinary play
    const gameEl = new El('div', { id: 'game' })
    doc.body.append(gameEl)
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
    // the real store splits crates across four sections, and the element ids
    // restart at upgrade0 in every one of them
    const sections = {}
    for (const id of ['upgrades', 'techUpgrades', 'toggleUpgrades', 'vaultUpgrades']) {
        sections[id] = new El('div', { id, class: 'storeSection upgradeBox' })
        doc.body.append(sections[id])
    }
    const DEFAULT_CRATES = [
        { name: 'Reinforced index finger', price: 100, body: 'clicking gains +1% of your CpS' },
        { name: 'Forwards from grandma', price: 1000, body: 'grandmas are twice as efficient' },
        { name: 'Elder Pledge', price: 500, body: 'pledge to the elders, ends the grandmapocalypse' }
    ]
    const CRATES = opts.crates || DEFAULT_CRATES
    let nextUpgradeId = 0
    const perSection = {}

    CRATES.forEach(c => {
        const where = c.section || 'upgrades'
        const box = sections[where]
        perSection[where] = perSection[where] || 0
        const id = nextUpgradeId++
        const el = new El('div', {
            class: 'crate upgrade',
            // positional within the section, exactly as the game numbers them
            id: 'upgrade' + perSection[where]++,
            style: { backgroundPosition: `${-48 * id}px 0px` }
        })
        el.setAttribute('data-id', String(id))
        el.addEventListener('mouseover', () => setTooltip(c.name, fmt(c.price), c.body))
        el.addEventListener('click', () => {
            if (state.bank < c.price) return
            state.bank -= c.price
            state.log.push(`buy upgrade ${c.name}`)
            box.children = box.children.filter(x => x !== el)
            refresh()
        })
        box.append(el)
    })

    const buffsEl = new El('div', { id: 'buffs' })
    doc.body.append(new El('div', { id: 'shimmers' }), buffsEl, new El('div', { id: 'wrinklers' }))

    // ---- buffs ----
    // A real buff is an icon crate with a pie timer inside it and no text at all:
    // the name is only in the tooltip and the time left is only in the pie timer's
    // sprite offset. Both are modelled here, because both are the only way to read
    // one, and a fake that rendered a helpful label would test nothing.
    let nextBuffId = 0
    const buffsByName = new Map()

    //* gainBuff
    // `progress` is how much of the buff has elapsed, 0 to 1, matching the game's
    // own T = (1 - time/maxTime) encoding
    function gainBuff(name, progress = 0) {
        const id = 'buff' + nextBuffId++
        const el = new El('div', { id, class: 'crate enabled buff' })
        buffsByName.set(name, el)
        const step = Math.floor(Math.min(143, Math.max(0, progress * 144)))
        const timer = new El('div', {
            id: 'buffPieTimer' + id,
            class: 'pieTimer',
            style: {
                backgroundPosition: `${-(step % 18) * 48}px ${-Math.floor(step / 18) * 48}px`
            }
        })
        el.append(timer)
        el.addEventListener('mouseover', () => setTooltip(name, '', `${name} is running`))
        buffsEl.append(el)
        return { id, element: el, setProgress: p => setBuffProgress(el, p) }
    }

    function setBuffProgress(el, progress) {
        const timer = el.querySelector('.pieTimer')
        const step = Math.floor(Math.min(143, Math.max(0, progress * 144)))
        timer.style.backgroundPosition = `${-(step % 18) * 48}px ${-Math.floor(step / 18) * 48}px`
    }

    function loseBuff(name) {
        const el = buffsByName.get(name)
        if (!el) return
        buffsByName.delete(name)
        buffsEl.children = buffsEl.children.filter(x => x !== el)
    }

    //* progressBuff
    // move a named buff along its timer, which is how a test walks a loan window
    // down toward the moment the ascension has to happen
    function progressBuff(name, progress) {
        const el = buffsByName.get(name)
        if (el) setBuffProgress(el, progress)
    }

    // ---- bank loans ----
    // three slots, revealed by office level and switched off while already running
    const loanEls = {}
    state.loansTaken = []
    for (const id of [1, 2, 3]) {
        const needs = { 1: 2, 2: 4, 3: 5 }[id]
        const el = new El('div', { id: 'bankLoan' + id, class: 'bankButton bankButtonSell' })
        if ((opts.officeLevel || 0) < needs) el.style.display = 'none'
        el.addEventListener('click', () => {
            if (el.classList.contains('bankButtonOff')) return
            el.classList.add('bankButtonOff')
            state.loansTaken.push(id)
            state.log.push(`loan ${id}`)
            gainBuff('Loan ' + id, opts.loanProgress != null ? opts.loanProgress : 0)
        })
        loanEls[id] = el
        doc.body.append(el)
    }

    // ---- ascension ----
    // The real sequence is Legacy button -> a named prompt -> five seconds of
    // animation -> the heavenly tree -> Reincarnate -> another named prompt. Every
    // one of those steps is modelled, because the extension's safety rule is that
    // it only ever confirms a prompt it can name, and that rule is only worth
    // anything if a test can put the wrong prompt up.
    const HEAVENLY = opts.heavenly || []
    state.chips = opts.chips != null ? opts.chips : 0
    state.heavenlyBought = []
    state.permanent = null

    const legacy = new El('div', { id: 'legacyButton' })
    const promptAnchor = new El('div', { id: 'promptAnchor' })
    const promptContent = new El('div', { id: 'promptContent' })
    promptAnchor.append(promptContent)
    const ascendUpgrades = new El('div', { id: 'ascendUpgrades' })
    const ascendHCs = new El('div', { id: 'ascendHCs' })
    const ascendPrestige = new El('div', { id: 'ascendPrestige' })
    const ascendButton = new El('a', { id: 'ascendButton' })
    doc.body.append(legacy, promptAnchor, ascendUpgrades, ascendHCs, ascendPrestige, ascendButton)

    //* prompt
    // mirrors Game.Prompt: the content is wrapped in a div named after the prompt,
    // and the options become #promptOption0, #promptOption1 and so on
    function prompt(name, options, extra) {
        promptContent.children = []
        const inner = new El('div', { id: 'promptContent' + name })
        if (extra) extra(inner)
        promptContent.append(inner)
        options.forEach(([label, onClick], i) => {
            const opt = new El('a', { id: 'promptOption' + i, class: 'option', text: label })
            opt.addEventListener('click', () => {
                closePrompt()
                onClick && onClick()
            })
            promptContent.append(opt)
        })
        state.log.push(`prompt ${name}`)
    }
    function closePrompt() {
        promptContent.children = []
    }

    function setMode(cls) {
        gameEl.classes = new Set(cls ? [cls] : [])
    }

    function drawTree() {
        ascendHCs.children = []
        ascendHCs.append(new El('span', { class: 'price', text: fmt(state.chips) }))
        ascendPrestige.innerText = String(opts.prestige || 0)
        ascendUpgrades.children = []
        // the tree draws one decorative crate with no data-id behind the real ones
        ascendUpgrades.append(new El('div', { class: 'crate upgrade heavenly' }))
        HEAVENLY.forEach(u => {
            if (state.heavenlyBought.indexOf(u.name) !== -1) return
            const locked = u.needs && state.heavenlyBought.indexOf(u.needs) === -1
            const crate = new El('div', {
                id: 'heavenlyUpgrade' + u.id,
                class: locked ? 'crate upgrade heavenly ghosted' : 'crate upgrade heavenly'
            })
            crate.setAttribute('data-id', String(u.id))
            crate.addEventListener('mouseover', () => setTooltip(u.name, fmt(u.cost), u.name))
            if (!locked) {
                crate.addEventListener('click', () => {
                    if (u.slot) return openSlotPicker(u)
                    // the game checks affordability inside its own handler, so a
                    // crate can look buyable and quietly refuse
                    if (state.chips < u.cost) {
                        state.log.push(`REJECT heavenly ${u.name}`)
                        return
                    }
                    state.chips -= u.cost
                    state.heavenlyBought.push(u.name)
                    state.log.push(`heavenly ${u.name}`)
                    drawTree()
                })
            }
            ascendUpgrades.append(crate)
        })
    }

    function openSlotPicker(slot) {
        if (state.chips < slot.cost) return
        state.chips -= slot.cost
        state.heavenlyBought.push(slot.name)
        state.log.push(`heavenly ${slot.name}`)
        let chosen = null
        prompt(
            'PickPermaUpgrade',
            [
                [
                    'Confirm',
                    () => {
                        state.permanent = chosen
                        state.log.push(`permanent ${chosen}`)
                        drawTree()
                    }
                ],
                ['Cancel', () => drawTree()]
            ],
            inner => {
                ;(opts.permanentChoices || []).forEach(c => {
                    const crate = new El('div', {
                        id: 'upgradeForPermanent' + c.id,
                        class: 'crate upgrade'
                    })
                    crate.setAttribute('data-id', String(c.id))
                    crate.addEventListener('mouseover', () => setTooltip(c.name, '0', c.name))
                    crate.addEventListener('click', () => {
                        chosen = c.name
                    })
                    inner.append(crate)
                })
            }
        )
    }

    legacy.addEventListener('click', () => {
        prompt('Ascend', [
            [
                'Ascend',
                () => {
                    setMode('ascending')
                    drawTree()
                }
            ],
            ['Cancel']
        ])
    })

    ascendButton.addEventListener('click', () => {
        prompt('Reincarnate', [
            [
                'Yes',
                () => {
                    setMode('')
                    state.log.push('reincarnated')
                }
            ],
            ['No']
        ])
    })

    // ---- the options menu and gift codes ----
    // The Send and Redeem buttons only exist once the Wrapping paper heavenly
    // upgrade is owned, which is exactly why the extension looks for them rather
    // than trying to read an upgrade id out of the save.
    const prefsButton = new El('div', { id: 'prefsButton', class: 'panelButton' })
    const menu = new El('div', { id: 'menu' })
    doc.body.append(prefsButton, menu)

    function drawMenu() {
        menu.children = []
        if (!prefsButton.classList.contains('selected')) return
        if (!opts.wrappingPaper) return
        const box = new El('div', { id: 'giftStuff', class: 'optionBox' })
        const send = new El('a', { class: 'option', text: 'Send' })
        const redeem = new El('a', { class: 'option', text: 'Redeem' })
        send.addEventListener('click', () => {
            prompt('GiftSend', [
                [
                    'Wrap',
                    () => {
                        state.log.push('wrapped a gift')
                        gainBuff('Gifted out', 0)
                        prompt('GiftSendReady', [['Done']], inner => {
                            const input = new El('input', { id: 'giftCode' })
                            input.value = opts.giftCode || 'TUFJTHwxMjN8NTB8LXx8'
                            inner.append(input)
                        })
                    }
                ],
                ['Cancel']
            ])
        })
        box.append(send, redeem)
        menu.append(box)
    }

    prefsButton.addEventListener('click', () => {
        const open = prefsButton.classList.contains('selected')
        if (open) prefsButton.classList.remove('selected')
        else prefsButton.classList.add('selected')
        drawMenu()
    })

    // ---- the You building's clone customizer ----
    // Seven genes, each a wrapping list stepped with a pair of arrows. The arrows
    // print the current index plus one, and the achievement check lives inside the
    // step handler rather than with the genes, so importing a matching appearance
    // wins nothing. Both of those are modelled, because both are the point.
    const GENE_IDS = ['hair', 'hairCol', 'skinCol', 'head', 'face', 'acc1', 'acc2']
    const GENE_SIZES = [17, 18, 15, 5, 10, 36, 36]
    state.genes = (opts.genes || [0, 1, 0, 0, 0, 0, 0]).slice()
    state.likenessWon = false

    const youRow = new El('div', { class: 'row', id: 'row' + 19 })
    youRow.append(new El('a', { class: 'smallFancyButton framed onlyOnCanvas', text: 'Customize' }))
    doc.body.append(youRow)

    function checkLikeness() {
        const [hair, hairCol, , head, , acc1, acc2] = state.genes
        if (
            hair === 9 &&
            (hairCol === 1 || hairCol === 6) &&
            (head === 2 || head === 3) &&
            (acc1 === 2 || acc1 === 3 || acc2 === 2 || acc2 === 3) &&
            (acc1 === 0 || acc2 === 0)
        ) {
            if (!state.likenessWon) state.log.push('achievement In her likeness')
            state.likenessWon = true
        }
    }

    function offsetGene(index, off) {
        if (off === 0) return
        const size = GENE_SIZES[index]
        state.genes[index] = (((state.genes[index] + off) % size) + size) % size
        const readout = doc.getElementById('customizerSelect-N-' + GENE_IDS[index])
        if (readout) readout.innerText = String(state.genes[index] + 1)
        // the game only runs its check here, on a real step
        checkLikeness()
    }

    function openCustomizer() {
        prompt('CustomizeYou', [['Done']], inner => {
            GENE_IDS.forEach((id, i) => {
                const left = new El('a', { id: 'customizerSelect-L-' + id, text: '<' })
                const num = new El('div', {
                    id: 'customizerSelect-N-' + id,
                    text: String(state.genes[i] + 1)
                })
                const right = new El('a', { id: 'customizerSelect-R-' + id, text: '>' })
                left.addEventListener('click', () => offsetGene(i, -1))
                right.addEventListener('click', () => offsetGene(i, 1))
                inner.append(left, num, right)
            })
        })
    }
    youRow.children[0].addEventListener('click', openCustomizer)

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

    return {
        doc,
        state,
        refresh,
        tooltip,
        bulk,
        BUILDINGS,
        unitPrice,
        sumPrice,
        selectAmount,
        prompt,
        closePrompt,
        setMode,
        drawTree,
        gainBuff,
        loseBuff,
        progressBuff,
        setBuffProgress,
        loanEls,
        openCustomizer,
        GENE_IDS
    }
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
