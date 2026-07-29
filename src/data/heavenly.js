// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Heavenly Upgrade Plan
    // The community ascension guide, as data:
    // https://cookieclicker.wiki.gg/wiki/Ascension_guide
    //
    // Each entry is one ascension: the total prestige level the guide says to reach
    // before pulling the trigger, and the heavenly upgrades to spend the chips on
    // once you are there. The costs are the game's own and are carried so a plan
    // entry can be sanity checked against what the ascend screen actually offers.
    //
    // Two things to understand before changing any of this.
    //
    // The chips figure is a target, not a price. It is the total prestige level the
    // guide expects at that ascension, and prestige is a cube root, so each step is
    // roughly eight times the cookies of the one before. Overshooting is normal and
    // costs nothing: the guide's own advice is to carry on into the next entry's
    // list, which is exactly what ORDER below makes possible.
    //
    // The order within an ascension is the guide's, not cheapest first. It buys
    // Legacy before Heavenly Cookies even though Legacy is the cheaper of the two
    // because the tree gates on it, and it puts the expensive centrepiece of a tier
    // first so that overshooting spends on the thing that mattered rather than on
    // whatever happened to be affordable.
    //
    // The guide assumes a somewhat active playstyle, where golden cookie effects
    // are the main source of cookies. That matches what Alakazam does: it clicks
    // shimmers, casts Force the Hand of Fate under production buffs, and trades.

    const PLAN = [
        {
            chips: 365,
            upgrades: [
                ['Legacy', 1],
                ['Heavenly cookies', 3],
                ['How to bake your dragon', 9],
                ['Box of brand biscuits', 25],
                ['Tin of british tea biscuits', 25],
                ['Box of macarons', 25],
                ['Heavenly luck', 77],
                ['Permanent upgrade slot I', 100],
                ['Heralds', 100]
            ]
        },
        {
            chips: 2185,
            upgrades: [
                ['Season switcher', 1111],
                ['Golden switch', 999],
                ['Tin of butter cookies', 25],
                ['Starter kit', 50]
            ]
        },
        {
            chips: 12301,
            upgrades: [
                ['Kitten angels', 9000],
                ['Dominions', 2401],
                ['Virtues', 343],
                ['Archangels', 49],
                ['Angels', 7],
                ['Twin Gates of Transcendence', 1],
                ['Persistent memory', 500]
            ]
        },
        {
            chips: 62217,
            upgrades: [
                ['Halo gloves', 55555],
                ['Lasting fortune', 777],
                ['Lucky digit', 777],
                ['Starter kitchen', 5000],
                ['Classic dairy selection', 9],
                ['Basic wallpaper assortment', 99]
            ]
        },
        {
            chips: 127776,
            upgrades: [
                ['Residual luck', 99999],
                ['Permanent upgrade slot II', 20000],
                ['Decisive fate', 7777]
            ]
        },
        {
            chips: 825019,
            upgrades: [
                ['Synergies Vol. I', 222222],
                ['Satan', 2401],
                ['Abaddon', 343],
                ['Mammon', 49],
                ['Belphegor', 7],
                ['Divine bakeries', 399999],
                ['Divine sales', 99999],
                ['Divine discounts', 99999]
            ]
        },
        {
            chips: 2568911,
            upgrades: [
                ['Synergies Vol. II', 2222222],
                ['Beelzebub', 117649],
                ['Seraphim', 117649],
                ['Asmodeus', 16807],
                ['Cherubim', 16807],
                ['Lucky number', 77777]
            ]
        },
        {
            chips: 32900000,
            upgrades: [
                ['Unshackled cursors', 15000000],
                ['Unshackled flavor', 10000000],
                ['Label printer', 5000000],
                ['Genius accounting', 2000000],
                ['Inspired checklist', 900000]
            ]
        },
        {
            chips: 210266660,
            upgrades: [
                ['Starlove', 111111],
                ['Starsnow', 111111],
                ['Starspawn', 111111],
                ['Startrade', 111111],
                ['Starterror', 111111],
                ['Wrinkly cookies', 6666666],
                ['Elder spice', 444444],
                ['Sacrilegious corruption', 444444],
                ['Unholy bait', 44444],
                ['Permanent upgrade slot III', 3000000],
                ['Five-finger discount', 555555],
                ['Golden cookie alert sound', 999999],
                ['Wrapping paper', 999999],
                ['Distilled essence of redoubled luck', 7777777],
                ['Lucky payout', 77777777],
                ['Stevia Caelestis', 100000000],
                ['Fanciful dairy selection', 1000000],
                ['Distinguished wallpaper assortment', 10000000]
            ]
        },
        {
            chips: 1600000000,
            upgrades: [
                ['Sugar crystal cookies', 1000000000],
                ['Sugar baking', 200000000],
                ['Permanent upgrade slot IV', 400000000]
            ]
        },
        {
            chips: 6838860718,
            upgrades: [
                ['Unshackled grandmas', 1920000000],
                ['Unshackled berrylium', 1810193360],
                ['Sugar aging process', 600000000],
                ['Sugar craving', 400000000],
                ['Diabetica Daemonicus', 300000000],
                ['Aura gloves', 555555555],
                ['Keepsakes', 1111111111],
                ['Eye of the wrinkler', 99999999],
                ['Chimera', 40353607],
                ['Lucifer', 823543],
                ['God', 823543]
            ]
        },
        {
            chips: 34999999984,
            upgrades: [
                ['Cat ladies', 9000000000],
                ['Kitten wages', 9000000000],
                ['Reinforced membrane', 14999999985],
                ['Shimmering veil', 999999999],
                ['Sucralosia Inutilis', 1000000000]
            ]
        },
        {
            chips: 227777777776,
            upgrades: [
                ['Fortune cookies', 77777777777],
                ['Permanent upgrade slot V', 50000000000],
                ['Pet the dragon', 99999999999]
            ]
        },
        {
            chips: 1379559951147,
            upgrades: [
                ['Box of pastries', 333000000000],
                ['Box of maybe cookies', 333000000000],
                ['Box of not cookies', 333000000000],
                ['Unshackled chalcedhoney', 327680000000],
                ['Unshackled blueberrylium', 37879951162],
                ["Cosmic beginner's luck", 14999999985]
            ]
        },
        {
            chips: 9809487269319,
            upgrades: [
                ['Unshackled sugarmuck', 6857003606358],
                ['Unshackled buttergold', 1746928107422],
                ['Luminous gloves', 55555555555],
                ['Milkhelp lactose intolerance relief tablets', 900000000000],
                ['Delicate touch', 149999999985],
                ['Sound test', 99999999999]
            ]
        },
        {
            chips: 39791524719681,
            upgrades: [
                ['Unshackled jetmint', 21788899719681],
                ['Unshackled farms', 32805000000],
                ['Unshackled mines', 245760000000],
                ['Unshackled factories', 1171875000000],
                ['Unshackled banks', 4199040000000],
                ['Unshackled temples', 12353145000000]
            ]
        },
        {
            chips: 202805486015158,
            upgrades: [
                ['Unshackled hazelrald', 143489070000000],
                ['Unshackled cherrysilver', 59316416015158]
            ]
        },
        {
            chips: 977594110341772,
            upgrades: [
                ['Unshackled mooncandy', 316277766016838],
                ['Unshackled astrofudge', 646316344324949],
                ['Steadfast murmur', 14999999999985]
            ]
        },
        {
            chips: 3.5036801946893e15,
            upgrades: [
                ['Unshackled alabascream', 1241250239661059],
                ['Unshackled iridyum', 2262429955028239]
            ]
        },
        {
            chips: 1.41390514390732e16,
            upgrades: [
                ['Unshackled glucosmium', 3944212159073245],
                ['Unshackled wizard towers', 31457280000000],
                ['Unshackled shipments', 71744535000000],
                ['Unshackled alchemy labs', 150000000000000],
                ['Unshackled portals', 292307565000000],
                ['Unshackled time machines', 537477120000000],
                ['Unshackled antimatter condensers', 941227755000000],
                ['Unshackled prisms', 1581202560000000],
                ['Unshackled chancemakers', 2562890625000000],
                ['Unshackled fractal engines', 4026531840000000]
            ]
        },
        {
            chips: 1.27724352341841e16,
            upgrades: [
                ['Unshackled glimmeringue', 6617355139184079],
                ['Unshackled javascript consoles', 6155080095000001]
            ]
        },
        {
            chips: 2.2591376565e16,
            upgrades: [
                ['Unshackled idleverses', 9183300480000000],
                ['Unshackled cortex bakers', 13408076085000000]
            ]
        },
        {
            chips: 2.07e16,
            upgrades: [
                ['Unshackled you', 19200000000000000],
                ['Glittering edge', 1499999999999985]
            ]
        }
    ]

    //* ORDER
    // Every upgrade in the plan, flattened, in the order the guide buys them. This
    // is the shopping list on the ascend screen.
    //
    // It is deliberately flat rather than per-ascension. The guide's own advice for
    // overshooting a target is to carry on into the next ascension's list, and the
    // heavenly tree gates several upgrades behind parents from earlier entries, so
    // the only order that is always correct is "the earliest thing on the list that
    // is affordable and not locked". Keeping the whole plan in one sequence makes
    // that a lookup rather than a special case.
    const ORDER = []
    const COST = {}
    for (const step of PLAN) {
        for (const [name, cost] of step.upgrades) {
            const key = normalise(name)
            if (ORDER.indexOf(key) === -1) ORDER.push(key)
            COST[key] = cost
        }
    }

    //* priority
    // where an upgrade sits on the shopping list. Infinity means it is not on the
    // plan at all, which is the same as "never buy it": chips spent off-plan are
    // chips the next tier's centrepiece does not get.
    function priority(name) {
        const i = ORDER.indexOf(normalise(name))
        return i === -1 ? Infinity : i
    }

    //* normalise
    // The ascend screen renders an upgrade's display name, which differs from the
    // guide's capitalisation in ways that are not worth encoding twice. Compare on
    // a trimmed, case-folded, whitespace-collapsed form.
    //
    // The registered trademark on Milkhelp is stripped for the same reason: it is
    // in the game's name and in nobody's notes.
    function normalise(name) {
        return String(name || '')
            .replace(/[®™]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
    }

    //* PERMANENT_PICKS
    // What to put in a permanent upgrade slot, best first. A permanent slot keeps
    // one upgrade across ascensions, so it is worth the strongest thing that would
    // otherwise have to be re-earned every run.
    //
    // Kittens top the list because they scale with milk, milk scales with
    // achievements, and achievements are the one thing ascension never takes away:
    // a kitten is therefore worth strictly more in every future run than it was in
    // this one. Below them are the click multipliers, which a run cannot buy early.
    const PERMANENT_PICKS = [
        'Kitten angels',
        'Kitten specialists',
        'Kitten experts',
        'Kitten managers',
        'Kitten accountants',
        'Kitten assistants to the regional manager',
        'Kitten marketeers',
        'Kitten analysts',
        'Kitten engineers',
        'Kitten overseers',
        'Kitten helpers',
        'Kitten workers',
        'Heavenly key',
        'Lucky day',
        'Serendipity',
        'Get lucky',
        'Plastic mouse',
        'Iron mouse',
        'Titanium mouse',
        'Adamantium mouse'
    ].map(normalise)

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.data = window.Alakazam.data || {}
    window.Alakazam.data.heavenly = { PLAN, ORDER, COST, PERMANENT_PICKS, priority, normalise }
})()
