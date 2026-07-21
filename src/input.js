// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
//! Fair-Play Input Layer
// The fair-play contract for this extension: act on the page only the way a
// human physically could, through real pointer and mouse events. Nothing here
// calls element.click() or any Cookie Clicker JS API (Game.ClickCookie,
// Object.buy, ...). Every click in the whole extension goes through
// simulateClick so this file is the single place the contract is enforced.

//* centerOf
// returns viewport coordinates a real cursor would sit at for this element
function centerOf(el) {
    const rect = el.getBoundingClientRect()
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
    }
}

//* dispatchMouse
// fires one bubbling, cancelable pointer/mouse event at the given coordinates
function dispatchMouse(el, type, x, y) {
    // pointer events first (modern handlers), then the mouse event of the same
    // phase, mirroring what a browser emits for real input
    const PointerCtor = window.PointerEvent || window.MouseEvent
    const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 }

    if (type === 'pointerdown' || type === 'pointerup' || type === 'pointermove') {
        el.dispatchEvent(new PointerCtor(type, { ...base, pointerId: 1, isPrimary: true, pointerType: 'mouse' }))
        return
    }
    el.dispatchEvent(new MouseEvent(type, base))
}

//* simulateClick
// a full human-like click: move the pointer over the element then run the
// down -> up -> click sequence. this is the only sanctioned way to act on the
// page. returns false when there is nothing to click.
function simulateClick(el) {
    if (!el) return false
    const { x, y } = centerOf(el)

    dispatchMouse(el, 'pointermove', x, y)
    dispatchMouse(el, 'mousemove', x, y)
    dispatchMouse(el, 'pointerdown', x, y)
    dispatchMouse(el, 'mousedown', x, y)
    dispatchMouse(el, 'pointerup', x, y)
    dispatchMouse(el, 'mouseup', x, y)
    dispatchMouse(el, 'click', x, y)
    return true
}

//* hoverOn / hoverOff
// the game draws its tooltips in response to real mouse movement, so the
// measurement layer needs to move the pointer onto an element to make the
// tooltip populate, read it, then move the pointer away.
function hoverOn(el) {
    if (!el) return false
    const { x, y } = centerOf(el)
    dispatchMouse(el, 'pointermove', x, y)
    dispatchMouse(el, 'mouseover', x, y)
    dispatchMouse(el, 'mousemove', x, y)
    return true
}

function hoverOff(el) {
    if (!el) return false
    const { x, y } = centerOf(el)
    dispatchMouse(el, 'mouseout', x, y)
    dispatchMouse(el, 'mouseleave', x, y)
    return true
}

//! Autoclicker Burst Dispatcher
// A real user clicks a few times a second; an autoclicker tool clicks many
// times a second. We keep every click a genuine dispatched event (fair-play),
// and simply issue a burst of them per animation frame. BURST_PER_FRAME is the
// throughput knob: raise it for more clicks, lower it if the tab stutters. Note
// the ceiling is the game's own click-handler cost, and a large burst is
// effectively superhuman even though each event is real.
const BURST_PER_FRAME = 50

let clickTarget = null
let burstRunning = false

function burstFrame() {
    if (!burstRunning) return
    if (clickTarget && clickTarget.isConnected) {
        for (let i = 0; i < BURST_PER_FRAME; i++) {
            simulateClick(clickTarget)
        }
    }
    requestAnimationFrame(burstFrame)
}

// startAutoclicker begins bursting clicks at the given element every frame
function startAutoclicker(el) {
    clickTarget = el
    if (!burstRunning) {
        burstRunning = true
        requestAnimationFrame(burstFrame)
    }
}

function stopAutoclicker() {
    burstRunning = false
    clickTarget = null
}

window.Alakazam = window.Alakazam || {}
window.Alakazam.input = {
    simulateClick,
    hoverOn,
    hoverOff,
    startAutoclicker,
    stopAutoclicker,
    BURST_PER_FRAME
}
})()
