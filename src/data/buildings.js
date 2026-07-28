// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Building Reference Data
    // Published base production per building, in cookies per second for one unit
    // with no upgrades. This is the same public information the game's wiki lists.
    //
    // It is only needed to score a building you do not own yet: before you own
    // one, its tooltip is flavour text with no production line, so there is
    // nothing to measure. From the first purchase onwards the tooltip figure is
    // authoritative and this table is ignored.

    const BASE_PRODUCTION = {
        cursor: 0.1,
        grandma: 1,
        farm: 8,
        mine: 47,
        factory: 260,
        bank: 1400,
        temple: 7800,
        'wizard tower': 44000,
        shipment: 260000,
        'alchemy lab': 1600000,
        portal: 10000000,
        'time machine': 65000000,
        'antimatter condenser': 430000000,
        prism: 2900000000,
        chancemaker: 21000000000,
        'fractal engine': 150000000000,
        'javascript console': 1100000000000,
        idleverse: 8300000000000,
        'cortex baker': 64000000000000,
        you: 510000000000000
    }

    //* Price growth
    // every building costs 15% more than the last one you bought, uniformly. all
    // price discounts in the game are a flat multiplier over that same curve,
    // which is what makes the bulk price a clean geometric series.
    const PRICE_GROWTH = 1.15

    //* Count thresholds
    // buying past one of these unlocks that building's next tiered upgrade, and
    // several are achievements in their own right. crossing one is worth more
    // than the buildings alone, which is the real reason to buy in bulk.
    const COUNT_THRESHOLDS = [1, 10, 25, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500]

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.data = window.Alakazam.data || {}
    window.Alakazam.data.buildings = { BASE_PRODUCTION, PRICE_GROWTH, COUNT_THRESHOLDS }
})()
