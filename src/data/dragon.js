// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Krumblor Reference Data
    // Aura ids and level indices are the game's own, and both are written into the
    // save as plain numbers (dragonLevel, dragonAura, dragonAura2), so getting them
    // wrong here means acting on the wrong dragon entirely.
    //
    //! The training ladder
    // Twenty eight levels, in a fixed order nobody can skip. The first five cost
    // cookies. The next twenty each sacrifice a hundred of one building, in building
    // order, so the ladder walks up the store: level 5 takes a hundred cursors,
    // level 24 takes a hundred Yous. The last three are the dragon cookie, the
    // second aura slot, and being finished.
    //
    // Two consequences worth stating outright, because the whole policy follows from
    // them. Radiant Appetite, which doubles all production and is the only aura that
    // does not care how the game is played, is not reachable until level 19, which
    // is fourteen building sacrifices in. And Game.Reset zeroes all three dragon
    // fields on every ascension, not only on a hard reset, so none of this is a
    // one-time investment: it is paid again every run.

    const COOKIE_LEVELS = [1e6, 2e6, 4e6, 8e6, 16e6]

    // the level that trains aura n, and the aura a level trains, are off by three
    const AURA_OFFSET = 3

    // the level that sacrifices building n is off by five from it
    const BUILDING_OFFSET = 5

    // aura n cannot be selected until the dragon is this far past training it: the
    // game's rule is dragonLevel >= n + 4
    const SELECTABLE_AFTER = 4

    const SECOND_SLOT_LEVEL = 27
    const MAX_LEVEL = 27

    // petting is unlocked with the dragon hatched, but nothing drops until level 8
    const PET_MIN_LEVEL = 4
    const DROP_MIN_LEVEL = 8

    // which of the four drops a pet can produce is decided by the quarter of the
    // hour it happens in, from a shuffle fixed per save seed. So there are four
    // windows, and pets in a window whose drop is already owned are wasted.
    const DROP_WINDOWS = 4
    const DROPS = ['Dragon scale', 'Dragon claw', 'Dragon fang', 'Dragon teddy bear']

    //* Auras
    // `kind` and `amount` are what strategy/dragon.js scores. Every aura is here,
    // including the ones worth nothing to us, because a candidate list with holes in
    // it cannot be compared against anything.
    const AURAS = [
        { id: 0, name: 'No aura', kind: 'none' },
        { id: 1, name: 'Breath of Milk', kind: 'milk', amount: 0.05 },
        { id: 2, name: 'Dragon Cursor', kind: 'click', amount: 0.05 },
        { id: 3, name: 'Elder Battalion', kind: 'grandmas', amount: 0.01 },
        { id: 4, name: 'Reaper of Fields', kind: 'harvestRoll', amount: 15 },
        { id: 5, name: 'Earth Shatterer', kind: 'sellback', amount: 0.5 },
        { id: 6, name: 'Master of the Armory', kind: 'upgradeCost', amount: 0.02 },
        { id: 7, name: 'Fierce Hoarder', kind: 'buildingCost', amount: 0.02 },
        { id: 8, name: 'Dragon God', kind: 'prestige', amount: 0.05 },
        { id: 9, name: 'Arcane Aura', kind: 'goldenRate', amount: 0.05 },
        { id: 10, name: 'Dragonflight', kind: 'flightRoll', amount: 1111 },
        { id: 11, name: 'Ancestral Metamorphosis', kind: 'goldenGain', amount: 0.1 },
        { id: 12, name: 'Unholy Dominion', kind: 'wrathGain', amount: 0.1 },
        { id: 13, name: 'Epoch Manipulator', kind: 'goldenDuration', amount: 0.05 },
        { id: 14, name: 'Mind Over Matter', kind: 'drops', amount: 0.25 },
        { id: 15, name: 'Radiant Appetite', kind: 'production', amount: 1 },
        { id: 16, name: "Dragon's Fortune", kind: 'perGolden', amount: 1.23 },
        { id: 17, name: "Dragon's Curve", kind: 'lumps', amount: 0.05 },
        { id: 18, name: 'Reality Bending', kind: 'combined', amount: 0.1 },
        { id: 19, name: 'Dragon Orbs', kind: 'orbs', amount: 0.1 },
        { id: 20, name: 'Supreme Intellect', kind: 'minigames', amount: 0.1 },
        { id: 21, name: 'Dragon Guts', kind: 'wrinklers', amount: 0.2 }
    ]

    //* Levels
    // built the way the game builds it, so the two cannot drift apart by a typo in
    // a transcribed table. `kind` says what the step costs:
    //   cookies  - a flat number of cookies
    //   building - a hundred of one building, by store index
    //   everyOf  - that many of every building there is
    //   none     - nothing left to train
    const LEVELS = []
    for (let level = 0; level <= MAX_LEVEL; level++) {
        const trainsAura = level >= 4 && level <= 24 ? level - AURA_OFFSET : null
        if (level < COOKIE_LEVELS.length) {
            LEVELS.push({ level, kind: 'cookies', amount: COOKIE_LEVELS[level], trainsAura })
        } else if (level <= 24) {
            LEVELS.push({
                level,
                kind: 'building',
                amount: 100,
                building: level - BUILDING_OFFSET,
                trainsAura
            })
        } else if (level === 25) {
            LEVELS.push({ level, kind: 'everyOf', amount: 50, trainsAura: null })
        } else if (level === 26) {
            LEVELS.push({ level, kind: 'everyOf', amount: 200, trainsAura: null })
        } else {
            LEVELS.push({ level, kind: 'none', trainsAura: null })
        }
    }

    function auraById(id) {
        return AURAS[id] || null
    }

    function nameOf(id) {
        const aura = auraById(id)
        return aura ? aura.name : `#${id}`
    }

    //* levelFor
    // what the dragon's next step costs, or null past the end of the ladder
    function levelFor(level) {
        return LEVELS[level] || null
    }

    //* selectable
    // whether an aura can be put in a slot at this dragon level
    function selectable(auraId, dragonLevel) {
        return dragonLevel >= auraId + SELECTABLE_AFTER
    }

    //* trainedAuras
    // every aura the dragon knows at this level, aura 0 included: it is a real
    // choice the game offers and it is what an untrained dragon has.
    function trainedAuras(dragonLevel) {
        return AURAS.filter(a => selectable(a.id, dragonLevel)).map(a => a.id)
    }

    //* dropWindow
    // which of the four petting windows a moment falls in. The game reads the
    // minute hand, so this is minute/15 and nothing cleverer.
    function dropWindow(at) {
        const minutes = new Date(at === undefined ? Date.now() : at).getMinutes()
        return Math.floor((minutes / 60) * DROP_WINDOWS)
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.data = window.Alakazam.data || {}
    window.Alakazam.data.dragon = {
        AURAS,
        LEVELS,
        DROPS,
        DROP_WINDOWS,
        MAX_LEVEL,
        SECOND_SLOT_LEVEL,
        PET_MIN_LEVEL,
        DROP_MIN_LEVEL,
        auraById,
        nameOf,
        levelFor,
        selectable,
        trainedAuras,
        dropWindow
    }
})()
