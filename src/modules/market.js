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
    // ticks the current mode has left. So the advice here is not a prediction; it
    // is reading the answer. That is also exactly why trading is switched off by
    // default: knowing the trend makes this trivially profitable, and whether that
    // is the game you want to play is your call, not this extension's.
    //
    // With trading off the module still watches and reports, which costs nothing
    // and makes the HUD useful.

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

        const goods = market.goods.map(good => ({
            ...good,
            name: GOODS[good.id] || `good ${good.id}`,
            mode: good.mode,
            modeName: MODES[good.mode] || 'unknown',
            resting: restingValue(good.id, bank.level),
            signal: signalFor(good, bank.level)
        }))

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

    function clickGood(id, suffix) {
        const el = document.getElementById(`bankGood-${id}${suffix}`)
        if (!el) return false
        simulateClick(el)
        return true
    }

    //* trade
    // one action per market tick at most, on the strongest signal available.
    // selling everything is safe; buying is capped at a hundred units so a single
    // decision cannot commit the whole warehouse to one good.
    function trade(s) {
        const sells = s.goods.filter(g => g.stock > 0 && /sell/.test(g.signal))
        if (sells.length > 0) {
            // strongest signal first. sorting by the raw mode number would rank a
            // merely overpriced stable good above one in freefall, because stable
            // happens to be mode 0.
            const rank = g => (g.signal === 'strong sell' ? 0 : 1)
            const worst = sells.sort((a, b) => rank(a) - rank(b))[0]
            if (clickGood(worst.id, '_-All')) {
                console.log(`Alakazam: selling all ${worst.name} (${worst.modeName})`)
                return true
            }
        }

        // warehouse capacity is derived from the office level and the building
        // count rather than stored, so it is not checked here. Buying into a full
        // warehouse simply buys fewer units, which is harmless.
        const buys = s.goods.filter(g => g.signal === 'strong buy')
        if (buys.length > 0) {
            const best = buys.sort((a, b) => a.value / a.resting - b.value / b.resting)[0]
            if (clickGood(best.id, '_100')) {
                console.log(
                    `Alakazam: buying ${best.name} at ${best.value.toFixed(2)} (${best.modeName})`
                )
                return true
            }
        }
        return false
    }

    function tick() {
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
        if (trade(s)) lastTradeAt = Date.now()
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
