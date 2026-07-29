// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Number Parsing
    // Cookie Clicker renders numbers in several display modes depending on the
    // player's settings: named suffixes ("1.234 million"), short scientific
    // ("1.234e6") and plain grouped digits ("1,234,567"). Every reader funnels
    // raw text through parseGameNumber so the rest of the code deals in plain
    // JavaScript numbers.

    //* Named suffixes
    // each suffix maps its word to the power of ten it represents
    const SUFFIXES = {
        thousand: 10 ** 3,
        million: 10 ** 6,
        billion: 10 ** 9,
        trillion: 10 ** 12,
        quadrillion: 10 ** 15,
        quintillion: 10 ** 18,
        sextillion: 10 ** 21,
        septillion: 10 ** 24,
        octillion: 10 ** 27,
        nonillion: 10 ** 30,
        decillion: 10 ** 33,
        undecillion: 10 ** 36,
        duodecillion: 10 ** 39,
        tredecillion: 10 ** 42,
        quattuordecillion: 10 ** 45,
        quindecillion: 10 ** 48,
        sexdecillion: 10 ** 51,
        septendecillion: 10 ** 54,
        octodecillion: 10 ** 57,
        novemdecillion: 10 ** 60,
        vigintillion: 10 ** 63,
        unvigintillion: 10 ** 66,
        duovigintillion: 10 ** 69,
        tresvigintillion: 10 ** 72,
        quattuorvigintillion: 10 ** 75,
        quinvigintillion: 10 ** 78,
        sexvigintillion: 10 ** 81,
        septenvigintillion: 10 ** 84,
        octovigintillion: 10 ** 87,
        novemvigintillion: 10 ** 90,
        trigintillion: 10 ** 93,
        untrigintillion: 10 ** 96,
        duotrigintillion: 10 ** 99,
        googol: 10 ** 100,
        trestrigintillion: 10 ** 102,
        quattuortrigintillion: 10 ** 105,
        quintrigintillion: 10 ** 108,
        sextrigintillion: 10 ** 111,
        septentrigintillion: 10 ** 114,
        octotrigintillion: 10 ** 117,
        novemtrigintillion: 10 ** 120,
        quadragintillion: 10 ** 123,
        unquadragintillion: 10 ** 126,
        duoquadragintillion: 10 ** 129,
        tresquadragintillion: 10 ** 132,
        quattuorquadragintillion: 10 ** 135,
        quinquadragintillion: 10 ** 138,
        sexquadragintillion: 10 ** 141,
        septenquadragintillion: 10 ** 144,
        octoquadragintillion: 10 ** 147,
        novemquadragintillion: 10 ** 150,
        quinquagintillion: 10 ** 153,
        unquinquagintillion: 10 ** 156,
        duoquinquagintillion: 10 ** 159,
        tresquinquagintillion: 10 ** 162,
        quattuorquinquagintillion: 10 ** 165,
        quinquinquagintillion: 10 ** 168,
        sexquinquagintillion: 10 ** 171,
        septenquinquagintillion: 10 ** 174,
        octoquinquagintillion: 10 ** 177,
        novemquinquagintillion: 10 ** 180,
        sexagintillion: 10 ** 183,
        unsexagintillion: 10 ** 186,
        duosexagintillion: 10 ** 189,
        tresexagintillion: 10 ** 192,
        quattuorsexagintillion: 10 ** 195,
        quinsexagintillion: 10 ** 198,
        sexsexagintillion: 10 ** 201,
        septensexagintillion: 10 ** 204,
        octosexagintillion: 10 ** 207,
        novemsexagintillion: 10 ** 210,
        septuagintillion: 10 ** 213,
        unseptuagintillion: 10 ** 216,
        duoseptuagintillion: 10 ** 219,
        treseptuagintillion: 10 ** 222,
        quattuorseptuagintillion: 10 ** 225,
        quinseptuagintillion: 10 ** 228,
        sexseptuagintillion: 10 ** 231,
        septenseptuagintillion: 10 ** 234,
        octoseptuagintillion: 10 ** 237,
        novemseptuagintillion: 10 ** 240,
        octogintillion: 10 ** 243,
        unoctogintillion: 10 ** 246,
        duooctogintillion: 10 ** 249,
        tresoctogintillion: 10 ** 252,
        quattuoroctogintillion: 10 ** 255,
        quinoctogintillion: 10 ** 258,
        sexoctogintillion: 10 ** 261,
        septenoctogintillion: 10 ** 264,
        octooctogintillion: 10 ** 267,
        novemoctogintillion: 10 ** 270,
        nonagintillion: 10 ** 273,
        unnonagintillion: 10 ** 276,
        duononagintillion: 10 ** 279,
        trenonagintillion: 10 ** 282,
        quattuornonagintillion: 10 ** 285,
        quinnonagintillion: 10 ** 288,
        sexnonagintillion: 10 ** 291,
        septennonagintillion: 10 ** 294,
        octononagintillion: 10 ** 297,
        novemnonagintillion: 10 ** 300,
        centillion: 10 ** 303
    }

    //* Short suffixes
    // Cookie Clicker's "Short numbers" setting renders magnitudes as abbreviations
    // ("134B", "1.234Qa", "5.6Qi") instead of full words. This is the game's full
    // list, taken verbatim from its source (formatEveryThirdPower): the abbreviation
    // at each 10^3 step from thousand up to 10^276, after which the game switches to
    // scientific notation (already handled below). Keys are lowercase because
    // parseGameNumber lowercases the text first; the game's scheme has no lowercase
    // collisions (e.g. it uses "UnV" for 10^63, not a bare "V"/"Vg").
    const SHORT_SUFFIXES = {
        k: 10 ** 3,
        m: 10 ** 6,
        b: 10 ** 9,
        t: 10 ** 12,
        qa: 10 ** 15,
        qi: 10 ** 18,
        sx: 10 ** 21,
        sp: 10 ** 24,
        oc: 10 ** 27,
        no: 10 ** 30,
        dc: 10 ** 33,
        und: 10 ** 36,
        dod: 10 ** 39,
        trd: 10 ** 42,
        qad: 10 ** 45,
        qid: 10 ** 48,
        sxd: 10 ** 51,
        spd: 10 ** 54,
        ocd: 10 ** 57,
        nod: 10 ** 60,
        unv: 10 ** 63,
        dov: 10 ** 66,
        trv: 10 ** 69,
        qav: 10 ** 72,
        qiv: 10 ** 75,
        sxv: 10 ** 78,
        spv: 10 ** 81,
        ocv: 10 ** 84,
        nov: 10 ** 87,
        unt: 10 ** 90,
        dot: 10 ** 93,
        trt: 10 ** 96,
        qat: 10 ** 99,
        qit: 10 ** 102,
        sxt: 10 ** 105,
        spt: 10 ** 108,
        oct: 10 ** 111,
        not: 10 ** 114,
        unqa: 10 ** 117,
        doqa: 10 ** 120,
        trqa: 10 ** 123,
        qaqa: 10 ** 126,
        qiqa: 10 ** 129,
        sxqa: 10 ** 132,
        spqa: 10 ** 135,
        ocqa: 10 ** 138,
        noqa: 10 ** 141,
        unqi: 10 ** 144,
        doqi: 10 ** 147,
        trqi: 10 ** 150,
        qaqi: 10 ** 153,
        qiqi: 10 ** 156,
        sxqi: 10 ** 159,
        spqi: 10 ** 162,
        ocqi: 10 ** 165,
        noqi: 10 ** 168,
        unsx: 10 ** 171,
        dosx: 10 ** 174,
        trsx: 10 ** 177,
        qasx: 10 ** 180,
        qisx: 10 ** 183,
        sxsx: 10 ** 186,
        spsx: 10 ** 189,
        ocsx: 10 ** 192,
        nosx: 10 ** 195,
        unsp: 10 ** 198,
        dosp: 10 ** 201,
        trsp: 10 ** 204,
        qasp: 10 ** 207,
        qisp: 10 ** 210,
        sxsp: 10 ** 213,
        spsp: 10 ** 216,
        ocsp: 10 ** 219,
        nosp: 10 ** 222,
        unoc: 10 ** 225,
        dooc: 10 ** 228,
        troc: 10 ** 231,
        qaoc: 10 ** 234,
        qioc: 10 ** 237,
        sxoc: 10 ** 240,
        spoc: 10 ** 243,
        ococ: 10 ** 246,
        nooc: 10 ** 249,
        unno: 10 ** 252,
        dono: 10 ** 255,
        trno: 10 ** 258,
        qano: 10 ** 261,
        qino: 10 ** 264,
        sxno: 10 ** 267,
        spno: 10 ** 270,
        ocno: 10 ** 273,
        nono: 10 ** 276
    }

    //* parseGameNumber
    // turns any Cookie Clicker rendered number into a plain Number, or NaN when the
    // text holds no number. handles suffix words, scientific notation and grouped
    // digits. the caller decides what to do with NaN.
    function parseGameNumber(rawText) {
        if (rawText === null || rawText === undefined) return NaN

        const text = String(rawText).trim().toLowerCase()
        if (text === '') return NaN

        // scientific notation, e.g. "1.234e+21" or "1.2e21"
        const scientific = text.match(/(-?[\d.]+)\s*e\s*([+-]?\d+)/)
        if (scientific) {
            return parseFloat(scientific[1]) * 10 ** parseInt(scientific[2], 10)
        }

        // number followed by an optional named suffix, e.g. "1.234 million"
        const match = text.match(/(-?[\d,.]+)\s*([a-z]+)?/)
        if (!match) return NaN

        const numberPart = parseFloat(match[1].replace(/,/g, ''))
        if (Number.isNaN(numberPart)) return NaN

        const suffixWord = match[2]
        if (!suffixWord) return numberPart

        const multiplier = SUFFIXES[suffixWord] || SHORT_SUFFIXES[suffixWord]
        // an unrecognized trailing word (e.g. "cookies") is not a magnitude suffix,
        // so treat the leading number as-is rather than discarding it
        return multiplier ? numberPart * multiplier : numberPart
    }

    //* firstNumberIn
    // grabs the first standalone number out of a longer string. useful for tooltip
    // lines like "each cursor produces 0.1 cookies per second".
    function firstNumberIn(rawText) {
        if (rawText === null || rawText === undefined) return NaN
        // digits, then either scientific tail or a suffix word/abbreviation. an
        // attached unit like " cookies" gets captured too but parseGameNumber ignores
        // any word that is not a known magnitude, so the value stays correct.
        const match = String(rawText).match(/-?[\d,.]+(?:\s*e\s*[+-]?\d+|\s*[a-z]+)?/i)
        return match ? parseGameNumber(match[0]) : NaN
    }

    //! Rendering numbers back out

    //* MAGNITUDES
    // SHORT_SUFFIXES inverted: value first, largest first, with the game's own
    // capitalisation restored.
    //
    // Every suffix past the single letters is built from a prefix (un, do, tr, qa,
    // qi, sx, sp, oc, no) followed by a base, and the game capitalises each part:
    // un + d is UnD, qa + qi is QaQi. Deriving that beats writing ninety more
    // lines out by hand and getting one of them wrong.
    const MAGNITUDE_PREFIXES = ['un', 'do', 'tr', 'qa', 'qi', 'sx', 'sp', 'oc', 'no']

    function displaySuffix(key) {
        // the game leaves thousands lowercase and everything else capitalised
        if (key === 'k') return 'k'
        const prefix = MAGNITUDE_PREFIXES.find(p => key.length > p.length && key.indexOf(p) === 0)
        const capitalise = s => s.charAt(0).toUpperCase() + s.slice(1)
        return prefix ? capitalise(prefix) + capitalise(key.slice(prefix.length)) : capitalise(key)
    }

    const MAGNITUDES = Object.keys(SHORT_SUFFIXES)
        .map(key => [SHORT_SUFFIXES[key], displaySuffix(key)])
        .sort((a, b) => b[0] - a[0])

    //* formatNumber
    // A Cookie Clicker number the way Cookie Clicker would write it.
    //
    // The panel used to carry its own eight-entry table that stopped at 10^24, so
    // any real save eventually rendered as "54566999999999992.00Sp": seventeen
    // digits of noise where the game itself says 54.567 duodecillion. The table
    // here is the game's own, all the way to 10^276, and past that there is
    // nothing left to do but use an exponent.
    function formatNumber(n) {
        if (!Number.isFinite(n)) return '-'
        if (n < 0) return '-' + formatNumber(-n)
        if (n < 1000) return n < 100 && n % 1 !== 0 ? trimZeros(n.toFixed(1)) : String(Math.round(n))

        for (const [value, suffix] of MAGNITUDES) {
            if (n >= value) {
                const scaled = n / value
                // past the biggest suffix the game has, fall back to an exponent
                // rather than printing the pile of digits that made this a bug
                if (scaled >= 1000) break
                return trimZeros(scaled.toFixed(3)) + suffix
            }
        }
        return n.toExponential(2)
    }

    function trimZeros(text) {
        return text.indexOf('.') === -1 ? text : text.replace(/\.?0+$/, '')
    }

    //* DURATIONS
    // largest first, so the first unit the value clears is the one used
    const DURATIONS = [
        [31557600, 'y'], // julian year, the same one the game's own stats use
        [604800, 'w'],
        [86400, 'd'],
        [3600, 'h'],
        [60, 'm'],
        [1, 's']
    ]

    //* formatDuration
    // seconds as something readable. A payback shown as "263949956031657248.0s"
    // is a number nobody can read and nobody can compare; the same figure is 8.36
    // billion years, which anyone can act on immediately.
    //
    // Years are the last real unit. Beyond that the count of years goes through
    // formatNumber, because a payback measured in billions of years only has to
    // communicate one thing, and it is not precision.
    function formatDuration(seconds) {
        if (!Number.isFinite(seconds)) return 'never'
        if (seconds < 0) return 'never'
        if (seconds < 1) return '<1s'

        for (const [size, unit] of DURATIONS) {
            if (seconds < size) continue
            const value = seconds / size
            if (unit === 'y' && value >= 1000) return `${formatNumber(value)} years`
            // one decimal while the number is small enough for it to mean
            // something, none once it is not
            return value < 10 ? `${trimZeros(value.toFixed(1))}${unit}` : `${Math.round(value)}${unit}`
        }
        return '<1s'
    }

    // expose on window so the other content-script files can use these (content
    // scripts share one global scope but are separate files)
    window.Alakazam = window.Alakazam || {}
    window.Alakazam.parse = {
        SUFFIXES,
        SHORT_SUFFIXES,
        MAGNITUDES,
        parseGameNumber,
        firstNumberIn,
        formatNumber,
        formatDuration
    }
})()
