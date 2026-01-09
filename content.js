//

console.log('Alakazam: Content script loaded')
const bigCookieQ = document.getElementById('bigCookie')

setTimeout(() => {
    setInterval(() => {
        bigCookieQ?.click()
        buyUpgrades()
        buyBakers()
    }, 1)

    achievementHunt()
}, 3000)

function buyBakers() {
    const bakers = document.querySelectorAll('.product.unlocked')
    bakers.forEach((upgrade) => upgrade.click())
}

function buyUpgrades() {
    const upgrades = document.querySelectorAll('.crate.upgrade')
    upgrades.forEach((upgrade) => upgrade.click())
}

//! Achievement Hunt
function achievementHunt() {
    console.log('Achievement hunt started')

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