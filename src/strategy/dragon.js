// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Which Aura
    // Pure arithmetic, no DOM, no state: hand it what has been measured and it ranks
    // every aura the dragon knows. It exists because the received wisdom about auras
    // was written for someone playing by hand, and three of the most recommended ones
    // are worth far less to Alakazam than to that player:
    //
    //   Dragon's Fortune pays per golden cookie *on screen*, and golden cookies are
    //   clicked here within milliseconds of appearing, so there is almost never one
    //   on screen to be paid for. The aura most guides put second is close to inert.
    //
    //   Dragonflight multiplies click power by 1111 for ten seconds. The game
    //   registers about three clicks a second however many are dispatched, so those
    //   ten seconds are thirty clicks, not the hundreds a human comboer gets.
    //
    //   Dragon Cursor adds 5% to clicking, and clicking is a small share of income
    //   for the same reason.
    //
    // Radiant Appetite doubles production and does not care how the game is played,
    // which is why it wins here, and why it is worth being able to show that with
    // numbers rather than asserting it. Every candidate returns the terms behind its
    // score so modules/dragon.js can print the whole table.
    //
    //! Units
    // Every gain is in cookies per second, compared against measured income, so the
    // score is a multiplier on income and any two candidates are comparable. Where a
    // term cannot be measured it is either assumed from a named constant, and said
    // so, or scored at zero. Nothing is guessed silently.

    const { AURAS, auraById, trainedAuras } = window.Alakazam.data.dragon

    // Elder Battalion counts building types other than grandmas, and there are
    // twenty buildings in the game
    const BUILDING_TYPES = 20

    // What share of production comes from kittens. The game does not render the milk
    // multiplier anywhere, so this is a stated assumption rather than a measurement,
    // and Breath of Milk's score is flagged as assumed because of it.
    const KITTEN_SHARE = 0.15

    // How often a golden cookie rolls Dragon Harvest or Dragonflight once the aura
    // that offers it is equipped. The aura puts the outcome in the pool rather than
    // forcing it, and the pool works out at about a fifth.
    const ROLL_CHANCE = 0.1925

    // How long a Dragonflight lasts. Its multiplier, like Dragon Harvest's, is the
    // aura's own `amount` in data/dragon.js rather than a second copy here.
    const FLIGHT_SECONDS = 10

    // How long a golden cookie buff runs, used only to turn the measured share of
    // time spent buffed into a rate of golden cookies. A stated assumption.
    const BUFF_SECONDS = 45

    //* gainOf
    // what one aura would add to income, in cookies per second, plus a sentence
    // saying where the number came from. `others` is every other trained aura, which
    // only Reality Bending needs.
    function gainOf(aura, state, others) {
        const cps = state.cps || 0
        const clickCps = state.clickCps || 0
        const goldenCps = state.goldenCps || 0
        const buffBonusCps = state.buffBonusCps || 0
        const amount = aura.amount || 0

        switch (aura.kind) {
            case 'production':
                // doubles production. Click power partly follows CpS through the
                // mouse upgrades, so this understates itself: fine, an understated
                // favourite can only ever lose a comparison it deserved to lose.
                return { gain: amount * cps, why: 'doubles measured production' }

            case 'click':
                return {
                    gain: amount * clickCps,
                    why: `${pct(amount)} of ${round(clickCps)} click income`
                }

            case 'grandmas': {
                const types = state.otherBuildingTypes || BUILDING_TYPES - 1
                const share = state.grandmaShare || 0
                return {
                    gain: amount * types * share * cps,
                    why: `${pct(amount * types)} of the ${pct(share)} of production that is grandmas`
                }
            }

            case 'goldenRate':
                return {
                    gain: amount * goldenCps,
                    why: `${pct(amount)} more golden cookies, worth ${round(goldenCps)}/s`
                }

            case 'goldenGain':
                return { gain: amount * goldenCps, why: `${pct(amount)} of golden cookie income` }

            case 'goldenDuration':
                return {
                    gain: amount * buffBonusCps,
                    why: `${pct(amount)} longer buffs, worth ${round(buffBonusCps)}/s`
                }

            case 'harvestRoll': {
                const mult = Math.max(1, state.buffMult || 1)
                const gain = goldenCps * ROLL_CHANCE * Math.max(0, amount / mult - 1)
                return {
                    gain,
                    why: `${pct(ROLL_CHANCE)} of goldens become x${amount} instead of x${round(mult)}`
                }
            }

            case 'flightRoll': {
                const rate = (state.buffedShare || 0) / BUFF_SECONDS
                const perFlight = clickCps * (amount - 1) * FLIGHT_SECONDS
                const gain = ROLL_CHANCE * (rate * perFlight - goldenCps)
                return {
                    gain,
                    why: `${FLIGHT_SECONDS}s of x${amount} clicking at ${round(clickCps)}/s, instead of a buff`
                }
            }

            case 'perGolden': {
                const onScreen = state.goldensOnScreen || 0
                return {
                    gain: amount * onScreen * cps,
                    why: `${round(onScreen, 3)} goldens on screen on average: they are clicked at once`
                }
            }

            case 'buildingCost':
            case 'upgradeCost':
                return {
                    gain: amount * cps,
                    why: `${pct(amount)} cheaper, and nearly all income is spent`
                }

            case 'prestige': {
                const share = state.prestigeShare || 0
                return {
                    gain: amount * share * cps,
                    why: `${pct(amount)} of the ${pct(share)} of production that is prestige`
                }
            }

            case 'milk':
                return {
                    gain: amount * KITTEN_SHARE * cps,
                    why: `${pct(amount)} of an assumed ${pct(KITTEN_SHARE)} kitten share`,
                    assumed: true
                }

            case 'minigames': {
                const pantheon = state.pantheonGain || 0
                const spells = 0.11 * (state.grimoireCps || 0)
                return {
                    gain: pantheon + spells,
                    why: 'promotes every pantheon slot; spells 10% cheaper and 10% likelier to backfire'
                }
            }

            case 'wrinklers': {
                const wrinklerCps = state.wrinklerCps || 0
                return {
                    gain: amount * wrinklerCps,
                    why: wrinklerCps
                        ? `${pct(amount)} of ${round(wrinklerCps)}/s accruing in wrinklers`
                        : 'nothing is harvesting wrinklers'
                }
            }

            case 'sellback':
                return { gain: 0, why: 'only pays when buildings are sold, and nothing sells them' }

            case 'orbs':
                return {
                    gain: 0,
                    why: 'needs a sale with no buff and no golden up, which never happens'
                }

            case 'lumps':
                return { gain: 0, why: 'faster lumps, which are not income' }

            case 'drops':
                return { gain: 0, why: 'more upgrade drops, too rare to price' }

            case 'wrathGain':
                return { gain: 0, why: 'wrath cookies need the grandmapocalypse, which is off' }

            case 'combined': {
                let total = 0
                for (const other of others) {
                    if (other.kind === 'combined') continue
                    total += gainOf(other, state, others).gain
                }
                return {
                    gain: amount * total,
                    why: `a tenth of the ${others.length - 1} other auras, combined`
                }
            }

            default:
                return { gain: 0, why: 'no effect' }
        }
    }

    function pct(n) {
        return `${Math.round(n * 1000) / 10}%`
    }

    function round(n, digits) {
        const p = Math.pow(10, digits || 0)
        return Math.round(n * p) / p
    }

    //* scoreAuras
    // every aura the dragon knows, best first. `score` is the multiplier on income,
    // so 1 is "changes nothing" and 2 is "doubles the run".
    function scoreAuras(state) {
        const trained = trainedAuras(state.level || 0)
            .map(auraById)
            .filter(a => a && a.kind !== 'none')
        const income = Math.max(1, (state.cps || 0) + (state.clickCps || 0))

        return trained
            .map(aura => {
                const others = trained.filter(a => a.id !== aura.id)
                const { gain, why, assumed } = gainOf(aura, state, others)
                return {
                    aura: aura.id,
                    name: aura.name,
                    gain,
                    score: 1 + gain / income,
                    assumed: !!assumed,
                    why
                }
            })
            .sort((a, b) => b.gain - a.gain)
    }

    //* chooseAuras
    // the best aura, and the best of the rest for the second slot once a fully
    // trained dragon has one. The game refuses to put the same aura in both, and
    // taking the two best separately is the same answer as scoring every pair unless
    // two auras overlap, which only Reality Bending does: it is worth a tenth of the
    // others whichever slot it sits in.
    function chooseAuras(state) {
        const table = scoreAuras(state)
        const best = table[0] || null
        const second = state.slot2 ? table[1] || null : null

        return {
            primary: best ? best.aura : 0,
            secondary: second ? second.aura : 0,
            why: best ? `${best.name}: ${best.why}` : 'the dragon knows no auras yet',
            table
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.strategy = window.Alakazam.strategy || {}
    window.Alakazam.strategy.dragon = { scoreAuras, chooseAuras, AURAS, KITTEN_SHARE }
})()
