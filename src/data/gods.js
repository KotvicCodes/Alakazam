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

    function byId(id) {
        return GODS.find(g => g.id === id) || null
    }

    function nameOf(id) {
        const god = byId(id)
        return god ? god.name : id === -1 ? 'empty' : `#${id}`
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.data = window.Alakazam.data || {}
    window.Alakazam.data.gods = { GODS, SLOTS, PRESETS, UNUSABLE, byId, nameOf }
})()
