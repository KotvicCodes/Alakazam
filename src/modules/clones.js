// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Clone Customizer
    // Runs once, the first time a You is owned, and then never again.
    //
    // It walks the customizer's arrows to the look that earns "In her likeness",
    // steps a free gene once to make the game actually check, and then leaves the
    // clones on a chosen preset. Why any of that is necessary is in
    // src/data/clones.js; the short version is that the achievement is awarded
    // inside the arrow handler, so importing the right appearance does nothing.
    //
    //! And then it stops
    // The appearance is written into the save and survives ascension, so there is
    // nothing to redo. More to the point, it is the player's to change: once this
    // has run, whatever they set stays set. The flag that records it has run is
    // stored per save, and the run is skipped outright if the appearance was
    // already something other than the game's default when first seen.

    const { simulateClick } = window.Alakazam.input
    const { save, store, registry } = window.Alakazam
    const { GENES, LIKENESS, PRESET, FREE_GENE, isDefault, stepsTo } = window.Alakazam.data.clones

    const INTERVAL_MS = 15000

    // the You building's index in the game's own building order
    const YOU = 19

    // Clicking is cheap here (the game updates the arrow's readout synchronously)
    // but a hundred events in one burst is still not something to do to a page, and
    // the stage machine below makes stopping half way harmless.
    const MAX_CLICKS_PER_TICK = 40

    const DONE_KEY = 'clonesStyled'
    const STARTED_KEY = 'clonesStarted'

    //* Stages
    //   likeness  walk every gene to the achievement look
    //   nudge     step a free gene, which is what makes the game check
    //   preset    walk every gene to the appearance to leave behind
    let stage = 'likeness'

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
    // click toward a target appearance, up to the tick's budget. Returns whether
    // everything now matches, so the caller knows when the stage is finished.
    function walk(target, budget) {
        let clicks = 0
        while (clicks < budget) {
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
            if (!moved) return true
        }
        return false
    }

    //! The sequence

    function advance() {
        const genes = currentGenes()
        if (!genes) return

        if (stage === 'likeness') {
            if (walk(LIKENESS, MAX_CLICKS_PER_TICK)) stage = 'nudge'
            return
        }

        if (stage === 'nudge') {
            // The whole set already matches, so these two clicks are the ones the
            // game checks against. Two rather than one so the appearance is left
            // exactly where it was, and on a gene the achievement does not care
            // about so neither click can break the match.
            step(FREE_GENE, 1)
            step(FREE_GENE, -1)
            console.log('Alakazam: styled the clones after a grandma for "In her likeness".')
            stage = 'preset'
            return
        }

        if (stage === 'preset') {
            if (!walk(PRESET, MAX_CLICKS_PER_TICK)) return
            // #promptOption0 on this prompt is its only option, "Done"
            const close = el('promptOption0')
            if (close) simulateClick(close)
            store.set(DONE_KEY, true)
            console.log('Alakazam: clone appearance set. It is yours to change from here on.')
        }
    }

    function tick() {
        if (done()) return
        if (!ownsAYou()) return

        const s = save.get()
        const appearance = s.ok && s.run ? s.run.appearance : null
        const started = store.get(STARTED_KEY, false) === true

        // Someone has already dressed these clones. Leave them alone, and record
        // that so no later tick reconsiders it.
        //
        // The started flag is what keeps this from tripping over our own work: once
        // the walk has begun the appearance is no longer the default, and without
        // it a page reload half way through would read that as the player's choice
        // and abandon a job that is only partly done.
        if (!started && appearance && !isDefault(appearance)) {
            store.set(DONE_KEY, true)
            console.log('Alakazam: the clones already have a look of their own, leaving them be.')
            return
        }

        if (!isOpen()) {
            const button = customizeButton()
            if (!button) return
            store.set(STARTED_KEY, true)
            simulateClick(button)
            return
        }

        advance()
    }

    registry.register({ name: 'clones', interval: INTERVAL_MS, tick })

    window.Alakazam.clones = { currentGenes, walk, ownsAYou, tick }
})()
