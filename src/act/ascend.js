// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Ascension Screen Controls
    // Every click the ascension sequence makes, and nothing else. The decision to
    // ascend is in modules/ascend.js and the arithmetic behind it is in
    // strategy/ascend.js; this file only knows how to work the screen.
    //
    // It is separated for the same reason act/store.js is: these are the controls
    // that can do real damage if they are driven from the wrong place, so they live
    // somewhere with one obvious owner.
    //
    //! Never confirm a prompt you did not open
    // The game funnels every confirmation through one element. `Game.Prompt` writes
    // its options as #promptOption0, #promptOption1 and so on, so the confirm button
    // for "Ascend", for "Reincarnate", and for "Really wipe save" are all the same
    // id. Clicking #promptOption0 because a prompt happens to be open is how an
    // extension deletes somebody's save.
    //
    // What makes this safe is that Game.Prompt also stamps the prompt's own name
    // into the DOM: content beginning with `<id Ascend>` is wrapped in a div called
    // #promptContentAscend. So every confirm here names the prompt it expects and
    // refuses to click when that prompt is not the one on screen.

    const { simulateClick } = window.Alakazam.input
    const { parseGameNumber } = window.Alakazam.parse

    //* Prompts we are willing to confirm
    // by the id Game.Prompt derives from the prompt's own name. Anything not on
    // this list is a prompt the ascension sequence has no business answering.
    const PROMPTS = {
        ascend: 'promptContentAscend',
        reincarnate: 'promptContentReincarnate',
        permanent: 'promptContentPickPermaUpgrade'
    }

    function el(id) {
        return document.getElementById(id)
    }

    //! Where we are

    //* screen
    // The game tracks its own mode in the class list of #game. Three matter:
    //
    //   ascendIntro   the cookie is exploding; nothing is clickable yet
    //   ascending     the heavenly upgrade tree is up and shopping can start
    //   reincarnating the fade back into a fresh run
    //
    // Reading the class rather than Game.OnAscend keeps this on the DOM side of the
    // fair-play contract, and it is the same fact: the class is what the game's own
    // stylesheet keys off.
    function screen() {
        const game = el('game')
        if (!game || !game.classList) return 'playing'
        if (game.classList.contains('ascending')) return 'ascending'
        if (game.classList.contains('ascendIntro')) return 'intro'
        if (game.classList.contains('reincarnating')) return 'reincarnating'
        return 'playing'
    }

    function onAscendScreen() {
        return screen() === 'ascending'
    }

    //* animating
    // the five second ascend animation, and the fade back afterwards. both are
    // periods where clicking achieves nothing, so the caller waits them out.
    function animating() {
        const where = screen()
        return where === 'intro' || where === 'reincarnating'
    }

    //! Prompts

    function promptIs(which) {
        const id = PROMPTS[which]
        return !!(id && el(id))
    }

    //* confirmPrompt
    // click the confirm option, but only when the prompt on screen is the one named.
    // returns false rather than clicking anything when it is not.
    function confirmPrompt(which) {
        return clickOption(which, 'promptOption0')
    }

    //* cancelPrompt
    // the second option, which every prompt the sequence opens uses for Cancel or
    // No. Backing out has to be possible: a picker with nothing worth picking would
    // otherwise sit open forever, and everything else waits behind it.
    function cancelPrompt(which) {
        return clickOption(which, 'promptOption1')
    }

    function clickOption(which, id) {
        if (!promptIs(which)) return false
        const option = el(id)
        if (!option) return false
        simulateClick(option)
        return true
    }

    //! Leaving the run

    //* openLegacy
    // the Legacy button in the corner, which opens the Ascend prompt. It does not
    // ascend on its own: the prompt still has to be confirmed, which is the second
    // step and a separate call.
    function openLegacy() {
        const button = el('legacyButton')
        if (!button) return false
        simulateClick(button)
        return true
    }

    //! On the ascension screen

    //* chips
    // the heavenly chips available to spend, read off the screen rather than the
    // save, because the save has not been written since the ascension started.
    //
    // The figure the game renders climbs toward its real value over a second or so
    // after arriving, so a caller that needs it settled polls until it stops moving.
    function chips() {
        const box = el('ascendHCs')
        if (!box) return NaN
        const price = box.querySelector ? box.querySelector('.price') : null
        return parseGameNumber((price || box).innerText)
    }

    function prestige() {
        const box = el('ascendPrestige')
        return box ? parseGameNumber(box.innerText) : NaN
    }

    //* crates
    // every heavenly upgrade the tree is currently offering.
    //
    // A ghosted crate is one whose prerequisites are not met: the game renders it as
    // a plain div with no click handler at all, so clicking it does nothing and only
    // costs a hover to find that out. They are dropped here rather than in the
    // caller so no consumer can forget.
    function crates() {
        const out = []
        const tree = el('ascendUpgrades')
        if (!tree || !tree.querySelectorAll) return out
        for (const node of tree.querySelectorAll('.crate.upgrade.heavenly')) {
            if (node.classList && node.classList.contains('ghosted')) continue
            const id = node.getAttribute ? node.getAttribute('data-id') : null
            // the tree draws a decorative crate with no id behind the real ones
            if (!id) continue
            out.push({ id, element: node })
        }
        return out
    }

    function buy(crate) {
        if (!crate || !crate.element) return false
        simulateClick(crate.element)
        return true
    }

    //! Permanent upgrade slots
    // Buying a slot does not fill it. Clicking the slot's own crate opens a picker
    // of every upgrade bought last run, and the choice is only committed by the
    // prompt's Confirm.

    function permanentChoices() {
        const out = []
        const prompt = el(PROMPTS.permanent)
        if (!prompt || !prompt.querySelectorAll) return out
        for (const node of prompt.querySelectorAll('.crate.upgrade')) {
            const id = node.id || ''
            if (id.indexOf('upgradeForPermanent') !== 0) continue
            out.push({ id: id.slice('upgradeForPermanent'.length), element: node })
        }
        return out
    }

    function pickPermanent(choice) {
        if (!choice || !choice.element) return false
        simulateClick(choice.element)
        return true
    }

    //! Coming back

    function reincarnate() {
        const button = el('ascendButton')
        if (!button) return false
        simulateClick(button)
        return true
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.act = window.Alakazam.act || {}
    window.Alakazam.act.ascend = {
        screen,
        onAscendScreen,
        animating,
        promptIs,
        confirmPrompt,
        cancelPrompt,
        openLegacy,
        chips,
        prestige,
        crates,
        buy,
        permanentChoices,
        pickPermanent,
        reincarnate,
        PROMPTS
    }
})()
