// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Clone Customizer
    // Capture the open customizer's live genes before the first change. The undo
    // journal is flushed before each arrow click and keeps every owned appearance:
    // the game's autosave may trail many clicks behind our storage. Keep the undo
    // record until restoration reaches the game save; later player edits win.

    const { simulateClick } = window.Alakazam.safety.input('clones')
    const { save, store, registry } = window.Alakazam
    const { GENES, LIKENESS, FREE_GENE, stepsTo } = window.Alakazam.data.clones

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
    // the live snapshot for inspection; the recovery journal owns restoration.
    const THEIRS_KEY = 'clonesTheirLook'
    const RECOVERY_KEY = 'cloneRecovery'
    const { safety, identity } = window.Alakazam
    let restoredHere = null
    const equal = (a, b) =>
        Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])

    function stillRestored(mark, who) {
        // Imports can replace the live look without changing the run, save or
        // journal. File loads refresh the bakery label without using a prompt.
        return (
            restoredHere &&
            restoredHere.runId === who.runId &&
            restoredHere.revision === safety.revision('prompt') &&
            restoredHere.unchanged() &&
            JSON.stringify(mark) === JSON.stringify(restoredHere.mark) &&
            !mark.intervened &&
            !safety.prompt()
        )
    }

    function forgetIfSaved(mark) {
        if (!store.ownsRecovery(RECOVERY_KEY)) return false
        const saved = window.Alakazam.savefile.read()
        if (
            !saved.ok ||
            identity.fromSave(saved).legacyId !== mark.legacyId ||
            !equal(saved.run?.appearance, mark.original)
        )
            return false
        store.forget(RECOVERY_KEY)
        restoredHere = null
        return true
    }

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
        return window.Alakazam.safety.ownsPrompt('clones', 'CustomizeYou')
    }

    //! Whose look it was

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
    function step(gene, direction, ctx) {
        const side = direction > 0 ? 'R' : 'L'
        const arrow = el(`customizerSelect-${side}-${GENES[gene]}`)
        if (!arrow) return false
        ctx.input('simulateClick', arrow)
        return true
    }

    //* walk
    // click toward a target appearance. Returns whether everything now matches,
    // so the caller can stop rather than carry on with a half-walked set.
    async function walk(
        target,
        budget,
        ctx = safety.scope('clones'),
        mark = null,
        runId = identity.current().runId,
        unchanged = safety.cosmeticCheck()
    ) {
        while (budget.left > 0) {
            if (!unchanged() || identity.current().runId !== runId) return false
            ctx.check()
            const genes = currentGenes()
            if (!genes || !safety.ownsPrompt('clones', 'CustomizeYou')) return false
            if (mark && !equal(genes, mark.expected) && !equal(genes, mark.previous)) return false
            const gene = target.findIndex((value, i) => value !== genes[i])
            if (gene === -1) return true
            const direction = Math.sign(stepsTo(gene, genes[gene], target[gene]))
            if (!(await move(gene, direction, ctx, mark, runId, unchanged))) return false
            budget.left--
        }
        return equal(currentGenes(), target)
    }

    async function move(
        gene,
        direction,
        ctx,
        mark,
        runId = identity.current().runId,
        unchanged = safety.cosmeticCheck()
    ) {
        if (!unchanged() || identity.current().runId !== runId) return false
        if (mark && !store.ownsRecovery(RECOVERY_KEY)) return false
        const before = currentGenes()
        if (!before) return false
        const next = before.slice()
        const choices = window.Alakazam.data.clones.CHOICES[gene]
        next[gene] = (next[gene] + direction + choices) % choices
        const revision = safety.revision()
        if (mark) {
            mark.previous = before
            mark.expected = next
            const history = mark.history || [mark.original, before]
            // Use a new array so in-flight storage snapshots cannot change.
            mark.history = history.some(genes => equal(genes, next)) ? history : [...history, next]
            store.set(RECOVERY_KEY, { ...mark })
            if (!(await store.flush().catch(() => false))) return false
        }
        ctx.check()
        if (mark && !store.ownsRecovery(RECOVERY_KEY)) return false
        if (!unchanged() || identity.current().runId !== runId) return false
        if (revision !== safety.revision() || !equal(currentGenes(), before)) return false
        if (!safety.ownsPrompt('clones', 'CustomizeYou') || !step(gene, direction, ctx)) return false
        return equal(currentGenes(), next)
    }

    async function restore(mark, ctx, runId, unchanged) {
        // an import can replace the live customizer before cancelled work drains
        const who = identity.current()
        if (!store.ownsRecovery(RECOVERY_KEY)) return false
        if (!unchanged() || !who.known || mark.legacyId !== who.legacyId || who.runId !== runId)
            return false
        const superseded = () => {
            store.forget(RECOVERY_KEY)
            store.set(DONE_KEY, true)
            if (safety.ownsPrompt('clones', 'CustomizeYou')) {
                ctx.input('simulateClick', el('promptOption0'))
            }
            return false
        }
        if (store.get(RECOVERY_KEY, null)?.intervened) return superseded()
        if (!safety.ownsPrompt('clones', 'CustomizeYou')) return false
        const live = currentGenes()
        if (!live) return false
        const owned = [mark.original, mark.expected, mark.previous, ...(mark.history || [])]
        if (!owned.some(genes => equal(live, genes))) {
            // the player's intervening look supersedes our undo record
            return superseded()
        }
        // A reload can resume at any journaled step, not just the latest write.
        mark.expected = live
        mark.previous = live
        if (!(await walk(mark.original, { left: MAX_CLICKS }, ctx, mark, runId, unchanged))) return false
        if (!unchanged() || identity.current().runId !== runId || !equal(currentGenes(), mark.original))
            return false
        restoredHere = {
            mark: { ...mark },
            runId,
            revision: safety.revision('prompt'),
            unchanged: safety.cosmeticCheck()
        }
        store.set(RECOVERY_KEY, restoredHere.mark)
        forgetIfSaved(mark)
        if (mark.earned) store.set(DONE_KEY, true)
        ctx.input('simulateClick', el('promptOption0'))
        return true
    }

    async function tick() {
        const ctx = safety.scope('clones')
        const who = identity.current()
        if (!who.known) return
        let mark = store.get(RECOVERY_KEY, null)
        if (!mark && (done() || !ownsAYou())) return
        if (mark && mark.legacyId !== who.legacyId) return
        if (mark && !store.ownsRecovery(RECOVERY_KEY)) return
        // Reuse verification only while its live DOM proof still holds. An open
        // customizer always goes through the live check.
        if (mark && stillRestored(mark, who)) {
            forgetIfSaved(mark)
            return
        }
        if (safety.prompt() && !safety.ownsPrompt('clones', 'CustomizeYou')) return
        const unchanged = ctx.cleanup(() => safety.cosmeticIdentity(ctx, who))
        if (!unchanged) return
        if (!safety.prompt()) {
            const button = customizeButton()
            if (!button) return
            simulateClick(button)
        }
        if (!safety.ownsPrompt('clones', 'CustomizeYou')) return
        const ownedPrompt = safety.prompt()
        try {
            if (mark) {
                await ctx.cleanup(() => restore(mark, ctx, who.runId, unchanged))
                return
            }
            const original = currentGenes()
            if (!original) return
            if (store.get(RECOVERY_KEY, null)) return
            mark = {
                legacyId: who.legacyId,
                original: original.slice(),
                expected: original.slice(),
                previous: original.slice(),
                history: [original.slice()]
            }
            if (!store.ownsRecovery(RECOVERY_KEY, false)) {
                if (!(await store.claimRecovery(RECOVERY_KEY, mark))) return
                ctx.check()
                if (!unchanged() || identity.current().runId !== who.runId) return
            }
            // the save's appearance can be minutes old; only the open customizer is live
            store.set(THEIRS_KEY, original.slice())
            store.set(RECOVERY_KEY, { ...mark })
            try {
                if (!(await store.flush().catch(() => false))) return false
                ctx.check()
                const budget = { left: MAX_CLICKS }
                if (!(await walk(LIKENESS, budget, ctx, mark, who.runId, unchanged))) return
                // the game checks this achievement only inside an arrow handler
                if (!(await move(FREE_GENE, 1, ctx, mark, who.runId, unchanged))) return
                if (!(await move(FREE_GENE, -1, ctx, mark, who.runId, unchanged))) return
                mark.earned = true
                store.set(RECOVERY_KEY, { ...mark })
            } finally {
                await ctx.cleanup(() => restore(mark, ctx, who.runId, unchanged))
            }
        } finally {
            safety.dismissCosmeticPrompt(ctx, ownedPrompt)
        }
    }

    async function recover() {
        const mark = store.get(RECOVERY_KEY, null)
        const who = identity.current()
        if (!mark || !who.known || mark.legacyId !== who.legacyId || safety.prompt()) return
        if (!store.ownsRecovery(RECOVERY_KEY)) return
        if (stillRestored(mark, who)) {
            forgetIfSaved(mark)
            return
        }
        const ctx = safety.context('clones')
        await ctx.cleanup(async () => {
            const unchanged = safety.cosmeticIdentity(ctx, who)
            if (!unchanged) return
            ctx.input('simulateClick', customizeButton())
            const ownedPrompt = safety.prompt()
            try {
                await restore(mark, ctx, who.runId, unchanged)
            } finally {
                safety.dismissCosmeticPrompt(ctx, ownedPrompt)
            }
        })
    }

    registry.register({ name: 'clones', interval: INTERVAL_MS, setup: recover, tick })

    window.Alakazam.clones = { currentGenes, walk, ownsAYou, theirs, tick, recover }
})()
