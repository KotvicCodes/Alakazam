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
    // What it will not do is pick a bad moment. Sacrificing during a frenzy throws
    // away multiplied output, the buy-all sweep at the start of a run is buying in
    // bulk while this would be selling, and the end of a run is no time to be
    // opening menus. All three are checked before anything is touched.
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

    const INTERVAL_MS = 5000

    // one panel visit at a time, with a beat between them
    const ACTION_MS = 3000

    // an aura change sacrifices a building, so it is not something to do twice in a
    // row over a number that wobbled
    const SWITCH_COOLDOWN_MS = 10 * 60 * 1000

    // and it has to be worth this much more than what is already equipped
    const SWITCH_MARGIN = 0.02

    // no dragon panel means the egg is not bought yet, which takes an ascension to
    // change. Nothing about that answer changes quickly.
    const RECHECK_MS = 10 * 60 * 1000

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
    // how many of a building there are. The save carries the count exactly, and the
    // product face is only a fallback for when it cannot be trusted, which is the
    // same order of preference the rest of the extension uses.
    function owned(index) {
        const record = save.building(index)
        if (record && Number.isFinite(record.amount)) return record.amount
        const product = live.readProducts().find(p => p.index === index)
        return product && Number.isFinite(product.owned) ? product.owned : 0
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
                missingAt = Date.now()
                return
            }
            await work()
            await act.dragon.close()
        } finally {
            scheduler.resume()
        }
    }

    function busy(dragon) {
        if (window.Alakazam.buffs.hasProductionBuff()) return 'a buff is running'
        if (live.readShimmers().length > 0) return 'a golden cookie is on screen'
        const d = debug()
        if (d.buyAll && d.buyAll.sweeping) return 'the store is being swept'
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

        const why = busy(dragon)
        if (why) return
        if (Date.now() - lastActionAt < ACTION_MS) return
        if (missingAt && Date.now() - missingAt < RECHECK_MS) return

        const canTrain = dragon.level < MAX_LEVEL && affordable(dragon.step)
        const canSwitch = wantsAura(dragon, choice, inputs)
        const canPet = wantsPet(dragon)
        if (!canTrain && !canSwitch && !canPet) return

        lastActionAt = Date.now()
        await withPanel(async () => {
            missingAt = 0
            if (canTrain && act.dragon.train()) {
                console.log(`Alakazam: training the dragon, ${describe(dragon)}`)
                return
            }
            if (canSwitch) {
                await switchAuras(dragon, choice)
                return
            }
            if (canPet) await petting()
        })
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
            waiting: busy(dragon),
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
