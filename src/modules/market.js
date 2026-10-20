// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Stock Market
    // Every good in the market is secretly in one of six trend modes: stable,
    // rising slowly, falling slowly, rising fast, falling fast, or chaotic. The
    // page never shows which. A player has to infer it from the graph, and mostly
    // guesses wrong.
    //
    // The save records it outright, along with each good's momentum and how many
    // ticks the current mode has left. So the decisions here are not predictions;
    // they are reading the answer, which makes the market reliably profitable.
    //
    // Trading is on by default. Switch it off and the module keeps watching and
    // reporting its signals to the HUD without touching your money.

    const { simulateClick } = window.Alakazam.input
    const { save, store, registry } = window.Alakazam

    const INTERVAL_MS = 15000

    // the market advances once a minute, so acting more often than that just
    // repeats the same decision against the same prices
    const TRADE_COOLDOWN_MS = 60000

    //* Goods
    // id order is positional and matches the buildings from Farm upwards
    const GOODS = [
        'Cereals',
        'Chocolate',
        'Butter',
        'Sugar',
        'Nuts',
        'Salt',
        'Vanilla',
        'Eggs',
        'Cinnamon',
        'Cream',
        'Jam',
        'White chocolate',
        'Honey',
        'Cookies',
        'Recipes',
        'Subsidiaries',
        'Publicists',
        'You'
    ]

    const MODES = ['stable', 'slow rise', 'slow fall', 'fast rise', 'fast fall', 'chaotic']

    let lastTradeAt = 0
    const MAX_ATTEMPTS = 3
    const { firstNumberIn } = window.Alakazam.parse

    function number(id) {
        const node = document.getElementById(id)
        return node ? firstNumberIn(node.innerText) : NaN
    }

    function holdings(id) {
        return number(`bankGood-${id}-stock`)
    }

    //* restingValue
    // every good drifts toward this price, and the bank's sugar lump level raises
    // it. buying well under it is buying something that is likely to come back up.
    function restingValue(id, bankLevel) {
        return 10 * (id + 1) + Math.max(1, bankLevel) - 1
    }

    //! Advice

    //* signalFor
    // Turns the hidden mode into a decision. The mode says which way the price is
    // going; the resting value says whether the price is cheap in absolute terms.
    // Both have to agree before this suggests putting money in.
    function signalFor(good, bankLevel) {
        const resting = restingValue(good.id, bankLevel)
        const cheap = good.value < resting
        const dear = good.value > resting

        if (good.mode === 3) return cheap ? 'strong buy' : 'buy'
        if (good.mode === 1) return cheap ? 'buy' : 'hold'
        if (good.mode === 4) return 'strong sell'
        if (good.mode === 2) return good.stock > 0 ? 'sell' : 'hold'
        // chaotic swings either way with no usable bias, and stable goes nowhere
        if (good.mode === 5) return 'hold'
        return cheap && good.value < resting * 0.6 ? 'buy' : dear ? 'sell' : 'hold'
    }

    function state() {
        const market = save.minigame('market')
        const bank = save.building(5)
        if (!market || !bank || bank.level < 1) return null

        const goods = market.goods.map(good => {
            const stock = holdings(good.id)
            const current = { ...good, stock: Number.isFinite(stock) ? stock : good.stock }
            return {
                ...current,
                name: GOODS[good.id] || `good ${good.id}`,
                modeName: MODES[good.mode] || 'unknown',
                resting: restingValue(good.id, bank.level),
                signal: signalFor(current, bank.level)
            }
        })

        return {
            unlocked: true,
            officeLevel: market.officeLevel,
            brokers: market.brokers,
            profit: market.profit,
            // each broker takes 5% off the 20% overhead, multiplicatively
            overhead: 0.2 * Math.pow(0.95, market.brokers),
            goods,
            trading: store.setting('marketTrading') === true
        }
    }

    //! Trading

    function candidate(good, selling, overhead) {
        const id = good.id
        const stock = holdings(id)
        const button = document.getElementById(`bankGood-${id}${selling ? '_-All' : '_100'}`)
        if (
            !button ||
            button.style.display === 'none' ||
            button.classList.contains('bankButtonOff') ||
            button.classList.contains('disabled') ||
            !Number.isFinite(stock)
        )
            return null
        if (selling) return stock > 0 ? { button, stock } : null
        const capacity = number(`bankGood-${id}-stockMax`)
        if (!Number.isFinite(capacity) || capacity <= stock) return null
        const value = number(`bankGood-${id}-val`)
        const scalars = save.get().scalars
        const rawCps = scalars?.trusted ? scalars.cookiesPsRawHighest : NaN
        const cost = value * rawCps * (1 + overhead) * Math.min(100, capacity - stock)
        if (!Number.isFinite(cost) || cost < 0 || cost > window.Alakazam.live.readGlobals().cookies)
            return null
        return { button, stock }
    }

    async function trade(s, lease) {
        const sells = s.goods
            .filter(g => /sell/.test(g.signal))
            .sort((a, b) => (a.signal === 'strong sell' ? 0 : 1) - (b.signal === 'strong sell' ? 0 : 1))
        const buys = s.goods
            .filter(g => g.signal === 'strong buy')
            .sort((a, b) => a.value / a.resting - b.value / b.resting)
        let attempts = 0
        for (const good of sells.concat(buys)) {
            if (!lease.valid() || attempts >= MAX_ATTEMPTS) break
            const selling = /sell/.test(good.signal)
            // reread holdings, capacity and funds after every preceding wait
            const executable = candidate(good, selling, s.overhead)
            if (!executable) continue
            attempts++
            simulateClick(executable.button)
            const filled = await window.Alakazam.transactions.until(lease, () => {
                const current = holdings(good.id)
                return selling ? current < executable.stock : current > executable.stock
            })
            const current = holdings(good.id)
            const executed = selling ? current < executable.stock : current > executable.stock
            if (!filled && !executed) continue
            lastTradeAt = Date.now()
            console.log(`Alakazam: ${selling ? 'sold' : 'bought'} ${good.name}`)
            return true
        }
        return false
    }

    async function tick() {
        const s = state()
        if (!s) return

        const notable = s.goods
            .filter(g => g.signal !== 'hold')
            .map(g => `${g.name} ${g.signal} @${g.value.toFixed(1)}`)

        window.__alakazam.market = {
            office: s.officeLevel,
            brokers: s.brokers,
            overhead: `${(s.overhead * 100).toFixed(1)}%`,
            profit: s.profit,
            trading: s.trading,
            signals: notable
        }

        if (!s.trading) return
        if (Date.now() - lastTradeAt < TRADE_COOLDOWN_MS) return
        const lease = window.Alakazam.transactions.acquire('marketTrading')
        if (!lease) return
        try {
            await trade(s, lease)
        } finally {
            lease.release()
        }
    }

    // gated on its own setting, which defaults to off: see the header
    registry.register({ name: 'market', interval: INTERVAL_MS, setting: 'marketTrading', tick })

    // the advisory half runs even with trading off, so it registers separately
    registry.register({
        name: 'marketWatch',
        interval: INTERVAL_MS,
        setting: 'enabled',
        tick() {
            if (store.setting('marketTrading') === true) return
            const s = state()
            if (!s) return
            window.__alakazam.market = {
                office: s.officeLevel,
                brokers: s.brokers,
                trading: false,
                signals: s.goods.filter(g => g.signal !== 'hold').map(g => `${g.name} ${g.signal}`)
            }
        }
    })

    window.Alakazam.market = { state, signalFor, restingValue, GOODS, MODES }
})()
