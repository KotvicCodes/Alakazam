// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Fair-Play Input Layer
    // The fair-play contract for this extension: act on the page only the way a
    // human physically could, through real pointer and mouse events. Nothing here
    // calls element.click() or any Cookie Clicker JS API (Game.ClickCookie,
    // Object.buy, ...). Every click in the whole extension goes through
    // simulateClick so this file is the single place the contract is enforced.
    //
    // There is one thing a pointer cannot do, and typeInto is it: two of the game's
    // own text fields are written to. It lives here so that the exception is in the
    // same file as the rule rather than tucked into whichever module needed it.

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
            el.dispatchEvent(
                new PointerCtor(type, { ...base, pointerId: 1, isPrimary: true, pointerType: 'mouse' })
            )
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

    //* simulateClickAt
    // a click at a chosen point inside an element, given in the element's own CSS
    // pixels from its top left corner. Same events in the same order as
    // simulateClick, which is the part that matters: the only difference is where
    // the pointer is said to be.
    //
    // This exists because not everything the game draws is an element. The dragon
    // and Santa tabs are painted onto a background canvas and hit-tested against
    // the mouse position, so clicking the canvas is only half of it: the event has
    // to carry coordinates that land on the tab. A centre click on a canvas that
    // fills the left column would land on nothing at all.
    function simulateClickAt(el, offsetX, offsetY) {
        if (!el) return false
        const rect = el.getBoundingClientRect()
        const x = rect.left + offsetX
        const y = rect.top + offsetY

        dispatchMouse(el, 'pointermove', x, y)
        dispatchMouse(el, 'mousemove', x, y)
        dispatchMouse(el, 'pointerdown', x, y)
        dispatchMouse(el, 'mousedown', x, y)
        dispatchMouse(el, 'pointerup', x, y)
        dispatchMouse(el, 'mouseup', x, y)
        dispatchMouse(el, 'click', x, y)
        return true
    }

    //* typeInto
    // fill one of the game's own text fields: set the value and fire the events the
    // game listens for.
    //
    // This is the one place the extension does something a pointer cannot do, and it
    // is here rather than in the two modules that need it so that it is as visible
    // and as countable as every click. Two fields are ever written to: the bakery
    // name, for an achievement that asks for a particular one, and the gift code
    // box, because a code cannot be clicked into existence. Both values are ours,
    // and the game validates what it receives either way.
    function typeInto(el, text) {
        if (!el) return false
        el.value = text
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
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

    // the autoclicker's burst loop used to live here. it owns cadence rather than
    // input mechanics, so it is a scheduler module now: see modules/autoclick.js

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.input = {
        simulateClick,
        simulateClickAt,
        typeInto,
        hoverOn,
        hoverOff
    }
})()
