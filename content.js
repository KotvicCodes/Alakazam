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

function achievementHunt() {
    console.log('Achievement hunt started')
    //* Tabloid addiction
    const commentsTextQ = document.getElementById('commentsText')
    const commentsText1Q = document.getElementById('commentsText1')
    const commentsText2Q = document.getElementById('commentsText2')

    const clickInterval = setInterval(() => {
        const achievementTitle = document.querySelector('h5 .title')?.innerText
        const tabloidAddictionAchieved = achievementTitle === 'Tabloid addiction'

        if (tabloidAddictionAchieved) {
            console.log('Tabloid addiction achieved!')
            clearInterval(clickInterval)
        } else {
            commentsTextQ?.click()
            commentsText1Q?.click()
            commentsText2Q?.click()
            console.log('clicking for tabloid addiction')
        }
    }, 100)
}
