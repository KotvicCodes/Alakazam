// hold the rendered store back while the controls already reflect the new mode
function slowStore(h, delay = 160) {
    const observers = new Set()
    h.ctx.MutationObserver = class {
        constructor(callback) {
            this.callback = callback
        }
        observe() {
            observers.add(this)
        }
        disconnect() {
            observers.delete(this)
        }
    }
    const nodes = h.game.doc.querySelectorAll('.product .price')
    for (const node of nodes) {
        let shown = node.innerText
        Object.defineProperty(node, 'innerText', {
            get: () => shown,
            set: value => {
                setTimeout(() => {
                    shown = value
                    for (const observer of observers) observer.callback([{ target: node }])
                }, delay)
            }
        })
    }
}

module.exports = { slowStore }
