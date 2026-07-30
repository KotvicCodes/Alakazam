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

    // ---- buy all ----
    // Only present once "Inspired checklist" is owned. Game.storeBuyAll walks the
    // store cheapest first and buys anything that is not vaulted and not in the
    // toggle or tech pools, which is why the research that starts the
    // grandmapocalypse is out of its reach.
    const buyAllTargets = []
    if (opts.buyAll) {
        const wrap = new El('div', { id: 'storeBuyAll', class: 'storePre' })
        const button = new El('div', { id: 'storeBuyAllButton', class: 'storePreButton' })
        button.addEventListener('click', () => {
            state.log.push('buy all')
            buyAllTargets
                .slice()
                .sort((a, b) => a.price - b.price)
                .forEach(c => {
                    if (state.bank < c.price) return
                    state.bank -= c.price
                    state.log.push(`buy upgrade ${c.name}`)
                })
        })
        wrap.append(button)
        store.append(wrap)
    }

    CRATES.forEach(c => {
        const where = c.section || 'upgrades'
        // the vault and the two excluded pools are exactly what Buy all skips
        if (where === 'upgrades' || where === 'techUpgrades') {
            if (where === 'upgrades') buyAllTargets.push(c)
        }
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
    const shimmersEl = new El('div', { id: 'shimmers' })
    doc.body.append(shimmersEl, buffsEl, new El('div', { id: 'wrinklers' }))

    //* addShimmer
    // a golden cookie on the screen. The extension reads the type off the second
    // class, the way the game writes it.
    function addShimmer(type = 'golden') {
        const sh = new El('div', {
            id: 'shimmer' + shimmersEl.children.length,
            class: `shimmer ${type}`
        })
        shimmersEl.append(sh)
        return sh
    }
    function clearShimmers() {
        shimmersEl.children = []
    }

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
    const darken = new El('div', { id: 'darken' })
    const promptContent = new El('div', { id: 'promptContent' })
    promptAnchor.append(promptContent)
    const ascendUpgrades = new El('div', { id: 'ascendUpgrades' })
    const ascendHCs = new El('div', { id: 'ascendHCs' })
    const ascendPrestige = new El('div', { id: 'ascendPrestige' })
    const ascendButton = new El('a', { id: 'ascendButton' })
    doc.body.append(
        legacy,
        promptAnchor,
        darken,
        ascendUpgrades,
        ascendHCs,
        ascendPrestige,
        ascendButton
    )
    darken.addEventListener('click', () => closePrompt())

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
        // A bought upgrade stays on the tree, carrying `enabled`. That matters:
        // Game.Upgrade.buy runs the upgrade's activateFunction whenever it is
        // clicked and already owned, outside the branch that checks whether
        // anything was actually purchased, so clicking an owned permanent slot
        // reopens its picker for free, forever.
        HEAVENLY.forEach(u => {
            const owned = state.heavenlyBought.indexOf(u.name) !== -1
            const locked = !owned && u.needs && state.heavenlyBought.indexOf(u.needs) === -1
            const crate = new El('div', {
                id: 'heavenlyUpgrade' + u.id,
                class: locked
                    ? 'crate upgrade heavenly ghosted'
                    : owned
                      ? 'crate upgrade heavenly enabled'
                      : 'crate upgrade heavenly'
            })
            crate.setAttribute('data-id', String(u.id))
            crate.addEventListener('mouseover', () => setTooltip(u.name, fmt(u.cost), u.name))
            if (!locked) {
                crate.addEventListener('click', () => {
                    if (owned) {
                        // no chips move, but the slot's activateFunction still runs
                        state.log.push(`RECLICK ${u.name}`)
                        if (u.slot) openSlotPicker(u, false)
                        return
                    }
                    // the game checks affordability inside its own handler, so a
                    // crate can look buyable and quietly refuse
                    if (state.chips < u.cost) {
                        state.log.push(`REJECT heavenly ${u.name}`)
                        return
                    }
                    state.chips -= u.cost
                    state.heavenlyBought.push(u.name)
                    state.log.push(`heavenly ${u.name}`)
                    // buying a slot opens its picker straight away, same function
                    if (u.slot) openSlotPicker(u, true)
                    else drawTree()
                })
            }
            ascendUpgrades.append(crate)
        })
    }

    function openSlotPicker(slot, justBought) {
        state.log.push(`picker ${slot.name}`)
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
                    crate.addEventListener('mouseover', () =>
                        setTooltip(c.name, fmt(c.price || 0), c.name)
                    )
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
        // The redeem prompt is the one place the game writes two elements with the
        // same id: its own Redeem button inside the content, and the Cancel option
        // that Game.Prompt appends. Reproduced here, duplicate and all, because that
        // is what the extension has to pick its way through.
        redeem.addEventListener('click', () => {
            let button = null
            prompt('GiftRedeem', [['Cancel']], inner => {
                const input = new El('input', { id: 'giftCode' })
                button = new El('a', {
                    id: 'promptOption0',
                    class: 'option smallFancyButton disabled',
                    text: 'Redeem'
                })
                const check = () => {
                    const good =
                        opts.validCode === undefined
                            ? String(input.value).length > 5
                            : input.value === opts.validCode
                    if (good) button.classList.remove('disabled')
                    else button.classList.add('disabled')
                }
                input.addEventListener('input', check)
                input.addEventListener('change', check)
                button.addEventListener('click', () => {
                    if (button.classList.contains('disabled')) return
                    state.log.push('redeemed a gift')
                    gainBuff('Gifted out', 0)
                    closePrompt()
                })
                inner.append(input, button)
            })
        })
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

    // ---- Krumblor ----
    // The dragon's tab is painted onto the left background canvas and hit-tested
    // against the mouse position, so what is modelled here is the canvas and the hit
    // box rather than an element the tab does not have. opts.dragon absent means the
    // crumbly egg is not bought and there is no tab at all.
    const dragon = {
        level: (opts.dragon && opts.dragon.level) || 0,
        aura: (opts.dragon && opts.dragon.aura) || 0,
        aura2: (opts.dragon && opts.dragon.aura2) || 0,
        pets: 0,
        drops: [],
        selecting: -1
    }
    state.dragon = dragon

    const leftCanvas = new El('canvas', { id: 'backgroundLeftCanvas' })
    leftCanvas.width = 300
    leftCanvas.height = 600
    const canvasScale = (opts.dragon && opts.dragon.scale) || 1
    leftCanvas.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        width: leftCanvas.width * canvasScale,
        height: leftCanvas.height * canvasScale
    })
    const specialPopup = new El('div', { id: 'specialPopup' })
    doc.body.append(leftCanvas, specialPopup)

    let dragonOpen = false

    function dragonCost(level) {
        if (level <= 4) return { kind: 'cookies', amount: 1e6 * Math.pow(2, level) }
        if (level <= 24) return { kind: 'building', building: level - 5, amount: 100 }
        if (level <= 26) return { kind: 'everyOf', amount: level === 25 ? 50 : 200 }
        return { kind: 'none' }
    }

    function dragonAffordable() {
        if (opts.dragon && opts.dragon.trainable !== undefined) return opts.dragon.trainable
        const cost = dragonCost(dragon.level)
        if (cost.kind === 'cookies') return state.bank >= cost.amount
        if (cost.kind === 'building') return (state.owned[cost.building] || 0) >= cost.amount
        if (cost.kind === 'everyOf') return state.owned.every(n => n >= cost.amount)
        return false
    }

    function payDragon(cost) {
        if (cost.kind === 'cookies') state.bank -= cost.amount
        else if (cost.kind === 'building') state.owned[cost.building] -= cost.amount
        else if (cost.kind === 'everyOf') {
            state.owned = state.owned.map(n => n - cost.amount)
        }
        refresh()
    }

    function trainLabel(level) {
        if (level < 3) return 'Chip it'
        if (level === 3) return 'Hatch it'
        if (level <= 24) return `Train aura ${level - 3}`
        if (level === 25) return 'Bake dragon cookie'
        return 'Train secondary aura'
    }

    function auraCrate(slot) {
        const crate = new El('div', { class: 'crate enabled' })
        crate.setAttribute('onclick', `Game.SelectDragonAura(${slot})`)
        crate.addEventListener('click', () => openAuraPicker(slot))
        return crate
    }

    //* openAuraPicker
    // one square per aura the dragon knows, minus whatever the other slot holds, so
    // the nth square is not aura n. Picking one redraws the whole prompt, exactly as
    // the game does, which is why nothing read before a pick is still live after it.
    function openAuraPicker(slot, update) {
        // the game only takes the current aura as the starting selection the first
        // time; a redraw after picking keeps what was picked
        if (!update) dragon.selecting = slot === 0 ? dragon.aura : dragon.aura2
        const draw = inner => {
            const other = slot === 0 ? dragon.aura2 : dragon.aura
            for (let id = 0; id <= 21; id++) {
                if (dragon.level < id + 4) continue
                if (id !== 0 && id === other) continue
                const crate = new El('div', { class: 'crate enabled' })
                crate.setAttribute('onclick', `Game.SetDragonAura(${id},${slot})`)
                crate.addEventListener('click', () => {
                    dragon.selecting = id
                    openAuraPicker(slot, 1)
                })
                inner.append(crate)
            }
        }
        prompt(
            'PickDragonAura',
            [
                [
                    'Confirm',
                    () => {
                        if (slot === 0) dragon.aura = dragon.selecting
                        else dragon.aura2 = dragon.selecting
                        // switching sacrifices one of the highest building owned
                        for (let i = state.owned.length - 1; i >= 0; i--) {
                            if (state.owned[i] > 0) {
                                state.owned[i]--
                                break
                            }
                        }
                        state.log.push(`set dragon aura ${dragon.selecting}`)
                        refresh()
                        drawDragon()
                    }
                ],
                ['Cancel']
            ],
            draw
        )
    }

    function drawDragon() {
        specialPopup.children = []
        if (!dragonOpen) return

        const pic = new El('div', { id: 'specialPic' })
        pic.setAttribute('style', `background:url(img/dragon.png?v=2.058)`)
        pic.addEventListener('click', () => {
            if (dragon.level < 4) return
            dragon.pets++
            const drop = opts.dragon && opts.dragon.dropOnPet
            if (drop && dragon.drops.indexOf(drop) === -1) dragon.drops.push(drop)
        })
        const close = new El('div', { class: 'close', text: 'x' })
        close.addEventListener('click', () => {
            dragonOpen = false
            drawDragon()
        })
        specialPopup.append(pic, close, new El('h3', { text: 'Krumblor' }))

        if (dragon.level >= 5) specialPopup.append(auraCrate(0))
        if (dragon.level >= 27) specialPopup.append(auraCrate(1))

        const cost = dragonCost(dragon.level)
        if (cost.kind === 'none') return
        const box = new El('div', { class: 'optionBox' })
        const button = new El('a', { class: 'option framed large title' })
        const costCell = new El('div', { text: 'sacrifice' })
        const costInner = new El('div', { text: 'a price' })
        // the game greys the cost out when it cannot be paid, which is the only
        // affordability signal the extension needs
        if (!dragonAffordable()) costInner.setAttribute('style', 'color:#777;')
        costCell.append(costInner)
        button.append(
            new El('div', { text: trainLabel(dragon.level) }),
            new El('div', { text: '|' }),
            costCell
        )
        button.addEventListener('click', () => {
            if (!dragonAffordable()) return
            payDragon(cost)
            dragon.level++
            state.log.push('trained dragon')
            drawDragon()
        })
        box.append(button)
        specialPopup.append(box)
    }

    leftCanvas.addEventListener('click', ev => {
        // the game only accepts the click when the canvas itself was the target
        if (ev.target !== leftCanvas) return
        if (!opts.dragon) return
        const rect = leftCanvas.getBoundingClientRect()
        const x = (ev.clientX - rect.left) / (rect.width / leftCanvas.width)
        const y = (ev.clientY - rect.top) / (rect.height / leftCanvas.height)
        // santa, when he exists, is listed first, so the dragon is always last
        const tabs = opts.dragon.santa ? 2 : 1
        const dragonY = leftCanvas.height - 24 - 48 * tabs + 48 * (tabs - 1)
        if (Math.abs(x - 24) > 24 || Math.abs(y - dragonY) > 24) return
        dragonOpen = !dragonOpen
        drawDragon()
    })

    // ---- sugar lumps ----
    // The lump itself, the two stacked sprites it is drawn with, and the level
    // badge on each building's row. The badge is deliberately not inside the
    // store product: in the real game it lives in the row over on the other side
    // of the page, which is the whole reason levelling never worked.
    //
    // `lumpLife` is how long a lump lives on this save, in hours, and the sprites
    // are drawn from it exactly the way Game.DrawLumps does.
    const lumpLife = (opts.lumpLife != null ? opts.lumpLife : 24) * 3600000
    const lumpsEl = new El('div', { id: 'lumps' })
    const lumpsIcon = new El('div', { id: 'lumpsIcon' })
    const lumpsIcon2 = new El('div', { id: 'lumpsIcon2' })
    lumpsEl.append(lumpsIcon, lumpsIcon2)
    doc.body.append(lumpsEl)

    function drawLumps(ageMs) {
        const sevenths = (ageMs / lumpLife) * 7
        const phase = Math.min(6, Math.floor(sevenths))
        const phase2 = Math.min(6, Math.floor(sevenths) + 1)
        let opacity = Math.min(6, sevenths) % 1
        if (phase >= 6) opacity = 1
        lumpsIcon.style.backgroundPosition = `${-(23 + Math.min(phase, 5)) * 48}px ${-14 * 48}px`
        lumpsIcon2.style.backgroundPosition = `${-(23 + phase2) * 48}px ${-14 * 48}px`
        lumpsIcon2.style.opacity = String(opacity)
    }
    state.lumpAge = opts.lumpAge != null ? opts.lumpAge : 0
    drawLumps(state.lumpAge)

    lumpsEl.addEventListener('click', () => {
        // the game harvests silently, and never asks first. A lump clicked before
        // it is ripe yields nothing half the time, which is what the two entries
        // in the log are there to tell apart.
        if (state.lumpAge >= lumpLife - 3600000) state.log.push('harvested a ripe lump')
        else if (state.lumpAge >= lumpLife - 4 * 3600000) state.log.push('harvested an unripe lump')
    })

    const levelBadges = []
    BUILDINGS.forEach((b, i) => {
        const row = new El('div', { class: 'row', id: 'row' + i })
        const badge = new El('div', { id: 'productLevel' + i, class: 'productButton productLevel' })
        badge.addEventListener('click', () => {
            // the game only asks when the "confirm lump spends" preference is on
            if (!opts.askLumps) {
                state.log.push('levelled ' + BUILDINGS[i][0])
                return
            }
            prompt('SpendLump', [['Yes', () => state.log.push('levelled ' + BUILDINGS[i][0])], ['No']])
        })
        row.append(badge)
        levelBadges.push(badge)
        doc.body.append(row)
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
        GENE_IDS,
        drawLumps,
        lumpsEl,
        levelBadges,
        dragon,
        drawDragon,
        addShimmer,
        clearShimmers,
        leftCanvas,
        specialPopup
    }
}

function fmt(n) {
    n = Math.round(n)
    if (n < 1e6) return n.toLocaleString('en-US')
    // the game's own ladder. It has to run this far up because kitten prices do:
    // the strongest are past 1e50, and a permanent slot is picked by comparing them
    const units = [
        [1e63, 'vigintillion'],
        [1e60, 'novemdecillion'],
        [1e57, 'octodecillion'],
        [1e54, 'septendecillion'],
        [1e51, 'sexdecillion'],
        [1e48, 'quindecillion'],
        [1e45, 'quattuordecillion'],
        [1e42, 'tredecillion'],
        [1e39, 'duodecillion'],
        [1e36, 'undecillion'],
        [1e33, 'decillion'],
        [1e30, 'nonillion'],
        [1e27, 'octillion'],
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
