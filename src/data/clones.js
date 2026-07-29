// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Clone Appearance
    // The You building lets you design the clones it produces. Seven genes, each a
    // list you step through with a pair of arrows, and one shadow achievement
    // hidden in the combinations.
    //
    //! In her likeness
    // The game watches for a specific look and awards "In her likeness" when the
    // clones resemble a grandma. Its check, from the game's own source, is on the
    // raw gene indices:
    //
    //   hair    == 9
    //   hairCol == 1 or 6
    //   head    == 2 or 3
    //   one of acc1 / acc2 is 2 or 3, and the other is 0
    //   skinCol and face are free
    //
    // The arrows in the customizer show these one-based, so the same thing written
    // the way the panel reads is Hair 10, Hair colour 2 or 7, Head shape 3 or 4,
    // and one Extra at 3 or 4 with the other at 1.
    //
    //! Why it has to be clicked rather than imported
    // The check does not live with the genes; it lives inside offsetGene, the
    // function an arrow calls, and it only runs when the offset is non-zero. Import
    // and the Random button write currentGenes directly and never go near it. So a
    // save loaded with the right appearance does not earn the achievement, and the
    // only thing that does is physically stepping an arrow while the whole set
    // already matches.

    // gene order is positional, matching Game.YouCustomizer.genes
    const GENES = ['hair', 'hairCol', 'skinCol', 'head', 'face', 'acc1', 'acc2']

    // how many choices each gene cycles through, so the shorter way round can be
    // taken rather than always stepping right
    const CHOICES = [17, 18, 15, 5, 10, 36, 36]

    //* DEFAULT
    // what an untouched customizer holds, from the `def` on each gene. Note that
    // hair colour defaults to 1 rather than 0, so "all zeroes" is not the test for
    // an appearance nobody has chosen.
    const DEFAULT = [0, 1, 0, 0, 0, 0, 0]

    // the achievement look. This is the example code from the wiki, which satisfies
    // every clause of the game's check: hair 9, hair colour 1, head 3, Extra-A 3,
    // Extra-B 0.
    const LIKENESS = [9, 1, 1, 3, 7, 3, 0]

    // and what to leave the clones looking like afterwards
    const PRESET = [11, 10, 10, 1, 1, 12, 30]

    //* FREE_GENE
    // A gene the achievement does not constrain, used for the deliberate extra step
    // that fires the check.
    //
    // This is load bearing. Walking every gene to its target only earns the
    // achievement if the final arrow click happens while the whole set already
    // matches, and a gene that was already on its target is never clicked at all.
    // Nudging a free gene one way and back afterwards guarantees a real click with
    // everything in place, and cannot break the match because skin colour is not
    // part of it.
    const FREE_GENE = 2

    //* isDefault
    // whether nobody has ever changed the clones' appearance
    function isDefault(genes) {
        if (!genes || genes.length !== DEFAULT.length) return true
        return genes.every((g, i) => g === DEFAULT[i])
    }

    //* matchesLikeness
    // the game's own check, kept here so a test can assert against the condition
    // rather than against a screenshot of the result
    function matchesLikeness(genes) {
        if (!genes || genes.length < 7) return false
        const [hair, hairCol, , head, , acc1, acc2] = genes
        if (hair !== 9) return false
        if (hairCol !== 1 && hairCol !== 6) return false
        if (head !== 2 && head !== 3) return false
        const oneIsAccessory = [2, 3].indexOf(acc1) !== -1 || [2, 3].indexOf(acc2) !== -1
        const otherIsBare = acc1 === 0 || acc2 === 0
        return oneIsAccessory && otherIsBare
    }

    //* stepsTo
    // how many arrow clicks, and in which direction, to get one gene from where it
    // is to where it should be. Positive is the right arrow. The lists wrap, so the
    // shorter way round is always taken.
    function stepsTo(gene, from, to) {
        const size = CHOICES[gene]
        if (!Number.isFinite(from) || !Number.isFinite(to) || !size) return 0
        const forward = (((to - from) % size) + size) % size
        return forward <= size - forward ? forward : forward - size
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.data = window.Alakazam.data || {}
    window.Alakazam.data.clones = {
        GENES,
        CHOICES,
        DEFAULT,
        LIKENESS,
        PRESET,
        FREE_GENE,
        isDefault,
        matchesLikeness,
        stepsTo
    }
})()
