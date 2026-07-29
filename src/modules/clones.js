// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Clone Customizer
    // Runs once, the first time a You is owned, and then never again.
    //
    // It walks the customizer's arrows to the look that earns "In her likeness",
    // steps a free gene once to make the game actually check, and then puts the
    // clones back. Why any of that is necessary is in src/data/clones.js; the
    // short version is that the achievement is awarded inside the arrow handler,
    // so importing the right appearance does nothing.
    //
    //! All of it in one tick
    // This used to be three stages a tick apart, which meant leaving the game's
    // customizer prompt open on the player's screen for the best part of a minute
    // and hoping it was still there next time. It is a prompt like any other:
    // anything that opens one of its own replaces it, anything that clicks
    // #promptOption0 closes it, and the player can dismiss it themselves. Any of
    // those and the sequence went back to the beginning.
    //
    // Nothing here needs to wait for the game. An arrow click runs the game's own
    // handler synchronously and the readout is updated inside it, and Game.Prompt
    // builds its content synchronously too. So the whole thing is one pass: open,
    // walk, nudge, put back, close. The panel is on screen for a frame.
    //
    //! Whose clones they are
    // The appearance is the player's to choose, and it is written into the save
    // and survives ascension. So whatever the clones looked like when Alakazam
    // first met this save is put back afterwards, and only clones still on the
    // game's default are left on a preset.
    //
    // Refusing to run at all on a save with a look of its own, which is what this
    // did before, means declining the achievement over a hairstyle. The look is
    // worth preserving; a few seconds of it changing is not worth an achievement.

    const { simulateClick } = window.Alakazam.input
    const { save, store, registry } = window.Alakazam
    const { GENES, LIKENESS, PRESET, FREE_GENE, isDefault, stepsTo } = window.Alakazam.data.clones

    const INTERVAL_MS = 15000

    // the You building's index in the game's own building order
    const YOU = 19

    //* MAX_CLICKS
    // the whole sequence is a bit over a hundred arrow clicks, each of which
    // redraws a 32 by 32 portrait. This is the ceiling rather than the
    // expectation: it exists so that a customizer that stops responding cannot
    // turn into a loop, not to ration a job that happens once per save.
    const MAX_CLICKS = 300

    const DONE_KEY = 'clonesStyled'

    //* THEIRS_KEY
    // the look the clones had the first time Alakazam saw this save, so it can be
    // put back. It is recorded before anything is touched, because once the walk
    // has begun the save no longer says what the player chose.
    const THEIRS_KEY = 'clonesTheirLook'

    function el(id) {
        return document.getElementById(id)
    }

    function done() {
        return store.get(DONE_KEY, false) === true
    }

    //* ownsAYou
    // the customizer only exists once the You building's row does, which is once
    // one has been bought
    function ownsAYou() {
        const you = save.building(YOU)
        return !!you && you.amount > 0
    }

    //* customizeButton
    // the only button in the You row, tucked into its bottom left corner. It is
    // found by position in the row rather than by an id, because the game gives it
    // none: see the `onlyOnCanvas` anchor it writes into row 19.
    function customizeButton() {
        const row = el('row' + YOU)
        return row && row.querySelector ? row.querySelector('a.smallFancyButton') : null
    }

    function isOpen() {
        return !!el('promptContentCustomizeYou')
    }

    //! Whose look it was

    function rememberTheirs() {
        if (store.get(THEIRS_KEY, undefined) !== undefined) return
        const s = save.get()
        const appearance = s.ok && s.run ? s.run.appearance : null
        // null records "the game's default", which is nobody's choice and so
        // nothing to put back
        store.set(THEIRS_KEY, appearance && !isDefault(appearance) ? appearance.slice() : null)
    }

    function theirs() {
        const held = store.get(THEIRS_KEY, null)
        return Array.isArray(held) && held.length === GENES.length ? held : null
    }

    //* currentGenes
    // read straight off the customizer, which prints each gene's index plus one
    // next to its arrows. Returns null when the panel is not up.
    function currentGenes() {
        if (!isOpen()) return null
        const genes = []
        for (const id of GENES) {
            const readout = el('customizerSelect-N-' + id)
            if (!readout) return null
            const shown = parseInt(String(readout.innerText).trim(), 10)
            if (!Number.isFinite(shown)) return null
            genes.push(shown - 1)
        }
        return genes
    }

    //* step
    // one arrow click. Every gene change in this module goes through here, because
    // an arrow click is the only thing the game counts.
    function step(gene, direction) {
        const side = direction > 0 ? 'R' : 'L'
        const arrow = el(`customizerSelect-${side}-${GENES[gene]}`)
        if (!arrow) return false
        simulateClick(arrow)
        return true
    }

    //* walk
    // click toward a target appearance. Returns whether everything now matches,
    // so the caller can stop rather than carry on with a half-walked set.
    function walk(target, budget) {
        let clicks = 0
        while (clicks < budget.left) {
            const genes = currentGenes()
            if (!genes) return false

            let moved = false
            for (let gene = 0; gene < target.length; gene++) {
                const steps = stepsTo(gene, genes[gene], target[gene])
                if (steps === 0) continue
                if (!step(gene, steps)) return false
                clicks++
                moved = true
                break
            }
            if (!moved) {
                budget.left -= clicks
                return true
            }
        }
        budget.left = 0
        return false
    }

    //! The sequence

    function tick() {
        if (done()) return
        if (!ownsAYou()) return

        rememberTheirs()

        if (!isOpen()) {
            const button = customizeButton()
            if (!button) return
            simulateClick(button)
        }
        // Game.Prompt builds its content there and then, so if the panel is not up
        // now the click did not land. Try again on the next tick rather than
        // clicking arrows that are not there.
        if (!isOpen()) return

        const budget = { left: MAX_CLICKS }
        if (!walk(LIKENESS, budget)) return

        // The whole set already matches, so these two clicks are the ones the game
        // checks against. Two rather than one so the appearance is left exactly
        // where it was, and on a gene the achievement does not care about so
        // neither click can break the match.
        step(FREE_GENE, 1)
        step(FREE_GENE, -1)
        console.log('Alakazam: styled the clones after a grandma for "In her likeness".')

        const back = theirs()
        walk(back || PRESET, budget)

        // #promptOption0 on this prompt is its only option, "Done"
        const close = el('promptOption0')
        if (close) simulateClick(close)
        store.set(DONE_KEY, true)
        console.log(
            back
                ? 'Alakazam: put your clones back the way you had them.'
                : 'Alakazam: clone appearance set. It is yours to change from here on.'
        )
    }

    registry.register({ name: 'clones', interval: INTERVAL_MS, tick })

    window.Alakazam.clones = { currentGenes, walk, ownsAYou, theirs, tick }
})()
