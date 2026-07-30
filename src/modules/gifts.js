// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Gift Codes
    // The heavenly upgrade "Wrapping paper" adds Send and Redeem buttons to the
    // options menu. Sending wraps up to a thousand cookies as a text code that
    // anyone can redeem, and redeeming one earns the achievement "No time like the
    // present": redeem a cookie gift code from a friend (or from yourself, we don't
    // judge).
    //
    //! Both halves, and the wait in the middle
    // Redeeming your own code is the usual way to get that achievement, and the game
    // makes it a two step job on purpose: sending applies a one hour "Gifted out"
    // buff which blocks redeeming. Buffs do not survive an ascension, so either wait
    // the hour out or ascend, whichever comes first, and codes last a day or two so
    // there is plenty of room for either.
    //
    // So Alakazam sends, keeps the code, and redeems it once the buff is gone.
    // Redeeming means writing into one of the game's own text fields, which is the
    // one thing here that a pointer could not do on its own. It is the same thing the
    // achievement hunt already does to set a bakery name, it lives in the input layer
    // next to the click contract so that it is as visible as every click, and the
    // game validates whatever it is handed either way: the Redeem button stays
    // disabled until the code parses, which is what this waits for rather than
    // deciding for itself that a code is good.
    //
    //! Gating
    // The buttons only exist when the upgrade is owned, the run is not a challenge
    // run, the bank holds a billion cookies and no gift has gone out in the last
    // hour. Most of that is cheap to check without touching anything. Whether the
    // upgrade is owned is not: reading it out of the save would mean knowing an
    // upgrade id, and those move between game versions. So it is read the honest
    // way, by opening the options menu and seeing whether the buttons are there,
    // and the cheap checks come first so that hardly ever happens.

    const { simulateClick, typeInto } = window.Alakazam.input
    const { live, save, store, buffs, registry } = window.Alakazam

    const INTERVAL_MS = 60000

    // a billion cookies in the bank, the game's own threshold for gifting
    const MIN_BANK = 1e9

    // Wrapping paper costs this many heavenly chips, so nobody can own it having
    // spent less. A cheap way to not go looking on a save that cannot have it.
    const WRAPPING_PAPER_COST = 999999

    // the game says codes expire "after a day or two"; a day is the safe read
    const CODE_TTL_MS = 24 * 60 * 60 * 1000

    // after finding no gift buttons, do not go looking again for a good while.
    // Nothing about that answer changes quickly: it takes an ascension.
    const RECHECK_MS = 30 * 60 * 1000

    const CODE_KEY = 'giftCode'
    const CHECKED_KEY = 'giftCheckedAt'

    // the achievement is once per save, and the buff blocks a second redeem for an
    // hour anyway, so once it is done this stops looking
    const REDEEMED_KEY = 'giftRedeemedAt'

    // the hour the game makes you wait between sending and redeeming
    const GIFTED_OUT_MS = 60 * 60 * 1000

    const GIFTED_OUT = /^gifted out$/i

    function el(id) {
        return document.getElementById(id)
    }

    //! The stored code

    function heldCode() {
        const held = store.get(CODE_KEY, null)
        if (!held || !held.code) return null
        if (Date.now() - held.at > CODE_TTL_MS) {
            store.forget(CODE_KEY)
            return null
        }
        return held
    }

    //! The menu

    // whether the options menu on screen is one we opened. The player's own menu is
    // theirs: closing it under them because a gift sequence finished would be the
    // sort of thing that makes an extension feel possessed.
    let openedByUs = false

    function menuOpen() {
        const button = el('prefsButton')
        return !!(button && button.classList && button.classList.contains('selected'))
    }

    function toggleMenu() {
        const button = el('prefsButton')
        if (!button) return false
        openedByUs = !menuOpen()
        simulateClick(button)
        return true
    }

    function closeOurMenu() {
        if (!openedByUs || !menuOpen()) return
        if (promptIs('GiftSend') || promptIs('GiftSendReady')) return
        toggleMenu()
    }

    //* sendButton
    // the first of the two options in #giftStuff. The game gives them no ids, so
    // they are taken in the order it writes them: Send, then Redeem.
    function sendButton() {
        const box = el('giftStuff')
        if (!box || !box.querySelectorAll) return null
        return box.querySelectorAll('a.option')[0] || null
    }

    //* redeemButton
    // the second of the two, by the same reasoning
    function redeemButton() {
        const box = el('giftStuff')
        if (!box || !box.querySelectorAll) return null
        return box.querySelectorAll('a.option')[1] || null
    }

    function promptIs(name) {
        return !!el('promptContent' + name)
    }

    //! Eligibility

    function eligible() {
        if (heldCode()) return false

        const s = save.get()
        if (!s.ok || !s.scalars || s.stale) return false
        // challenge runs have no gifting at all
        if (s.scalars.ascensionMode !== 0) return false
        if ((s.scalars.heavenlyChipsSpent || 0) < WRAPPING_PAPER_COST) return false

        if (live.readGlobals().cookies < MIN_BANK) return false
        // sending or redeeming in the last hour blocks both
        if (buffs.named(GIFTED_OUT).length > 0) return false

        const checked = store.get(CHECKED_KEY, 0)
        if (checked && Date.now() - checked < RECHECK_MS) return false
        return true
    }

    //! The sequence
    // one step per tick. Each step recognises where it is from what is on screen
    // rather than from a counter, so an interrupted run picks up where it left off.

    function step() {
        // the code is ready and waiting to be read
        if (promptIs('GiftSendReady')) {
            const input = el('giftCode')
            const code = input && input.value ? String(input.value) : ''
            if (code) {
                store.set(CODE_KEY, { code, at: Date.now(), runId: runId() })
                console.log(
                    'Alakazam: wrapped a gift. It will be redeemed here once the ' +
                        '"Gifted out" hour is up, or straight after the next ascension, ' +
                        `whichever comes first:\n${code}`
                )
            }
            // "Done" is this prompt's only option
            const done = el('promptOption0')
            if (done) simulateClick(done)
            return
        }

        // the amount and the note are left at whatever the game filled in. The
        // amount is capped at a thousand cookies, which at this point in a run is
        // not a number worth having an opinion about.
        if (promptIs('GiftSend')) {
            const wrap = el('promptOption0')
            if (wrap) simulateClick(wrap)
            return
        }

        if (!menuOpen()) {
            toggleMenu()
            return
        }

        const send = sendButton()
        if (!send) {
            // the buttons are not there, so Wrapping paper is not owned yet
            store.set(CHECKED_KEY, Date.now())
            closeOurMenu()
            return
        }
        simulateClick(send)
    }

    //! Redeeming

    //* redeemable
    // the same conditions the game puts on the button, minus the ones a held code
    // already proves. The wait after sending is the one that matters, and it is
    // checked two ways: the buff itself, which is the truth, and the clock, which is
    // known even before the buff has been read off a tooltip. Buffs do not survive an
    // ascension, so a code wrapped in a previous run is clear whatever the clock says.
    function redeemable() {
        if (store.get(REDEEMED_KEY, 0)) return false
        const held = heldCode()
        if (!held) return false
        const s = save.get()
        if (!s.ok || !s.scalars || s.stale) return false
        if (s.scalars.ascensionMode !== 0) return false
        if (live.readGlobals().cookies < MIN_BANK) return false
        if (buffs.named(GIFTED_OUT).length > 0) return false
        if (held.runId && held.runId !== runId()) return true
        return Date.now() - held.at >= GIFTED_OUT_MS
    }

    function runId() {
        const identity = window.__alakazam && window.__alakazam.identity
        return identity ? identity.runId : ''
    }

    //* redeemStep
    // one step per tick, recognised from the screen like the sending half.
    //
    // The prompt has two elements with the id promptOption0: the game writes its own
    // Redeem button inside the prompt's content and Game.Prompt appends a Cancel
    // option with the same id afterwards. getElementById returns the first, which
    // happens to be the right one, but relying on that is a trap for whoever reads
    // this next, so the button is taken from inside the named content instead.
    function redeemStep(held) {
        if (promptIs('GiftRedeem')) {
            const input = el('giftCode')
            if (!input) return
            typeInto(input, held.code)

            // the game validates on the events typeInto fires and only then clears
            // `disabled`, so the class is its verdict on the code, not ours
            const button = document.querySelector('#promptContentGiftRedeem #promptOption0')
            const disabled = !button || String(button.className || '').indexOf('disabled') !== -1
            if (!disabled) {
                simulateClick(button)
                store.set(REDEEMED_KEY, Date.now())
                store.forget(CODE_KEY)
                console.log('Alakazam: redeemed a gift code, for "No time like the present"')
                return
            }

            // the game will not take it: expired, or from a save that has moved on.
            // Drop it and get out of the prompt rather than sitting in it.
            store.forget(CODE_KEY)
            dismissPrompt()
            return
        }

        if (!menuOpen()) {
            toggleMenu()
            return
        }

        const redeem = redeemButton()
        if (!redeem) {
            store.set(CHECKED_KEY, Date.now())
            closeOurMenu()
            return
        }
        simulateClick(redeem)
    }

    //* dismissPrompt
    // the darkened backdrop closes any prompt that allows closing, which avoids
    // having to pick the right one of two same-id options
    function dismissPrompt() {
        const darken = el('darken')
        if (darken) simulateClick(darken)
    }

    function tick() {
        const held = heldCode()
        window.__alakazam.gifts = held
            ? { code: held.code, expiresInHours: hoursLeft(held), redeemable: redeemable() }
            : { code: null, redeemed: !!store.get(REDEEMED_KEY, 0) }

        if (held) {
            if (redeemable()) {
                redeemStep(held)
                return
            }
            // waiting out the hour, or waiting for a bank: nothing to do, and no
            // reason to leave our own menu open while we wait
            closeOurMenu()
            return
        }

        // never leave our own options menu open once there is nothing left to do
        if (!eligible()) {
            closeOurMenu()
            return
        }

        step()
    }

    function hoursLeft(held) {
        return Math.max(0, Math.round((CODE_TTL_MS - (Date.now() - held.at)) / 3600e3))
    }

    registry.register({ name: 'gifts', interval: INTERVAL_MS, tick })

    window.Alakazam.gifts = { heldCode, eligible, step, redeemable, redeemStep }
})()
