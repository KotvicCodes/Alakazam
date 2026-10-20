// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Drag
    // The pantheon is the one part of the game that cannot be driven by clicking.
    // Slotting a spirit is a drag, and it is not HTML5 drag-and-drop: the game
    // wires it by hand, roughly
    //
    //   AddEvent(l('templeGodDrag'+id), 'mousedown', e => { if (e.button==0) dragGod(...) })
    //   AddEvent(l('templeGodDrag'+id), 'mouseup',   e => { if (e.button==0) dropGod(...) })
    //   AddEvent(document, 'mouseup', dropGod)
    //
    // so a drag is just the right sequence of ordinary mouse events, which is
    // exactly what the fair-play input layer already dispatches. Two details
    // matter: the handlers test `button == 0`, and where a spirit lands is decided
    // by what the pointer was last over, so the target has to be hovered before
    // the release. The release is then sent to both the target and the document,
    // because the game listens on both and either may be the one that commits.

    const { hoverOn, hoverOff } = window.Alakazam.input

    //* dispatchAt
    // a single mouse event at an element's centre, with the left button set
    function dispatchAt(el, type) {
        if (!el) return false
        const rect = el.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const base = {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y,
            button: 0,
            buttons: 1
        }
        el.dispatchEvent(new MouseEvent(type, base))
        return true
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    //! dragTo
    // Pick up `source`, move over `target`, release. Returns false when either
    // element is missing rather than dispatching a half drag, because a drag left
    // open would leave the game holding a spirit under the player's cursor.
    async function dragTo(source, target, ctx = window.Alakazam.safety.context('pantheon')) {
        if (!source || !target) return false
        ctx.check()
        const lease = window.Alakazam.safety.acquire('tooltip', ctx.owner)
        if (!lease) return false
        let released = false
        let hoveredTarget = false
        let originalSlot = source
        while (originalSlot && !/^templeSlot\d+$/.test(originalSlot.id || '')) {
            originalSlot = originalSlot.parentElement || originalSlot.parent
        }
        try {
            ctx.input('hoverOn', source)
            ctx.check()
            dispatchAt(source, 'mousedown')
            await wait(60)
            ctx.check()
            if (!lease.valid()) return false
            ctx.input('hoverOn', target)
            hoveredTarget = true
            dispatchAt(target, 'mousemove')
            await wait(60)
            ctx.check()
            if (!lease.valid()) return false
            dispatchAt(target, 'mouseup')
            dispatchAt(document.body, 'mouseup')
            released = true
            return true
        } finally {
            try {
                if (!released) {
                    // Synthetic movement does not emit the slot's mouseout for us.
                    if (hoveredTarget) hoverOff(target)
                    // Dropping back onto the original slot preserves an equipped
                    // spirit without spending a swap; roster spirits return away.
                    const back = originalSlot || document.body
                    hoverOn(back)
                    dispatchAt(back, 'mousemove')
                    dispatchAt(back, 'mouseup')
                    if (originalSlot) hoverOff(originalSlot)
                }
                if (lease.valid()) {
                    hoverOff(target)
                    hoverOff(source)
                }
            } finally {
                lease.release()
            }
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.act = window.Alakazam.act || {}
    window.Alakazam.act.drag = { dragTo, dispatchAt }
})()
