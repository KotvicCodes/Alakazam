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
// ("134B", "1.234Qa", "5.6Qi") instead of full words. Keys are lowercase because
// parseGameNumber lowercases the text first. These match the game's own scheme:
// M/B/T then Qa/Qi/Sx/Sp/Oc/No/Dc, and the *-decillion family as <prefix>D.
// The single-letter and mid-range entries cover essentially all normal play;
// the very high tail (past vigintillion) is worth a live sanity-check, and long
// and scientific display modes are already fully covered elsewhere.
const SHORT_SUFFIXES = {
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
    vg: 10 ** 63
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

// expose on window so the other content-script files can use these (content
// scripts share one global scope but are separate files)
window.Alakazam = window.Alakazam || {}
window.Alakazam.parse = { SUFFIXES, SHORT_SUFFIXES, parseGameNumber, firstNumberIn }
