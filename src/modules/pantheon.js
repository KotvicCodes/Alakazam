// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Pantheon
    // Three slots, eleven spirits, and a swap budget that regenerates slowly:
    // three swaps banked at most, and refilling one takes an hour at best and
    // sixteen at worst. That scarcity is the whole design constraint. Getting the
    // layout right once and leaving it alone beats reacting to anything.
    //
    // So this module is deliberately reluctant. It sets the pantheon up when it is
    // empty, corrects a slot when it is clearly wrong and swaps are plentiful, and
    // otherwise does nothing at all.
    //
    //! What changed
    // What "clearly wrong" means used to be one question, "is the autoclicker on",
    // answered with one of three hand-written layouts. Both answers were wrong for
    // this bot: Muridal's clicking bonus is priced against three registered clicks a
    // second, and the idle layout's two spirits between them make golden cookies a
    // fifth rarer, which is a real cost to something that clicks every one of them.
    // Now strategy/pantheon.js prices every layout against what has been measured,
    // and this module's job is only to be reluctant about acting on it.

    const { act, save, store, income, registry } = window.Alakazam
    const { PRESETS, SLOTS, nameOf } = window.Alakazam.data.gods

    const INTERVAL_MS = 60000

    // never spend the last swap on routine tidying: it is the one that would be
    // needed if a combo or an ascension wanted a real change
    const RESERVE_SWAPS = 1

    // a drag takes a moment and the save takes a minute to catch up
    const SETTLE_MS = 90000

    // and the new layout has to be worth this much more than the one already in
    // place, or a swap that takes four hours to earn back goes on a rounding error
    const RESLOT_MARGIN = 0.03

    // the aura that promotes every slot one tier
    const SUPREME_INTELLECT = 20

    // the table, when the answer changes and on a timer otherwise
    const LOG_MS = 10 * 60 * 1000

    let lastActionAt = 0
    let lastLogged = ''
    let lastLogAt = 0

    //* scoringState
    // what the scorer prices against. Shared with modules/dragon.js, which asks for
    // it to find out what Supreme Intellect would be worth in here.
    function scoringState() {
        const measured = income.stats()
        const scalars = (save.get() || {}).scalars || {}
        const promoted =
            scalars.dragonAura === SUPREME_INTELLECT || scalars.dragonAura2 === SUPREME_INTELLECT
        return {
            ...income.shares(),
            cps: measured.cps,
            clickCps: measured.clickCps,
            goldenCps: measured.goldenCps,
            buffBonusCps: Math.max(0, measured.cps - measured.baseCps),
            buffedShare: measured.buffedShare,
            promoted,
            measured: measured.measured
        }
    }

    //* wanted
    // the layout to aim for. Until the measurements have settled, a minute of
    // samples, the idle preset stands in: it is the layout the guides would pick and
    // it is a reasonable thing to be wearing while the numbers come in.
    function wanted() {
        const inputs = scoringState()
        if (!inputs.measured) {
            const preset = PRESETS.idle
            return {
                slots: [preset.diamond, preset.ruby, preset.jade],
                gain: 0,
                why: `${preset.why} (waiting on measurements)`,
                settled: false,
                inputs
            }
        }
        const best = window.Alakazam.strategy.pantheon.best(inputs)
        return { ...best, settled: true, inputs }
    }

    function state() {
        const p = save.minigame('pantheon')
        const temple = save.building(6)
        if (!p || !temple || temple.level < 1) return null

        const target = wanted()
        const current = p.slots
        const desired = target.slots

        const wrong = []
        for (let i = 0; i < 3; i++) {
            if (current[i] !== desired[i]) wrong.push(i)
        }

        // what is already in place, scored the same way, so a swap is only spent on
        // a difference that is worth one. Until the measurements have settled there
        // is no honest difference to report, so there is none: the preset standing in
        // for a scored layout is not something to spend swaps chasing.
        const held = window.Alakazam.strategy.pantheon.score(current, target.inputs)
        const total = Math.max(1, target.inputs.cps + target.inputs.clickCps)
        const gain = target.settled ? target.gain - held.gain : 0

        return {
            unlocked: true,
            swaps: p.swaps,
            swapT: p.swapT,
            current,
            desired,
            wrong,
            why: target.why,
            settled: target.settled,
            promoted: target.inputs.promoted,
            gain,
            worthIt: gain > RESLOT_MARGIN * total
        }
    }

    //* slot
    // drag a spirit onto a slot. the spirit's handle is #templeGodDrag<id> and the
    // slots are #templeSlot0/1/2, diamond through jade.
    async function slot(godId, slotIndex) {
        const source = document.getElementById('templeGodDrag' + godId)
        const target = document.getElementById('templeSlot' + slotIndex)
        if (!source || !target) {
            console.warn('Alakazam: pantheon controls not found, leaving the temple alone')
            return false
        }
        const ok = await act.drag.dragTo(source, target)
        if (ok) {
            store.update('pantheonSwaps', 0, n => n + 1)
            console.log(`Alakazam: slotting ${nameOf(godId)} into the ${SLOTS[slotIndex]} slot`)
        }
        return ok
    }

    async function tick() {
        const s = state()
        if (!s) return
        window.__alakazam.pantheon = s
        logOccasionally(s)

        if (s.wrong.length === 0) return
        // give the last change time to show up in the save before deciding anything
        // else is wrong
        if (Date.now() - lastActionAt < SETTLE_MS) return

        // setting up an empty pantheon is what the three starting swaps are for
        if (s.current.every(god => god === -1) && s.swaps >= 3) {
            lastActionAt = Date.now()
            for (let i = 0; i < 3; i++) {
                await slot(s.desired[i], i)
            }
            return
        }

        // otherwise only correct a slot while swaps are plentiful, one at a time, and
        // only when the layout on offer is worth the swap
        if (s.swaps <= RESERVE_SWAPS) return
        if (!s.worthIt) return
        lastActionAt = Date.now()
        const fix = s.wrong[0]
        await slot(s.desired[fix], fix)
    }

    function logOccasionally(s) {
        const signature = s.desired.join('/') + (s.promoted ? '+si' : '')
        if (signature === lastLogged && Date.now() - lastLogAt < LOG_MS) return
        lastLogged = signature
        lastLogAt = Date.now()
        explain(s)
    }

    //* explain
    // the whole comparison on the console, callable by hand as
    // window.Alakazam.pantheon.explain()
    function explain(known) {
        const s = known || state()
        if (!s) {
            console.log('Alakazam pantheon: the temple is not unlocked in this save')
            return null
        }
        const inputs = scoringState()
        console.log('Alakazam pantheon layout:', {
            slotted: s.current.map(nameOf).join(' / '),
            wanted: s.desired.map(nameOf).join(' / '),
            gainOverCurrent: s.gain,
            worthASwap: s.worthIt,
            supremeIntellect: s.promoted,
            swaps: s.swaps,
            cps: inputs.cps,
            clickCps: inputs.clickCps,
            goldenCps: inputs.goldenCps,
            settled: inputs.measured
        })
        console.log(
            window.Alakazam.strategy.pantheon.rank(inputs, 8).map(row => ({
                layout: row.slots.map(nameOf).join(' / '),
                score: Math.round(row.score * 1000) / 1000,
                gain: row.gain,
                moving: row.moving,
                why: row.terms
                    .filter(t => t.gain !== 0)
                    .map(t => `${t.god} ${t.why}`)
                    .join(', ')
            }))
        )
        return s
    }

    registry.register({ name: 'pantheon', interval: INTERVAL_MS, tick })

    window.Alakazam.pantheon = { state, wanted, slot, scoringState, explain }
})()
