// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Krumblor
    // Trains the dragon, keeps the best aura in it, and pets it for drops.
    //
    //! Everything here is paid for again every run
    // Game.Reset zeroes the dragon's level and both auras on every ascension, not
    // only on a hard reset. So this is not a one-time setup that can be done and
    // forgotten: the ladder is climbed again from the egg after every ascension, and
    // the module has to work out where it is rather than remember.
    //
    //! Why it is willing to sacrifice buildings
    // Each rung past the egg gives up a hundred of one building, in store order, and
    // the prize at the top of the fourteenth rung is Radiant Appetite, which doubles
    // all production for the rest of the run. Nothing else in the game is worth that
    // much for so little, and the buildings come back: sacrificing lowers the price
    // of the ones that are gone, and the drain loop rebuys them within seconds. It
    // does not touch cookiesEarned either, so prestige is untouched.
    //
    // So it climbs as fast as the game will let it, and stops for very little: see
    // `waiting` for the short list of things worth stopping for, and for the two that
    // used to be on it and cost most of a run between them.
    //
    //! And it has to hold the autoclicker still
    // The dragon's tab is on a canvas and the game only accepts the click if the
    // last thing clicked was that canvas. The autoclicker rewrites that every
    // sixty-sixth of a second, so the scheduler is paused for the second or so a
    // panel visit takes. See act/dragon.js for the rest of that story.

    const { act, save, live, store, catalog, income, scheduler, registry } = window.Alakazam
    const { levelFor, trainedAuras, nameOf, dropWindow, DROPS, DROP_WINDOWS } =
        window.Alakazam.data.dragon
    const { MAX_LEVEL, SECOND_SLOT_LEVEL, DROP_MIN_LEVEL } = window.Alakazam.data.dragon

    const INTERVAL_MS = 2000

    // one panel visit at a time, with a beat between them
    const ACTION_MS = 750

    // how many rungs one visit will climb before letting go. The panel is already
    // open and each rung is a click, so stopping after one meant a tick and a
    // cooldown for every rung of a ladder that is twenty seven rungs long.
    const RUNGS_PER_VISIT = 10

    // an aura change sacrifices a building, so it is not something to do twice in a
    // row over a number that wobbled
    const SWITCH_COOLDOWN_MS = 10 * 60 * 1000

    // and it has to be worth this much more than what is already equipped
    const SWITCH_MARGIN = 0.02

    // A panel that will not open means one of two things, and they want opposite
    // responses. Either the egg is not bought, which takes a while to change and is
    // worth backing right off for, or a single click went astray, which is worth
    // retrying at once. They are not distinguishable from here, so they are told
    // apart by persistence: a few quick retries first, and only then the long wait.
    //
    // Getting this wrong was expensive. One missed click used to mean ten minutes of
    // sitting still, which looks exactly like being broken.
    const RETRY_MS = 5000
    const RECHECK_MS = 5 * 60 * 1000
    const MISSES_BEFORE_BACKOFF = 3

    // pets per visit, and how often a visit is made just to pet
    const PETS_PER_VISIT = 8
    const PET_VISIT_MS = 2 * 60 * 1000

    // the comparison table, on a timer as well as on a change, so a long run leaves
    // a trail that can be read afterwards
    const LOG_MS = 10 * 60 * 1000

    // the game has twenty buildings, and the last two rungs want some of every one
    const BUILDING_COUNT = 20

    let lastActionAt = 0
    let lastSwitchAt = 0
    let missingAt = 0
    let misses = 0
    let lastPetAt = 0
    let lastLogAt = 0
    let lastLogged = ''

    // learned within a run: which of the four quarter-hour windows produced which
    // drop. The shuffle behind it is seeded from the run's own seed, so it is worth
    // nothing after an ascension and is thrown away with the rest of the run state.
    let dropWindows = {}
    let dropsSeen = []
    let runKey = ''

    function debug() {
        return window.__alakazam || {}
    }

    //! Reading where the dragon is

    function dragonState() {
        if (!save.trusted()) return null
        const scalars = save.get().scalars
        if (!scalars || !Number.isFinite(scalars.dragonLevel)) return null
        const level = scalars.dragonLevel
        return {
            level,
            aura: scalars.dragonAura || 0,
            aura2: scalars.dragonAura2 || 0,
            slot2: level >= SECOND_SLOT_LEVEL,
            trained: trainedAuras(level),
            step: levelFor(level)
        }
    }

    //* affordable
    // whether the next rung can be paid for, worked out from the save and the store
    // faces rather than by opening the panel. Getting this wrong costs nothing: the
    // game greys its own button out and act/dragon.js refuses to click it.
    function affordable(step) {
        if (!step || step.kind === 'none') return false
        if (step.kind === 'cookies') return live.readGlobals().cookies >= step.amount
        if (step.kind === 'building') return owned(step.building) >= step.amount
        // 50 or 200 of every building there is
        for (let i = 0; i < BUILDING_COUNT; i++) {
            if (owned(i) < step.amount) return false
        }
        return true
    }

    //* owned
    // how many of a building there are, from the store face first and the save only
    // as a fallback.
    //
    // That is the opposite of the usual order here, and it is the difference between
    // training taking a couple of minutes and taking most of an hour. The save is
    // written on autosave, up to a minute behind, so reading building counts from it
    // means the hundredth cursor is bought and the dragon does not notice for another
    // minute. Fourteen rungs of that is a quarter of an hour of standing still while
    // the buildings are sitting right there on screen, which is exactly what it felt
    // like. The count on the product face is exact and immediate.
    function owned(index) {
        const product = live.readProducts().find(p => p.index === index)
        if (product && Number.isFinite(product.owned)) return product.owned
        const record = save.building(index)
        return record && Number.isFinite(record.amount) ? record.amount : 0
    }

    //! Scoring inputs

    //* scoringState
    // everything the aura scorer prices against. The measurements and the shares of
    // production are measure/income.js's job, since the pantheon scorer wants exactly
    // the same ones; what is added here is the dragon's own position and the one
    // number only this module can work out, what Supreme Intellect would be worth.
    function scoringState(dragon) {
        const measured = income.stats()
        const cps = measured.cps || live.readGlobals().cps || 0
        return {
            ...income.shares(),
            level: dragon.level,
            slot2: dragon.slot2,
            cps,
            clickCps: measured.clickCps || 0,
            goldenCps: measured.goldenCps || 0,
            buffBonusCps: Math.max(0, cps - (measured.baseCps || cps)),
            buffMult: measured.buffMult || 1,
            buffedShare: measured.buffedShare || 0,
            goldensOnScreen: measured.goldensOnScreen || 0,
            // the grimoire's own output is not measured, so Supreme Intellect is
            // valued on the pantheon promotion alone and understates itself
            grimoireCps: 0,
            pantheonGain: pantheonPromotionGain(),
            measured: measured.measured
        }
    }

    //* pantheonPromotionGain
    // what Supreme Intellect is worth in the temple: it promotes every slot, so the
    // same three spirits give more. Asked of the pantheon's own scorer rather than
    // guessed at here.
    function pantheonPromotionGain() {
        const strategy = window.Alakazam.strategy.pantheon
        const pantheon = window.Alakazam.pantheon
        if (!strategy || !pantheon || !store.moduleEnabled('pantheon')) return 0
        const s = pantheon.scoringState ? pantheon.scoringState() : null
        if (!s) return 0
        const plain = strategy.best({ ...s, promoted: false })
        const promoted = strategy.best({ ...s, promoted: true })
        return Math.max(0, promoted.gain - plain.gain)
    }

    //! What to do

    function wantsAura(dragon, choice, inputs) {
        if (!choice.table.length) return false
        if (Date.now() - lastSwitchAt < SWITCH_COOLDOWN_MS) return false

        const total = Math.max(1, inputs.cps + inputs.clickCps)
        const gainOf = id => {
            const row = choice.table.find(r => r.aura === id)
            return row ? row.gain : 0
        }
        const wanted = gainOf(choice.primary) + (dragon.slot2 ? gainOf(choice.secondary) : 0)
        const have = gainOf(dragon.aura) + (dragon.slot2 ? gainOf(dragon.aura2) : 0)
        if (choice.primary === dragon.aura && (!dragon.slot2 || choice.secondary === dragon.aura2)) {
            return false
        }
        return wanted - have > SWITCH_MARGIN * total
    }

    //* wantsPet
    // Which drop a pet can produce depends on the quarter of the hour, from a shuffle
    // fixed per run, so pets inside a window whose drop is already held are wasted.
    // The mapping cannot be read anywhere, so it is learned: whatever turns up while
    // petting belongs to the window it turned up in.
    function wantsPet(dragon) {
        if (dragon.level < DROP_MIN_LEVEL) return false
        if (dropsSeen.length >= DROPS.length) return false
        const window_ = dropWindow()
        const known = dropWindows[window_]
        if (known && dropsSeen.indexOf(known) !== -1) return false
        return Date.now() - lastPetAt > PET_VISIT_MS
    }

    //* noteDrops
    // the drops are ordinary upgrades once unlocked, so the catalog sees them by
    // name. Anything new is credited to the window we were petting in.
    function noteDrops(window_) {
        for (const name of catalog.names()) {
            if (DROPS.indexOf(name) === -1) continue
            if (dropsSeen.indexOf(name) !== -1) continue
            dropsSeen.push(name)
            dropWindows[window_] = name
            console.log(`Alakazam: the dragon dropped ${name} in petting window ${window_}`)
        }
    }

    //! The panel visit

    async function withPanel(work) {
        // if everything is already paused then this module is not ticking either, so
        // an unpause here could only ever be against the player's wishes
        if (scheduler.isPaused()) return
        scheduler.pause()
        try {
            const opened = await act.dragon.open()
            if (!opened) {
                misses++
                missingAt = Date.now()
                return
            }
            misses = 0
            missingAt = 0
            await work()
            await act.dragon.close()
        } finally {
            scheduler.resume()
        }
    }

    //* waiting
    // why this is not acting, or the empty string when it is.
    //
    // Two things used to be on this list and are not any more, because between them
    // they were most of a run.
    //
    // A production buff was one. Training sacrifices a hundred of one building tier
    // and the drain loop buys them back within seconds, so the cost of doing it under
    // a frenzy is a few multiplied seconds of one tier. The cost of waiting for a
    // quiet moment, on a save that clicks every golden cookie and is therefore buffed
    // a good share of the time, was measured in rungs not taken. Radiant Appetite
    // doubles production for the rest of the run: nothing on this ladder is worth
    // delaying for a tidier moment to climb it.
    //
    // The post-ascension buy-all sweep was the other, and it was worse: it blocked
    // the first five minutes of every run, which is precisely when the cookie rungs
    // become affordable on a mature save.
    function waiting(dragon) {
        // a golden cookie is worth more than any rung, and a panel visit holds the
        // clicker still for a moment. This one costs nothing: shimmers are clicked
        // within milliseconds and the next tick is two seconds away.
        if (live.readShimmers().length > 0) return 'a golden cookie is on screen'
        const d = debug()
        // the end of a run is loans on a forty second timer and a prompt to confirm.
        // Opening menus in the middle of that is the one genuinely risky moment.
        if (d.ascend && d.ascend.phase && d.ascend.phase !== 'watching') return 'a run is ending'
        if (dragon.level === 0 && !affordable(dragon.step)) return 'waiting for the first million'
        return ''
    }

    async function tick() {
        const dragon = dragonState()
        if (!dragon) return

        // a new run has a new seed, so what was learned about petting windows is
        // worth nothing
        const key = debug().identity ? debug().identity.runId : ''
        if (key !== runKey) {
            runKey = key
            dropWindows = {}
            dropsSeen = []
        }

        const inputs = scoringState(dragon)
        const choice = window.Alakazam.strategy.dragon.chooseAuras(inputs)
        publish(dragon, choice)
        logOccasionally(dragon, choice)

        if (waiting(dragon)) return
        if (Date.now() - lastActionAt < ACTION_MS) return
        // a few quick retries after a missed click, then the long back off
        const quiet = misses < MISSES_BEFORE_BACKOFF ? RETRY_MS : RECHECK_MS
        if (missingAt && Date.now() - missingAt < quiet) return

        const canTrain = dragon.level < MAX_LEVEL && affordable(dragon.step)
        const canSwitch = wantsAura(dragon, choice, inputs)
        const canPet = wantsPet(dragon)
        if (!canTrain && !canSwitch && !canPet) return

        lastActionAt = Date.now()
        await withPanel(async () => {
            if (canTrain) climb(dragon)
            if (canSwitch) await switchAuras(dragon, choice)
            if (canPet) await petting()
        })
    }

    //* climb
    // as far up the ladder as the game will let us in one visit. Each rung redraws
    // the panel, so the next one is read back off it rather than worked out here, and
    // the greyed out cost is the game's own answer to whether it can be paid.
    //
    // Doing one rung per visit was the difference between a dragon that grows while
    // you watch and one that takes a tick, a cooldown and a fresh panel for every
    // hundred cursors it eats.
    function climb(dragon) {
        let climbed = 0
        while (climbed < RUNGS_PER_VISIT) {
            const step = act.dragon.nextStep()
            if (!step || !step.affordable) break
            if (!act.dragon.train()) break
            climbed++
            // a golden cookie that appeared mid-climb is worth more than the rest of
            // the ladder, and the ladder will still be there in two seconds
            if (live.readShimmers().length > 0) break
        }
        if (climbed > 0) {
            console.log(`Alakazam: trained the dragon ${climbed} time(s) from ${describe(dragon)}`)
        }
    }

    async function switchAuras(dragon, choice) {
        lastSwitchAt = Date.now()
        if (choice.primary !== dragon.aura) {
            const ok = await act.dragon.setAura(choice.primary, 0)
            if (ok) console.log(`Alakazam: dragon aura ${nameOf(choice.primary)}. ${choice.why}`)
            return
        }
        if (dragon.slot2 && choice.secondary !== dragon.aura2) {
            const ok = await act.dragon.setAura(choice.secondary, 1)
            if (ok) console.log(`Alakazam: second dragon aura ${nameOf(choice.secondary)}`)
        }
    }

    async function petting() {
        const window_ = dropWindow()
        lastPetAt = Date.now()
        for (let i = 0; i < PETS_PER_VISIT; i++) act.dragon.pet()
        noteDrops(window_)
    }

    function describe(dragon) {
        const step = dragon.step
        if (!step || step.kind === 'none') return 'fully trained'
        if (step.kind === 'cookies') return `level ${dragon.level}, ${step.amount} cookies`
        if (step.kind === 'building') return `level ${dragon.level}, 100 of building ${step.building}`
        return `level ${dragon.level}, ${step.amount} of every building`
    }

    //! Reporting

    function publish(dragon, choice) {
        window.__alakazam.dragon = {
            level: dragon.level,
            max: MAX_LEVEL,
            aura: nameOf(dragon.aura),
            aura2: dragon.slot2 ? nameOf(dragon.aura2) : null,
            wanted: nameOf(choice.primary),
            wanted2: dragon.slot2 ? nameOf(choice.secondary) : null,
            why: choice.why,
            next: describe(dragon),
            waiting: waiting(dragon),
            drops: dropsSeen.length,
            table: choice.table
        }
    }

    //* logOccasionally
    // the whole comparison, on the console, when the answer changes and on a timer
    // otherwise. The inputs are printed with it: a table is only worth reading
    // against the numbers it was computed from, and half of those are measurements
    // that take a few minutes to settle.
    function logOccasionally(dragon, choice) {
        const now = Date.now()
        const signature = `${choice.primary}/${choice.secondary}/${dragon.level}`
        if (signature === lastLogged && now - lastLogAt < LOG_MS) return
        lastLogged = signature
        lastLogAt = now
        explain(dragon, choice)
    }

    //* explain
    // also callable by hand: window.Alakazam.dragon.explain()
    function explain(dragon, choice) {
        const d = dragon || dragonState()
        if (!d) {
            console.log('Alakazam dragon: no readable dragon in this save')
            return null
        }
        const inputs = scoringState(d)
        const c = choice || window.Alakazam.strategy.dragon.chooseAuras(inputs)
        console.log('Alakazam dragon auras:', {
            level: `${d.level}/${MAX_LEVEL}`,
            equipped: d.slot2 ? `${nameOf(d.aura)} + ${nameOf(d.aura2)}` : nameOf(d.aura),
            wanted: d.slot2 ? `${nameOf(c.primary)} + ${nameOf(c.secondary)}` : nameOf(c.primary),
            cps: inputs.cps,
            clickCps: inputs.clickCps,
            goldenCps: inputs.goldenCps,
            goldensOnScreen: inputs.goldensOnScreen,
            grandmaShare: inputs.grandmaShare,
            prestigeShare: inputs.prestigeShare,
            settled: inputs.measured
        })
        console.log(
            c.table.map(row => ({
                aura: row.name,
                score: Math.round(row.score * 1000) / 1000,
                gain: row.gain,
                assumed: row.assumed,
                why: row.why
            }))
        )
        return c
    }

    registry.register({ name: 'dragon', interval: INTERVAL_MS, tick })

    window.Alakazam.dragon = { dragonState, scoringState, affordable, explain }
})()
