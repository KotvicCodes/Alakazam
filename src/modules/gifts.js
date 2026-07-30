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
    //! Why this only does half of it
    // Redeeming your own code is the usual way to get that achievement, and it is
    // deliberately a two step job with a wait in the middle. Sending applies a one
    // hour "Gifted out" buff which blocks redeeming, and buffs do not survive an
    // ascension, so the sequence is: send, ascend, redeem. Codes last a day or two,
    // which is plenty of room.
    //
    // Alakazam does the sending and remembers the code. It does not do the
    // redeeming, because redeeming means typing a code into the game's own text
    // field, and every action this extension takes is a pointer event on something
    // already on screen. Writing into an input is a different kind of act and not
    // one to slip in quietly. So the code goes in the panel with a line saying what
    // to do with it, and the last step is the player's.
    //
    //! Gating
    // The buttons only exist when the upgrade is owned, the run is not a challenge
    // run, the bank holds a billion cookies and no gift has gone out in the last
    // hour. Most of that is cheap to check without touching anything. Whether the
    // upgrade is owned is not: reading it out of the save would mean knowing an
    // upgrade id, and those move between game versions. So it is read the honest
    // way, by opening the options menu and seeing whether the buttons are there,
    // and the cheap checks come first so that hardly ever happens.

    const { simulateClick } = window.Alakazam.input
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
                store.set(CODE_KEY, { code, at: Date.now() })
                console.log(
                    'Alakazam: wrapped a gift. Redeem this code yourself after your next ' +
                        'ascension for the "No time like the present" achievement, from ' +
                        `Options then Redeem:\n${code}`
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

    function tick() {
        const held = heldCode()
        window.__alakazam.gifts = held
            ? { code: held.code, expiresInHours: hoursLeft(held) }
            : { code: null }

        // never leave our own options menu open once there is nothing left to do
        if (held || !eligible()) {
            closeOurMenu()
            return
        }

        step()
    }

    function hoursLeft(held) {
        return Math.max(0, Math.round((CODE_TTL_MS - (Date.now() - held.at)) / 3600e3))
    }

    registry.register({ name: 'gifts', interval: INTERVAL_MS, tick })

    window.Alakazam.gifts = { heldCode, eligible, step }
})()
