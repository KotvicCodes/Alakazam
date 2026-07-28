// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Garden Reference Data
    // Plant ids are positional in the game's own list, and that order is what the
    // garden writes into its part of the save: one character per plant in the seed
    // log, and plant id plus one in each plot tile (zero meaning empty).
    //
    // Every mutation is "these plants growing next to each other can produce that
    // one, with this chance per garden tick". Chances are per tick and small, so
    // unlocking the whole seed log is a matter of leaving the right pair planted
    // and waiting, not of doing anything clever.

    // in save order. the index is the id.
    const PLANTS = [
        { key: 'bakerWheat', name: "Baker's wheat", tier: 1 },
        { key: 'thumbcorn', name: 'Thumbcorn', tier: 1 },
        { key: 'cronerice', name: 'Cronerice', tier: 2 },
        { key: 'gildmillet', name: 'Gildmillet', tier: 2 },
        { key: 'clover', name: 'Ordinary clover', tier: 2 },
        { key: 'goldenClover', name: 'Golden clover', tier: 3 },
        { key: 'shimmerlily', name: 'Shimmerlily', tier: 3 },
        { key: 'elderwort', name: 'Elderwort', tier: 3 },
        { key: 'bakeberry', name: 'Bakeberry', tier: 4 },
        { key: 'chocoroot', name: 'Chocoroot', tier: 4 },
        { key: 'whiteChocoroot', name: 'White chocoroot', tier: 4 },
        { key: 'whiteMildew', name: 'White mildew', tier: 1 },
        { key: 'brownMold', name: 'Brown mold', tier: 1 },
        { key: 'meddleweed', name: 'Meddleweed', tier: 1 },
        { key: 'whiskerbloom', name: 'Whiskerbloom', tier: 4 },
        { key: 'chimerose', name: 'Chimerose', tier: 4 },
        { key: 'nursetulip', name: 'Nursetulip', tier: 5 },
        { key: 'drowsyfern', name: 'Drowsyfern', tier: 5 },
        { key: 'wardlichen', name: 'Wardlichen', tier: 5 },
        { key: 'keenmoss', name: 'Keenmoss', tier: 5 },
        { key: 'queenbeet', name: 'Queenbeet', tier: 6 },
        { key: 'queenbeetLump', name: 'Juicy queenbeet', tier: 6, unplantable: true },
        { key: 'duketater', name: 'Duketater', tier: 6 },
        { key: 'crumbspore', name: 'Crumbspore', tier: 1 },
        { key: 'doughshroom', name: 'Doughshroom', tier: 6 },
        { key: 'glovemorel', name: 'Glovemorel', tier: 6 },
        { key: 'cheapcap', name: 'Cheapcap', tier: 6 },
        { key: 'foolBolete', name: "Fool's bolete", tier: 6 },
        { key: 'wrinklegill', name: 'Wrinklegill', tier: 6 },
        { key: 'greenRot', name: 'Green rot', tier: 6 },
        { key: 'shriekbulb', name: 'Shriekbulb', tier: 7 },
        { key: 'tidygrass', name: 'Tidygrass', tier: 7 },
        { key: 'everdaisy', name: 'Everdaisy', tier: 7 },
        { key: 'ichorpuff', name: 'Ichorpuff', tier: 7 }
    ]

    //* Mutations
    // `parents` lists the plant keys that must be growing nearby. A repeated key
    // means two or more of that plant. `chance` is per garden tick, as a percent.
    // Recipes are ordered best-chance first within each target.
    const MUTATIONS = [
        { target: 'bakerWheat', parents: ['bakerWheat', 'bakerWheat'], chance: 20 },
        { target: 'thumbcorn', parents: ['thumbcorn', 'thumbcorn'], chance: 10 },
        { target: 'thumbcorn', parents: ['bakerWheat', 'bakerWheat'], chance: 5 },
        { target: 'cronerice', parents: ['bakerWheat', 'thumbcorn'], chance: 1 },
        { target: 'gildmillet', parents: ['cronerice', 'thumbcorn'], chance: 3 },
        { target: 'clover', parents: ['bakerWheat', 'gildmillet'], chance: 3 },
        { target: 'goldenClover', parents: ['bakerWheat', 'gildmillet'], chance: 0.07 },
        { target: 'shimmerlily', parents: ['clover', 'gildmillet'], chance: 2 },
        { target: 'elderwort', parents: ['shimmerlily', 'cronerice'], chance: 1 },
        { target: 'bakeberry', parents: ['bakerWheat', 'bakerWheat'], chance: 0.1 },
        { target: 'chocoroot', parents: ['bakerWheat', 'brownMold'], chance: 10 },
        { target: 'whiteChocoroot', parents: ['chocoroot', 'whiteMildew'], chance: 10 },
        { target: 'whiteMildew', parents: ['brownMold'], chance: 50 },
        { target: 'brownMold', parents: ['whiteMildew'], chance: 50 },
        { target: 'meddleweed', parents: [], chance: 0.2 },
        { target: 'whiskerbloom', parents: ['shimmerlily', 'whiteChocoroot'], chance: 1 },
        { target: 'chimerose', parents: ['shimmerlily', 'whiskerbloom'], chance: 5 },
        { target: 'nursetulip', parents: ['whiskerbloom', 'whiskerbloom'], chance: 5 },
        { target: 'keenmoss', parents: ['greenRot', 'brownMold'], chance: 10 },
        { target: 'drowsyfern', parents: ['chocoroot', 'keenmoss'], chance: 0.5 },
        { target: 'wardlichen', parents: ['cronerice', 'keenmoss'], chance: 0.5 },
        { target: 'wardlichen', parents: ['cronerice', 'whiteMildew'], chance: 0.5 },
        { target: 'queenbeet', parents: ['bakeberry', 'chocoroot'], chance: 1 },
        { target: 'duketater', parents: ['queenbeet', 'queenbeet'], chance: 0.1 },
        { target: 'crumbspore', parents: ['doughshroom', 'doughshroom'], chance: 0.5 },
        { target: 'doughshroom', parents: ['crumbspore', 'crumbspore'], chance: 0.5 },
        { target: 'glovemorel', parents: ['crumbspore', 'thumbcorn'], chance: 2 },
        { target: 'cheapcap', parents: ['crumbspore', 'shimmerlily'], chance: 4 },
        { target: 'foolBolete', parents: ['doughshroom', 'greenRot'], chance: 4 },
        { target: 'wrinklegill', parents: ['crumbspore', 'brownMold'], chance: 6 },
        { target: 'greenRot', parents: ['whiteMildew', 'clover'], chance: 5 },
        { target: 'tidygrass', parents: ['bakerWheat', 'whiteChocoroot'], chance: 0.2 },
        { target: 'shriekbulb', parents: ['wrinklegill', 'elderwort'], chance: 0.1 },
        { target: 'ichorpuff', parents: ['elderwort', 'crumbspore'], chance: 0.2 },
        {
            target: 'everdaisy',
            parents: ['tidygrass', 'tidygrass', 'tidygrass', 'elderwort', 'elderwort', 'elderwort'],
            chance: 0.2
        },
        {
            target: 'queenbeetLump',
            parents: [
                'queenbeet',
                'queenbeet',
                'queenbeet',
                'queenbeet',
                'queenbeet',
                'queenbeet',
                'queenbeet',
                'queenbeet'
            ],
            chance: 0.1
        }
    ]

    //* Worth harvesting for their effect
    // these give a large one-off cookie payout or a sugar lump when harvested ripe.
    // everything else is only worth harvesting to unlock its seed or clear a tile.
    const VALUABLE = [
        'bakeberry',
        'chocoroot',
        'whiteChocoroot',
        'queenbeet',
        'duketater',
        'queenbeetLump'
    ]

    //* Weeds
    // these spread on their own and crowd out whatever is being cultivated
    const WEEDS = ['meddleweed', 'brownMold', 'whiteMildew', 'crumbspore']

    //* Soils
    // id order matches the game's soil list. wood chips triple mutation rates at
    // the cost of plant effectiveness, which is exactly the trade to make while
    // hunting for seeds rather than farming a crop.
    const SOILS = [
        { id: 0, key: 'dirt', farms: 1, tickMinutes: 5 },
        { id: 1, key: 'fertilizer', farms: 50, tickMinutes: 3 },
        { id: 2, key: 'clay', farms: 100, tickMinutes: 15 },
        { id: 3, key: 'pebbles', farms: 200, tickMinutes: 5 },
        { id: 4, key: 'woodChips', farms: 300, tickMinutes: 5, mutationBoost: 3 }
    ]

    function byKey(key) {
        const id = PLANTS.findIndex(p => p.key === key)
        return id === -1 ? null : { id, ...PLANTS[id] }
    }

    function byId(id) {
        return PLANTS[id] ? { id, ...PLANTS[id] } : null
    }

    //* recipesFor
    // every way to grow a given plant, best chance first
    function recipesFor(key) {
        return MUTATIONS.filter(m => m.target === key).sort((a, b) => b.chance - a.chance)
    }

    //* reachable
    // whether a mutation can be attempted right now: every parent it needs must
    // already be in the seed log, and it must need at most `slots` plants
    function reachable(mutation, unlockedKeys, slots) {
        if (mutation.parents.length === 0) return false
        if (mutation.parents.length > slots) return false
        return mutation.parents.every(p => unlockedKeys.indexOf(p) !== -1)
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.data = window.Alakazam.data || {}
    window.Alakazam.data.plants = {
        PLANTS,
        MUTATIONS,
        VALUABLE,
        WEEDS,
        SOILS,
        byKey,
        byId,
        recipesFor,
        reachable
    }
})()
