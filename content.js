//

//! Main Script
console.log('Alakazam: Content script loaded')
const bigCookieQ = document.getElementById('bigCookie')

setTimeout(() => {
    setInterval(() => {
        bigCookieQ?.click()
        buyUpgrades()
        buyBakers()
        clickGoldenCookie()
    }, 1)

    achievementHunt()
}, 3000)

//* Buy bakers
function getCPS() {
    const cpsQ = document.getElementById('cookiesPerSecond')
    const cpsFull = cpsQ.innerText.replace('per second:', '').trim()

    const regex = /([\d,.]+)\s*(\w+)?/
    const match = cpsFull.match(regex)

    if (match) {
        const numberPart = match[1]
        if (match[2] === undefined) {
            return parseFloat(numberPart.replace(/,/g, ''))
        }
        const suffixPart = match[2]
        return numberPart * suffixes[suffixPart]
    }
    return 'mistakes were made'
}

//* Number suffixes
const suffixes = {
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

function buyBakers() {
    const bakers = document.querySelectorAll('.product.unlocked')
    bakers.forEach((upgrade) => upgrade.click())
}

//* Buy upgrades
function buyUpgrades() {
    const upgrades = document.querySelectorAll('.crate.upgrade')
    upgrades.forEach((upgrade) => upgrade.click())
}

//! Golden cookie clicker
function clickGoldenCookie() {
    const goldenCookieQ = document.querySelector('#shimmers .shimmer')
    if (goldenCookieQ) {
        goldenCookieQ.click()
    }
}

//! Achievement Hunt
function achievementHunt() {
    console.log('Achievement hunt started')

    tinyCookie()
    oldenDays()
    godComplex()
    setTimeout(() => {
        hereYouGo()
    }, 500)
    tabloidAddiction()
}

//* Tabloid addiction
function tabloidAddiction() {
    const commentsText1Q = document.getElementById('commentsText1')

    let clickCount = 0
    const clickInterval = setInterval(() => {
        if (clickCount >= 75) {
            clearInterval(clickInterval)
            return
        }
        commentsText1Q?.click()
        clickCount++
    }, 100)
}

//* Olden days
function oldenDays() {
    const logButtonQ = document.querySelector('#logButton div')
    logButtonQ?.click()

    const oldenDayButtonQ = document.querySelector('#oldenDays .icon')
    oldenDayButtonQ?.click()

    logButtonQ?.click()
}

//* God complex
function godComplex() {
    const bakeryNameQ = document.getElementById('bakeryName')
    bakeryNameQ.click()

    const bakeryNameInputQ = document.getElementById('bakeryNameInput')
    bakeryNameInputQ.value = 'Orteil'

    const confrimButtonQ = document.getElementById('promptOption0')
    confrimButtonQ.click()

    setTimeout(() => {
        const bakeryNameAfterQ = document.getElementById('bakeryName')
        bakeryNameAfterQ.click()
        const bakeryNameInputAfterQ = document.getElementById('bakeryNameInput')
        bakeryNameInputAfterQ.value = 'Alakazam'
        confrimButtonQ.click()
    }, 1000)
}

//* Here you go
function hereYouGo() {
    const statsQ = document.querySelector('#statsButton div')
    statsQ?.click()

    setTimeout(() => {
        const achievementSlotQ = document.querySelector('[data-id="204"]')
        achievementSlotQ?.click()
        statsQ?.click()
    }, 1000)
}

//* Tiny cookie
function tinyCookie() {
    const statsQ = document.querySelector('#statsButton div')
    statsQ?.click()

    const tinyCookieQ = document.querySelector('#statsGeneral .listing .price .tinyCookie')
    tinyCookieQ?.click()

    statsQ?.click()
}
