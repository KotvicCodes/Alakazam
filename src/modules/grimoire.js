// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Grimoire
    // The wizard tower minigame. Magic regenerates on its own and is spent on
    // spells; the one that matters is Force the Hand of Fate, which conjures a
    // golden cookie on demand and is how combos are started at will.
    //
    // The formulas below are taken from the game's own minigameGrimoire.js rather
    // than from the wiki, which states them differently:
    //
    //   magicM  = floor(4 + towers^0.6 + log((towers + (level-1)*10)/15 + 1) * 15)
    //   magicPS = max(0.002, sqrt(magic / max(magicM, 100))) * 0.002   per frame
    //   cost    = floor(costMin + magicM * costPercent)
    //
    // Two consequences worth knowing, both of which fall straight out of the
    // regeneration curve and are surfaced as advice rather than acted on:
    //
    //   - Refill time grows with max magic, while Force the Hand of Fate does the
    //     same thing however much magic you have. So wizard towers bought for
    //     production actively slow down how often you can cast it.
    //   - Regeneration is proportional to the square root of how full you are, so
    //     magic accumulates fastest when the bar is already high. Spending down to
    //     empty is the slowest possible way to run the minigame.

    const { simulateClick } = window.Alakazam.input
    const { parseGameNumber } = window.Alakazam.parse
    const { live, save, store, registry } = window.Alakazam

    const INTERVAL_MS = 2000
    const FPS = 30

    //* Spells
    // id order is positional in the game's spell list, and the id is what the
    // button element is named after
    const SPELLS = [
        { id: 0, name: 'Conjure Baked Goods', costMin: 2, costPercent: 0.4 },
        { id: 1, name: 'Force the Hand of Fate', costMin: 10, costPercent: 0.6 },
        { id: 2, name: 'Stretch Time', costMin: 8, costPercent: 0.2 },
        { id: 3, name: 'Spontaneous Edifice', costMin: 20, costPercent: 0.75 },
        { id: 4, name: "Haggler's Charm", costMin: 10, costPercent: 0.1 },
        { id: 5, name: 'Summon Crafty Pixies', costMin: 10, costPercent: 0.2 },
        { id: 6, name: "Gambler's Fever Dream", costMin: 3, costPercent: 0.05 },
        { id: 7, name: 'Resurrect Abomination', costMin: 20, costPercent: 0.1 },
        { id: 8, name: 'Diminish Ineptitude', costMin: 5, costPercent: 0.2 }
    ]

    const FTHOF = SPELLS[1]
    const CONJURE = SPELLS[0]

    // casting drops the bar a long way, and regeneration is slowest when the bar
    // is low, so idle spending only happens while comfortably full
    const IDLE_CAST_FRACTION = 0.95

    // the dragon aura that makes spells cheaper and backfires likelier, and by how
    // much either way
    const SUPREME_INTELLECT = 20
    const SPELL_DISCOUNT = 0.1

    let lastCastAt = 0

    //! Formulas

    //* maxMagic
    // capacity from the wizard tower count and its sugar lump level
    function maxMagic(towers, level) {
        const t = Math.max(towers, 1)
        const l = Math.max(level, 1)
        return Math.floor(4 + Math.pow(t, 0.6) + Math.log((t + (l - 1) * 10) / 15 + 1) * 15)
    }

    //* spellCost
    // Supreme Intellect makes every spell a tenth cheaper, and it also makes them a
    // tenth likelier to backfire. This used to say the aura was not readable and
    // charge the full price, which was true of the DOM and never true of the save:
    // dragonAura and dragonAura2 have been parsed all along. Overestimating the cost
    // only ever meant casting later than the magic allowed, which is a small, silent
    // loss on every cast of the run.
    function spellCost(spell, magicM, discount) {
        const cost = spell.costMin + magicM * spell.costPercent
        return Math.floor(cost * (1 - (discount || 0)))
    }

    //* supremeIntellect
    // the discount the dragon is currently granting on spells, and how much likelier
    // a cast is to backfire because of it
    function supremeIntellect() {
        const scalars = (save.get() || {}).scalars || {}
        const on = scalars.dragonAura === SUPREME_INTELLECT || scalars.dragonAura2 === SUPREME_INTELLECT
        return { on, discount: on ? SPELL_DISCOUNT : 0, backfire: on ? SPELL_DISCOUNT : 0 }
    }

    //* regenPerSecond
    // the game's per-frame regeneration, scaled to seconds
    function regenPerSecond(magic, magicM) {
        return Math.max(0.002, Math.sqrt(magic / Math.max(magicM, 100))) * 0.002 * FPS
    }

    //* secondsToRefill
    // Integrating the regeneration curve. dm/dt = k*sqrt(m), so the time between
    // two magic levels is (2/k) * (sqrt(to) - sqrt(from)) with k = 0.002*fps
    // divided by sqrt(max(magicM,100)).
    function secondsToRefill(from, to, magicM) {
        if (to <= from) return 0
        const k = (0.002 * FPS) / Math.sqrt(Math.max(magicM, 100))
        return (2 * (Math.sqrt(to) - Math.sqrt(from))) / k
    }

    //! Reading the current state

    //* readBar
    // #grimoireBarText renders as "120/200 (+0.5/s)". it is live, unlike the save,
    // so it is preferred; the save's magic figure is the fallback.
    function readBar() {
        const bar = document.getElementById('grimoireBarText')
        if (!bar) return null
        const match = /([\d.,a-zA-Z ]+)\/([\d.,a-zA-Z ]+)/.exec(bar.innerText || '')
        if (!match) return null
        const magic = parseGameNumber(match[1])
        const magicM = parseGameNumber(match[2])
        if (!Number.isFinite(magic) || !Number.isFinite(magicM)) return null
        return { magic, magicM }
    }

    function state() {
        const tower = save.building(7)
        const fromSave = save.minigame('grimoire')
        const bar = readBar()

        if (!bar && !fromSave) return null

        const towers = tower ? tower.amount : 0
        const level = tower ? tower.level : 0
        const magicM = bar ? bar.magicM : maxMagic(towers, level)
        const magic = bar ? bar.magic : fromSave.magic
        const dragon = supremeIntellect()
        const fthofCost = spellCost(FTHOF, magicM, dragon.discount)

        return {
            unlocked: !!(bar || (fromSave && tower && tower.level >= 1)),
            towers,
            level,
            magic,
            magicM,
            regen: regenPerSecond(magic, magicM),
            supremeIntellect: dragon.on,
            discount: dragon.discount,
            backfireExtra: dragon.backfire,
            fthofCost,
            secondsToFthof: secondsToRefill(magic, fthofCost, magicM)
        }
    }

    //! Advice

    //* towerAdvice
    // What another wizard tower does to spell cadence. Buying towers raises
    // capacity, which raises the cost of Force the Hand of Fate faster than it
    // raises regeneration, so each one makes casting rarer. This is reported, not
    // acted on: production is usually worth more than cast frequency, and it is
    // the player's call.
    function towerAdvice(towers, level) {
        const now = cycleSeconds(towers, level)
        const more = cycleSeconds(towers + 10, level)
        return {
            towers,
            cycleSeconds: Math.round(now),
            cycleWithTenMore: Math.round(more),
            note:
                more > now
                    ? 'each wizard tower makes Force the Hand of Fate slower to recharge'
                    : 'more towers would not slow casting here'
        }
    }

    //* cycleSeconds
    // how long a full cast-and-recharge cycle takes at a given tower count: cast
    // at full, refill from what is left back to full
    function cycleSeconds(towers, level) {
        const magicM = maxMagic(towers, level)
        const cost = spellCost(FTHOF, magicM, supremeIntellect().discount)
        return secondsToRefill(Math.max(0, magicM - cost), magicM, magicM)
    }

    //! Casting

    function cast(spell, why) {
        const button = document.getElementById('grimoireSpell' + spell.id)
        if (!button) return false
        simulateClick(button)
        lastCastAt = Date.now()
        store.update('spellsCast', 0, n => n + 1)
        console.log(`Alakazam: casting ${spell.name} (${why})`)
        return true
    }

    //! Tick

    function tick() {
        const s = state()
        if (!s || !s.unlocked) return
        window.__alakazam.grimoire = s

        // never cast twice in a row without letting the bar move
        if (Date.now() - lastCastAt < 5000) return

        // the whole point of Force the Hand of Fate is starting a combo, and a
        // conjured golden cookie is worth far more stacked on a production buff
        // than used on its own
        if (live.hasProductionBuff() && s.magic >= s.fthofCost) {
            cast(FTHOF, 'production buff is up')
            return
        }

        // otherwise, only spend when the bar is essentially full: regeneration
        // scales with how full it is, so running it down is self-defeating
        const conjureCost = spellCost(CONJURE, s.magicM, s.discount)
        if (s.magic >= s.magicM * IDLE_CAST_FRACTION && s.magic >= conjureCost) {
            // hold the bar for Force the Hand of Fate if it is nearly affordable,
            // rather than spending it on cookies moments before a buff lands
            if (s.magic < s.fthofCost) cast(CONJURE, 'magic is capped and would otherwise be wasted')
        }
    }

    registry.register({ name: 'grimoire', interval: INTERVAL_MS, tick })

    window.Alakazam.grimoire = {
        state,
        maxMagic,
        spellCost,
        regenPerSecond,
        secondsToRefill,
        cycleSeconds,
        towerAdvice,
        SPELLS
    }
})()
