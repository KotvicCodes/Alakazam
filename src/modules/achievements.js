// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Achievement Hunt
    // One-off routines that unlock free achievements a human could also trigger by
    // poking the UI. All clicks route through simulateClick to honour fair-play.
    //
    // Moved here from main.js unchanged. It still re-runs every page load and
    // still leaves the bakery renamed; both are fixed once this module is driven
    // by the achievements bitfield in the save.

    const { simulateClick } = window.Alakazam.input
    const { registry } = window.Alakazam

    function setup() {
        console.log('Alakazam: achievement hunt started')
        tinyCookie()
        oldenDays()
        godComplex()
        setTimeout(hereYouGo, 500)
        tabloidAddiction()
    }

    // the hunt is one-off work done in setup; the periodic tick earns its keep
    // once this module starts reading which achievements are actually missing
    function tick() {}

    //* typeInto
    // fill a text field the way a user would: set the value and fire input/change
    function typeInto(el, text) {
        if (!el) return
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
    }

    //* Tabloid addiction: click the news ticker repeatedly
    function tabloidAddiction() {
        const comments = document.getElementById('commentsText1')
        let clicks = 0
        const timer = setInterval(() => {
            if (clicks >= 75) {
                clearInterval(timer)
                return
            }
            simulateClick(comments)
            clicks++
        }, 100)
    }

    //* Olden days: open the info log and click the credits entry
    function oldenDays() {
        const logButton = document.querySelector('#logButton div')
        simulateClick(logButton)
        simulateClick(document.querySelector('#oldenDays .icon'))
        simulateClick(logButton)
    }

    //* God complex: rename the bakery to "Orteil", then back
    function godComplex() {
        const bakeryName = document.getElementById('bakeryName')
        simulateClick(bakeryName)
        typeInto(document.getElementById('bakeryNameInput'), 'Orteil')
        simulateClick(document.getElementById('promptOption0'))

        setTimeout(() => {
            simulateClick(document.getElementById('bakeryName'))
            typeInto(document.getElementById('bakeryNameInput'), 'Alakazam')
            simulateClick(document.getElementById('promptOption0'))
        }, 1000)
    }

    //* Here you go: open stats and click a specific achievement slot
    function hereYouGo() {
        const statsButton = document.querySelector('#statsButton div')
        simulateClick(statsButton)
        setTimeout(() => {
            simulateClick(document.querySelector('[data-id="204"]'))
            simulateClick(statsButton)
        }, 1000)
    }

    //* Tiny cookie: click the tiny cookie in the stats panel
    function tinyCookie() {
        const statsButton = document.querySelector('#statsButton div')
        simulateClick(statsButton)
        simulateClick(document.querySelector('#statsGeneral .listing .price .tinyCookie'))
        simulateClick(statsButton)
    }

    registry.register({ name: 'achievements', interval: 30000, setup, tick })
})()
