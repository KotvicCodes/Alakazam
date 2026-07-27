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

    const { act, save, store, registry } = window.Alakazam
    const { PRESETS, SLOTS, nameOf } = window.Alakazam.data.gods

    const INTERVAL_MS = 60000

    // never spend the last swap on routine tidying: it is the one that would be
    // needed if a combo or an ascension wanted a real change
    const RESERVE_SWAPS = 1

    let lastActionAt = 0

    //* wanted
    // which preset applies. the clicker layout only makes sense while the
    // autoclicker is actually running, so the choice follows that setting.
    function wanted() {
        return store.moduleEnabled('autoclick') ? PRESETS.clicker : PRESETS.idle
    }

    function state() {
        const p = save.minigame('pantheon')
        const temple = save.building(6)
        if (!p || !temple || temple.level < 1) return null

        const target = wanted()
        const current = p.slots
        const desired = [target.diamond, target.ruby, target.jade]

        const wrong = []
        for (let i = 0; i < 3; i++) {
            if (current[i] !== desired[i]) wrong.push(i)
        }

        return {
            unlocked: true,
            swaps: p.swaps,
            swapT: p.swapT,
            current,
            desired,
            wrong,
            preset: target,
            empty: current.every(s => s === -1)
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

        if (s.wrong.length === 0) return
        // a drag takes a moment and the save takes a minute to catch up, so give
        // the last change time to show up before deciding anything else is wrong
        if (Date.now() - lastActionAt < 90000) return

        // setting up an empty pantheon is what the three starting swaps are for
        if (s.empty && s.swaps >= 3) {
            lastActionAt = Date.now()
            for (let i = 0; i < 3; i++) {
                await slot(s.desired[i], i)
            }
            return
        }

        // otherwise only correct a slot while swaps are plentiful, one at a time
        if (s.swaps <= RESERVE_SWAPS) return
        lastActionAt = Date.now()
        const fix = s.wrong[0]
        await slot(s.desired[fix], fix)
    }

    registry.register({ name: 'pantheon', interval: INTERVAL_MS, tick })

    window.Alakazam.pantheon = { state, wanted, slot }
})()
