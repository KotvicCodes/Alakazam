// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Bank Loans
    // The Bank's stock market minigame sells three loans. Each one is a large
    // production multiplier now, paid for with a worse multiplier afterwards and a
    // slice of the bank up front. Taken in the ordinary course of a run they are a
    // bad deal, which is why nothing else in Alakazam touches them.
    //
    // Immediately before ascending they are close to free money, for two reasons.
    //
    // The penalty is a buff on the run, and ascending ends the run. So the second
    // half of the trade never happens: the boost is banked as cookies, which count
    // toward prestige, and the debt dies with the save.
    //
    // The downpayment is a percentage of the current bank, and the bank is about to
    // be discarded anyway. Spending cookies does not reduce cookiesEarned, which is
    // the number prestige is computed from, so it costs nothing that matters.
    //
    // The game has an achievement for exactly this, "Debt evasion": take out a loan
    // and ascend before incurring the CpS penalty.
    //
    // Figures below are the game's own, from minigameMarket.js.

    const MINUTE = 60

    const LOANS = [
        {
            id: 1,
            name: 'a modest loan',
            selector: 'bankLoan1',
            // the office level the bank has to be past for this slot to exist
            officeLevel: 2,
            multiplier: 1.5,
            boostSeconds: 120 * MINUTE,
            penalty: 0.25,
            penaltySeconds: 240 * MINUTE,
            downpayment: 0.2
        },
        {
            id: 2,
            name: 'a pawnshop loan',
            selector: 'bankLoan2',
            officeLevel: 4,
            multiplier: 2,
            // forty seconds. this is the whole schedule: it is by far the strongest
            // of the three and by far the shortest, so it is taken last and it is
            // what the ascension has to happen inside of.
            boostSeconds: 0.67 * MINUTE,
            penalty: 0.1,
            penaltySeconds: 40 * MINUTE,
            downpayment: 0.4
        },
        {
            id: 3,
            name: 'a retirement loan',
            selector: 'bankLoan3',
            officeLevel: 5,
            multiplier: 1.2,
            boostSeconds: 2880 * MINUTE,
            penalty: 0.8,
            penaltySeconds: 7200 * MINUTE,
            downpayment: 0.5
        }
    ]

    //* ORDER
    // The order to take them in, which is not their numbering.
    //
    // Every loan starts its clock the moment it is taken, and the ascension has to
    // land inside all three windows at once for none of the penalties to arrive.
    // The pawnshop loan runs for forty seconds and the other two for hours, so
    // taking it last is what makes that window as wide as it can be. Taken first,
    // the other two purchases would eat most of it.
    const ORDER = [1, 3, 2]

    //* SHORTEST
    // the loan whose window closes first, and therefore the one the ascension is
    // timed against
    const SHORTEST = 2

    function byId(id) {
        return LOANS.find(l => l.id === id) || null
    }

    //* buffPattern
    // what the buff for a taken loan is called on screen. The game names the boost
    // "Loan 1" and the penalty "Loan 1 (interest)", so a pattern that matched
    // loosely would call the penalty a boost and ascend too late to dodge it.
    function buffPattern(id) {
        return new RegExp(`^loan ${id}$`, 'i')
    }

    //* interestPattern
    // the penalty half. Seeing one of these means an ascension was left too late,
    // which is worth noticing rather than silently continuing.
    function interestPattern(id) {
        return new RegExp(`^loan ${id} \\(interest\\)$`, 'i')
    }

    // the combined multiplier if every listed loan is running at once
    function stackedMultiplier(ids) {
        return ids.reduce((total, id) => {
            const loan = byId(id)
            return loan ? total * loan.multiplier : total
        }, 1)
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.data = window.Alakazam.data || {}
    window.Alakazam.data.loans = {
        LOANS,
        ORDER,
        SHORTEST,
        byId,
        buffPattern,
        interestPattern,
        stackedMultiplier
    }
})()
