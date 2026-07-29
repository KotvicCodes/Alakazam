//! Save fixtures
// Builds save strings the same way the game does, so the parser is tested against
// the real encoding rather than against a hand-written object. Every field is
// positional, which is exactly the fragility these fixtures exist to pin down.

// section 4 of a real save, counted straight off Game.WriteSave. The two shiny
// wrinkler fields sit between `volume` and `lumps`, which is what makes the lump
// and prestige offsets below look further along than you might expect.
const SCALAR_COUNT = 55

function encode(text) {
    return Buffer.from(unescape(encodeURIComponent(text)), 'binary').toString('base64') + '!END!'
}

//* save
// assemble a full save. everything has a sane default so a test only has to say
// what it actually cares about.
function save(opts = {}) {
    const scalars = new Array(SCALAR_COUNT).fill(0)
    scalars[0] = opts.cookies != null ? opts.cookies : 1e6 // cookies
    scalars[1] = opts.cookiesEarned != null ? opts.cookiesEarned : 1e9 // cookiesEarned
    scalars[2] = opts.cookieClicks || 0 // cookieClicks, the game's own tally
    scalars[4] = opts.handmadeCookies || 0 // cookies earned by clicking, ever
    scalars[8] = opts.cookiesReset || 0 // lifetime cookies across every past run
    scalars[14] = opts.resets || 0 // resets
    scalars[17] = opts.wrinklersPopped || 0
    scalars[22] = 0 // season
    scalars[23] = opts.wrinklerHoard || 0 // wrinklersAmount
    scalars[24] = opts.wrinklers || 0 // wrinklersNumber
    scalars[25] = opts.prestige || 0
    scalars[26] = opts.heavenlyChips || 0
    scalars[27] = opts.heavenlyChipsSpent || 0
    scalars[29] = opts.ascensionMode || 0 // 0 is an ordinary run, anything else a challenge
    scalars[40] = opts.shinyWrinklers || 0 // shiny wrinklers, then what they hold
    scalars[41] = opts.shinyWrinklerHoard || 0
    scalars[42] = opts.lumps != null ? opts.lumps : 0
    scalars[43] = opts.lumpsTotal != null ? opts.lumpsTotal : 0
    scalars[44] = opts.lumpT != null ? opts.lumpT : Date.now()
    scalars[46] = opts.lumpType != null ? opts.lumpType : 0
    scalars[47] = '' // vault, a comma list

    //* driftedScalars
    // write the section the way a game that did not have shiny wrinklers would:
    // the same values, two fields short, everything from the lumps onward sitting
    // two places to the left. This is exactly the drift the parser was reading
    // saves through, so it is what an untrusted save looks like in a test.
    if (opts.driftedScalars) scalars.splice(40, 2)

    const levels = opts.levels || {}
    const amounts = opts.amounts || {}
    const minigames = opts.minigames || {}

    const buildings = []
    for (let i = 0; i < 20; i++) {
        buildings.push(
            [
                amounts[i] || 0,
                amounts[i] || 0,
                (20 - i) * 1e6,
                levels[i] || 0,
                minigames[i] || '',
                0,
                amounts[i] || 0
            ].join(',')
        )
    }

    const text = [
        opts.version || '2.052',
        '',
        // the clone appearance is a sixth field here, and older saves simply do not
        // have it, so it is only written when a test asks for one
        [
            opts.startDate || 1750000001000,
            opts.fullDate || 1750000000000,
            Date.now(),
            opts.bakeryName || 'Test Bakery',
            opts.seed || 'abcde'
        ]
            .concat(opts.appearance != null ? [opts.appearance] : [])
            .join(';'),
        '1'.repeat(27),
        scalars.join(';'),
        buildings.join(';'),
        opts.upgradeBits || '11'.repeat(200),
        opts.achievementBits || '1010'.repeat(50),
        opts.buffs || ''
    ].join('|')

    return { text, raw: encode(text) }
}

//! Minigame sub-saves, in the formats their own source files write

function garden({ unlocked = [0, 1], plot = [], soil = 0 } = {}) {
    const bits = new Array(34).fill('0')
    unlocked.forEach(i => (bits[i] = '1'))
    const flat = []
    for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) {
            const tile = (plot[y] && plot[y][x]) || [0, 0]
            flat.push(tile[0], tile[1])
        }
    }
    return `1000:${soil}:0:0:5:9:1:0:0: ${bits.join('')} ${flat.join(':')}:`
}

function market({ goods = [], officeLevel = 4, brokers = 12 } = {}) {
    const filled = goods.slice()
    while (filled.length < 18) filled.push({ val: 50, mode: 0, stock: 0 })
    const encoded = filled
        .map(
            g =>
                `${Math.round(g.val * 100)}:${g.mode}:${Math.round((g.d || 0) * 100)}:50:` +
                `${g.stock || 0}:0:0:${Math.round((g.prev || 10) * 100)}!`
        )
        .join('')
    return `${officeLevel}:${brokers}:1:500:5 ${encoded} 1`
}

function pantheon({ slots = [-1, -1, -1], swaps = 3 } = {}) {
    return `${slots.join('/')} ${swaps} ${Date.now()} 1`
}

function grimoire({ magic = 50, cast = 0 } = {}) {
    return `${magic} ${cast} ${cast} 1`
}

module.exports = { save, garden, market, pantheon, grimoire, encode, SCALAR_COUNT }
