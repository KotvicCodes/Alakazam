// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Loan Controls
    // The three loan buttons in the Bank's minigame. Why taking them is worth doing
    // at all, and only immediately before an ascension, is in src/data/loans.js.
    //
    // Nothing else in Alakazam may call take(). A loan outside the pre-ascension
    // sequence is a straight loss: the boost is smaller than the penalty and the
    // penalty is the one that gets paid.

    const { simulateClick } = window.Alakazam.input
    const { LOANS, byId } = window.Alakazam.data.loans

    //* offered
    // Whether a loan slot is on screen and can be taken right now.
    //
    // The game gates the buttons three ways and all three have to be checked. The
    // slot is hidden with an inline display:none below the office level that
    // unlocks it; the button carries `bankButtonOff` while that loan is already
    // running or still in its interest phase; and none of it exists at all until
    // the Bank's minigame has been unlocked with a sugar lump.
    function offered(id) {
        const loan = byId(id)
        if (!loan) return false
        const el = document.getElementById(loan.selector)
        if (!el) return false
        if (el.style && el.style.display === 'none') return false
        if (el.classList && el.classList.contains('bankButtonOff')) return false
        return true
    }

    function available() {
        return LOANS.filter(l => offered(l.id)).map(l => l.id)
    }

    //* take
    // Click one loan slot. Returns whether the click was issued, not whether the
    // loan was granted: the game decides that in its own handler, and the honest
    // confirmation is the buff appearing, which the caller watches for.
    function take(id) {
        if (!offered(id)) return false
        const loan = byId(id)
        const el = document.getElementById(loan.selector)
        simulateClick(el)
        return true
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.act = window.Alakazam.act || {}
    window.Alakazam.act.loans = { offered, available, take }
})()
