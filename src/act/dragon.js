// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Dragon Controls
    // Everything that touches Krumblor's own furniture. It is separated from the
    // module for the same reason act/drag.js is: the sequence of events that makes
    // the game notice is fiddly and worth documenting once, away from the policy
    // that decides what to do.
    //
    //! Opening the panel is the hard part
    // The dragon's tab is not an element. It is painted onto the left background
    // canvas, and the game hit-tests it against the mouse position on its own logic
    // frame, requiring all three of: the pointer inside the tab's box, a click, and
    // that click's target being the canvas itself. So a plain click on the canvas
    // does nothing, because it lands in the middle of a column-high element and the
    // tab is a 48 pixel square near the bottom.
    //
    // The tabs are laid out from the bottom of the canvas: with `n` tabs the first
    // sits at `height - 24 - 48n` and each next one 48 lower, which puts the last
    // tab at `height - 72` however many there are. Santa, when he exists at all, is
    // always listed before the dragon, so the dragon is always last, and always at
    // (24, height - 72) in the canvas's own coordinates. The box is 48 wide, and
    // when a tab is already selected it grows and shifts right, so that one point is
    // inside it either way and one click both opens and closes.
    //
    // Canvas coordinates are the game's coordinates: the canvas sits at the page
    // origin and the game divides page position by its zoom. So the conversion is
    // the canvas's rendered size over its pixel size, which is readable from the
    // element, and Game.scale never has to be guessed at.
    //
    //! And it can be stolen
    // The check is `lastClickedEl == the canvas`, and the autoclicker sets that
    // field fifteen times a second on the big cookie. A tab click issued while it
    // runs is lost about as often as it lands, so the caller is expected to hold the
    // scheduler still for the moment this takes, and every open here is verified
    // against what actually appeared rather than assumed.

    const { simulateClick, simulateClickAt } = window.Alakazam.input

    // the last tab's centre, in the canvas's own pixels
    const TAB_X = 24
    const TAB_FROM_BOTTOM = 72

    // the game redraws the popup on its own loop, so give it a couple of frames
    const DRAW_MS = 150

    // the prompt this file is allowed to confirm, by the id the game gives it
    const AURA_PROMPT = 'promptContentPickDragonAura'

    function el(id) {
        return document.getElementById(id)
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    //* handlerOf
    // the game writes its click handlers as inline attributes, onclick on a desktop
    // and ontouchend on a touch device. Reading the attribute is how an aura crate is
    // identified: the id it passes to the game is in there, and the crates are
    // otherwise identical squares in an order that depends on what is already
    // slotted.
    function handlerOf(node) {
        if (!node || !node.getAttribute) return ''
        return node.getAttribute('onclick') || node.getAttribute('ontouchend') || ''
    }

    function canvas() {
        return el('backgroundLeftCanvas')
    }

    //* tabPoint
    // where to click, in the canvas element's own CSS pixels
    function tabPoint(cv) {
        const rect = cv.getBoundingClientRect()
        const scaleX = cv.width ? rect.width / cv.width : 1
        const scaleY = cv.height ? rect.height / cv.height : 1
        return {
            x: TAB_X * scaleX,
            y: Math.max(0, cv.height - TAB_FROM_BOTTOM) * scaleY
        }
    }

    //* panelOpen
    // whether the dragon's panel is the one on screen. The popup is shared with
    // Santa and is emptied when closed, so neither its presence nor its heading is
    // the answer: the portrait's own sprite is, and it is dragon.png for exactly one
    // of the two.
    function panelOpen() {
        const pic = el('specialPic')
        if (!pic || !pic.getAttribute) return false
        const style = pic.getAttribute('style') || ''
        return style.indexOf('dragon.png') !== -1
    }

    //* open
    // click the tab and check. Returns false rather than clicking twice when nothing
    // appeared: a second click on a tab that did open would close it again.
    async function open() {
        if (panelOpen()) return true
        const cv = canvas()
        if (!cv) return false
        const { x, y } = tabPoint(cv)
        simulateClickAt(cv, x, y)
        await wait(DRAW_MS)
        return panelOpen()
    }

    //* close
    // through the popup's own close button, which is an element and cannot be
    // mistimed, rather than a second canvas click
    async function close() {
        const popup = el('specialPopup')
        const button = popup && popup.querySelector ? popup.querySelector('.close') : null
        if (!button) return false
        simulateClick(button)
        await wait(DRAW_MS)
        return !panelOpen()
    }

    //* nextStep
    // the training button, what it would train, and whether the game says the
    // sacrifice can be paid. The cost cell greys itself out when it cannot, which is
    // the game's own affordability check handed to us for free: no cost model here
    // can disagree with it.
    function nextStep() {
        const button = document.querySelector('#specialPopup .optionBox a.option')
        if (!button) return null
        const cells = button.querySelectorAll ? button.querySelectorAll('div') : []
        const label = ((cells[0] && cells[0].innerText) || button.innerText || '').trim()
        let greyed = false
        for (const cell of cells) {
            if ((cell.getAttribute('style') || '').indexOf('777') !== -1) greyed = true
        }
        return { label, affordable: !greyed, element: button }
    }

    //* train
    // one level, and only when the game says it is paid for
    function train() {
        const step = nextStep()
        if (!step || !step.affordable) return false
        return simulateClick(step.element)
    }

    //* auraCrate
    // the little square that opens the picker for one slot. Identified by the slot
    // number in its handler, because the second slot only exists on a fully trained
    // dragon and position alone would then mean two different things.
    function auraCrate(slot) {
        const popup = el('specialPopup')
        if (!popup || !popup.querySelectorAll) return null
        for (const crate of popup.querySelectorAll('.crate')) {
            if (handlerOf(crate).indexOf(`Game.SelectDragonAura(${slot})`) !== -1) return crate
        }
        return null
    }

    function pickerOpen() {
        return !!el(AURA_PROMPT)
    }

    //* choices
    // every aura the picker is offering, with the id the game will act on. The row
    // holds one square per trained aura, minus whatever the other slot is holding,
    // so the nth square is not aura n and never was.
    function choices() {
        const prompt = el(AURA_PROMPT)
        if (!prompt || !prompt.querySelectorAll) return []
        const out = []
        for (const crate of prompt.querySelectorAll('.crate')) {
            const match = /Game\.SetDragonAura\((\d+),(\d+)\)/.exec(handlerOf(crate))
            if (match) out.push({ aura: Number(match[1]), slot: Number(match[2]), element: crate })
        }
        return out
    }

    //* setAura
    // the whole sequence: open the picker, highlight an aura, confirm. Confirming
    // sacrifices one of the highest building owned, so this is not a free action and
    // the caller is expected to have decided it is worth one.
    //
    // The confirm is guarded the way act/ascend.js guards its own: #promptOption0 is
    // whatever prompt happens to be open, so the prompt has to name itself first.
    async function setAura(auraId, slot) {
        if (!panelOpen()) return false

        if (!pickerOpen()) {
            const crate = auraCrate(slot)
            if (!crate) return false
            simulateClick(crate)
            await wait(DRAW_MS)
            if (!pickerOpen()) return false
        }

        const choice = choices().find(c => c.aura === auraId && c.slot === slot)
        if (!choice) {
            await cancel()
            return false
        }
        simulateClick(choice.element)
        // picking redraws the prompt, so nothing read before this point is still live
        await wait(DRAW_MS)

        if (!pickerOpen()) return false
        const confirm = el('promptOption0')
        if (!confirm) return false
        simulateClick(confirm)
        await wait(DRAW_MS)
        return !pickerOpen()
    }

    //* cancel
    // the picker's second option. Used when the aura we wanted is not on offer,
    // which means the dragon knows less than the save said it did.
    async function cancel() {
        if (!pickerOpen()) return false
        const button = el('promptOption1')
        if (!button) return false
        simulateClick(button)
        await wait(DRAW_MS)
        return !pickerOpen()
    }

    //* pet
    // one scratch. The drop roll is the game's, one in twenty, and it only happens
    // at all once the dragon is grown enough for it.
    function pet() {
        if (!panelOpen()) return false
        return simulateClick(el('specialPic'))
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.act = window.Alakazam.act || {}
    window.Alakazam.act.dragon = {
        panelOpen,
        open,
        close,
        nextStep,
        train,
        auraCrate,
        pickerOpen,
        choices,
        setAura,
        cancel,
        pet,
        tabPoint
    }
})()
