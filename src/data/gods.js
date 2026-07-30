// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Pantheon Reference Data
    // Spirit ids are positional in the game's own list, and that same order is what
    // the pantheon writes into the save. Effects are given per slot, strongest
    // first: diamond, ruby, jade.

    const GODS = [
        { id: 0, name: 'Holobore', title: 'Spirit of Asceticism' },
        { id: 1, name: 'Vomitrax', title: 'Spirit of Decadence' },
        { id: 2, name: 'Godzamok', title: 'Spirit of Ruin' },
        { id: 3, name: 'Cyclius', title: 'Spirit of Ages' },
        { id: 4, name: 'Selebrak', title: 'Spirit of Festivities' },
        { id: 5, name: 'Dotjeiess', title: 'Spirit of Creation' },
        { id: 6, name: 'Muridal', title: 'Spirit of Labor' },
        { id: 7, name: 'Jeremy', title: 'Spirit of Industry' },
        { id: 8, name: 'Mokalsium', title: 'Mother Spirit' },
        { id: 9, name: 'Skruuia', title: 'Spirit of Scorn' },
        { id: 10, name: 'Rigidel', title: 'Spirit of Order' }
    ]

    const SLOTS = ['diamond', 'ruby', 'jade']

    //* Holobore is unusable here
    // Holobore gives the largest flat production bonus in the game, and every
    // standard idle guide slots it first. It also unslots itself and burns every
    // remaining worship swap the moment you click a golden cookie.
    //
    // Alakazam clicks every golden cookie it sees, within milliseconds, forever.
    // So Holobore would be ejected almost immediately and take the whole swap
    // budget with it. It is excluded from every preset on purpose.
    const UNUSABLE = [0]

    //* Presets
    // clicker: Alakazam bursts thousands of clicks a second, so Muridal's click
    //   bonus is worth more than the 3% of building output it costs.
    // idle: for when the autoclicker is switched off and production is everything.
    // combo: Godzamok converts mass building sales into click power, which is the
    //   backbone of a golden cookie combo. Only sensible when actively comboing.
    const PRESETS = {
        clicker: { diamond: 6, ruby: 7, jade: 8, why: 'clicks dominate while the autoclicker runs' },
        idle: { diamond: 7, ruby: 8, jade: 5, why: 'production only, no clicking' },
        combo: { diamond: 2, ruby: 8, jade: 6, why: 'selling buildings for click power' }
    }

    //* Effects
    // What each spirit does, per slot, diamond first. These are the temple's own
    // numbers, and they are here rather than in prose so strategy/pantheon.js can
    // price a layout instead of choosing between three hand-written ones.
    //
    // `kind` says what the number multiplies, and a negative value is a penalty: the
    // pantheon is built out of trade-offs and half of what matters about a layout is
    // what it gives up. Jeremy and Mokalsium both make golden cookies rarer, which
    // for a bot that clicks every one of them is a real cost and was priced at zero
    // for as long as the presets were fixed.
    const EFFECTS = {
        0: [{ kind: 'production', values: [0.15, 0.1, 0.05] }],
        1: [
            { kind: 'goldenDuration', values: [0.07, 0.05, 0.02] },
            { kind: 'production', values: [-0.07, -0.05, -0.02] }
        ],
        2: [{ kind: 'clickPerSale', values: [0.01, 0.005, 0.0025] }],
        3: [{ kind: 'cycle', values: [3, 12, 24] }],
        4: [{ kind: 'seasonal', values: [1, 0.5, 0.25] }],
        5: [
            { kind: 'buildingCost', values: [0.07, 0.05, 0.02] },
            { kind: 'prestige', values: [-0.3, -0.2, -0.1] }
        ],
        6: [
            { kind: 'click', values: [0.15, 0.1, 0.05] },
            { kind: 'production', values: [-0.03, -0.02, -0.01] }
        ],
        7: [
            { kind: 'production', values: [0.1, 0.06, 0.03] },
            { kind: 'goldenRate', values: [-0.1, -0.06, -0.03] }
        ],
        8: [
            { kind: 'milk', values: [0.1, 0.05, 0.03] },
            { kind: 'goldenRate', values: [-0.15, -0.1, -0.05] }
        ],
        9: [
            { kind: 'wrinklerRate', values: [1.5, 1, 0.5] },
            { kind: 'wrinklerDigest', values: [0.15, 0.1, 0.05] }
        ],
        10: [{ kind: 'lumps', values: [60, 40, 20] }]
    }

    //* Supreme Intellect promotes the slots
    // With the dragon aura equipped the temple reads the ruby slot as a diamond and
    // the jade slot as a ruby, so the same three spirits are worth more and the best
    // layout is not necessarily the same one. This is the tier each slot pays out at,
    // with the aura and without.
    const TIERS = { plain: [0, 1, 2], promoted: [0, 0, 1] }

    function effectsOf(id) {
        return EFFECTS[id] || []
    }

    function byId(id) {
        return GODS.find(g => g.id === id) || null
    }

    function nameOf(id) {
        const god = byId(id)
        return god ? god.name : id === -1 ? 'empty' : `#${id}`
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.data = window.Alakazam.data || {}
    window.Alakazam.data.gods = {
        GODS,
        SLOTS,
        PRESETS,
        UNUSABLE,
        EFFECTS,
        TIERS,
        effectsOf,
        byId,
        nameOf
    }
})()
