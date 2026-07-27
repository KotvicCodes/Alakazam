// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Shimmer Grabbing
    // Golden cookies, wrath cookies and reindeer all render as .shimmer inside
    // #shimmers. They are only on screen for a few seconds, so this runs far more
    // often than anything else.

    const { simulateClick } = window.Alakazam.input
    const { registry } = window.Alakazam

    const INTERVAL_MS = 50

    function tick() {
        document.querySelectorAll('#shimmers .shimmer').forEach(sh => simulateClick(sh))
    }

    registry.register({ name: 'shimmers', interval: INTERVAL_MS, tick })
})()
