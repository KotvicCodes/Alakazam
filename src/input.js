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
        const pointer = type.startsWith('pointer')
        if (pointer && !window.PointerEvent) return
        const down = type === 'pointerdown' || type === 'mousedown'
        const counted = type === 'mousedown' || type === 'mouseup' || type === 'click'
        const base = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: x,
            clientY: y,
            button: type === 'pointermove' ? -1 : 0,
            buttons: down ? 1 : 0,
            detail: counted ? 1 : 0
        }
        const Ctor = pointer || type === 'click' ? window.PointerEvent || MouseEvent : MouseEvent
        el.dispatchEvent(
            new Ctor(type, {
                ...base,
                pointerId: 1,
                isPrimary: true,
                pointerType: 'mouse',
                pressure: down ? 0.5 : 0
            })
        )
    }

    function clickAt(el, x, y) {
        dispatchMouse(el, 'pointermove', x, y)
        dispatchMouse(el, 'mousemove', x, y)
        dispatchMouse(el, 'pointerdown', x, y)
        dispatchMouse(el, 'mousedown', x, y)
        dispatchMouse(el, 'pointerup', x, y)
        dispatchMouse(el, 'mouseup', x, y)
        dispatchMouse(el, 'click', x, y)
        return true
    }

    //* simulateClick
    // pointer activation has a click count of one. Keyboard/assistive activation
    // intentionally has detail zero and no pointer down/up sequence; the game's
    // special handling of those clicks must remain available.
    function simulateClick(el, { source = 'pointer' } = {}) {
        if (!el) return false
        if (source === 'keyboard') {
            el.dispatchEvent(
                new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    view: window,
                    detail: 0,
                    button: 0,
                    buttons: 0,
                    clientX: 0,
                    clientY: 0
                })
            )
            return true
        }
        const { x, y } = centerOf(el)
        return clickAt(el, x, y)
    }

    //* simulateClickAt
    // offsets are CSS pixels from the target's top left, for canvas hit testing
    function simulateClickAt(el, offsetX, offsetY) {
        if (!el) return false
        const rect = el.getBoundingClientRect()
        return clickAt(el, rect.left + offsetX, rect.top + offsetY)
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
