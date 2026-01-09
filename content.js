//

console.log('Alakazam: Content script loaded')

const bigCookieQ = document.getElementById('bigCookie')

setInterval(() => {
    bigCookieQ?.click()
    buyUpgrades()
    buyBakers()
}, 1)

function buyBakers() {
    const bakers = document.querySelectorAll('.product.unlocked')
    bakers.forEach((upgrade) => upgrade.click())
}

function buyUpgrades() {
    const upgrades = document.querySelectorAll('.crate.upgrade')
    upgrades.forEach((upgrade) => upgrade.click())
}
