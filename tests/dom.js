//! Minimal DOM
// Just enough of a document for the content scripts to run under node: elements
// with ids, classes, children, inline style and text, plus a selector engine that
// understands the handful of selector shapes the extension actually uses
// (#id, .class, tag, compounds like .product.unlocked, and descendants).

class El {
    constructor(tag, opts = {}) {
        this.tagName = (tag || 'div').toUpperCase()
        this.id = opts.id || ''
        this.classes = new Set((opts.class || '').split(' ').filter(Boolean))
        this.children = []
        this.parent = null
        this.style = opts.style || {}
        this.text = opts.text || ''
        this.value = ''
        this.isConnected = true
        this.events = []
        this.listeners = {}
    }

    get className() {
        return Array.from(this.classes).join(' ')
    }

    get classList() {
        const self = this
        return {
            contains: c => self.classes.has(c),
            add: c => self.classes.add(c),
            remove: c => self.classes.delete(c),
            toggle(c) {
                if (self.classes.has(c)) {
                    self.classes.delete(c)
                    return false
                }
                self.classes.add(c)
                return true
            },
            [Symbol.iterator]: () => self.classes[Symbol.iterator]()
        }
    }

    get textContent() {
        return this.text
    }
    set textContent(v) {
        this.text = v
    }

    // no HTML parsing here: setting innerHTML records the markup so tests can
    // assert on it, but the resulting children are not queryable
    get innerHTML() {
        return this.html || ''
    }
    set innerHTML(v) {
        this.html = v
        this.children = []
    }

    appendChild(kid) {
        return this.append(kid)
    }

    setAttribute(name, value) {
        this.attrs = this.attrs || {}
        this.attrs[name] = value
    }

    getAttribute(name) {
        return (this.attrs || {})[name]
    }

    preventDefault() {}

    //* contains
    // Node.contains: true for the node itself and for any descendant. used by the
    // panel to tell a grab on the fold button from a grab on the header.
    contains(node) {
        if (!node) return false
        if (node === this) return true
        return this.children.some(kid => kid.contains && kid.contains(node))
    }

    get firstChild() {
        return this.children[0] || null
    }

    // enough layout for code that positions itself
    get offsetWidth() {
        return 268
    }
    get offsetHeight() {
        return 200
    }

    setPointerCapture(id) {
        this.captured = id
    }
    releasePointerCapture() {
        this.captured = null
    }
    hasPointerCapture(id) {
        return this.captured === id
    }

    get innerText() {
        if (this.text) return this.text
        return this.children
            .map(c => c.innerText)
            .filter(Boolean)
            .join('\n')
    }
    set innerText(v) {
        this.text = v
        this.children = []
    }

    append(...kids) {
        for (const k of kids) {
            k.parent = this
            this.children.push(k)
        }
        return this
    }

    getBoundingClientRect() {
        return { left: 0, top: 0, width: 20, height: 20 }
    }

    addEventListener(type, fn) {
        ;(this.listeners[type] = this.listeners[type] || []).push(fn)
    }

    dispatchEvent(ev) {
        // the target is the node the event was dispatched on and stays fixed as it
        // bubbles, which is the whole point of target: a handler on an ancestor
        // has to be able to tell which descendant was actually hit. a caller that
        // sets one explicitly is simulating exactly that, so it is left alone.
        if (!ev.target) ev.target = this
        this.events.push(ev.type)
        let node = this
        while (node) {
            for (const fn of node.listeners[ev.type] || []) fn(ev)
            node = node.parent
        }
        return true
    }

    descendants() {
        const out = []
        const walk = n => {
            for (const c of n.children) {
                out.push(c)
                walk(c)
            }
        }
        walk(this)
        return out
    }

    matches(sel) {
        // pull attribute selectors out first, since they contain characters the
        // simple tokeniser below would mistake for tag names
        const attrs = []
        const rest = sel.replace(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g, (m, name, value) => {
            attrs.push([name, value])
            return ''
        })
        for (const [name, value] of attrs) {
            const actual = this.getAttribute(name)
            if (actual === undefined || actual === null) return false
            if (value !== undefined && String(actual) !== value) return false
        }

        // one compound term: tag / #id / .class, concatenated
        const parts = rest.match(/[#.]?[\w-]+/g) || []
        for (const p of parts) {
            if (p[0] === '#') {
                if (this.id !== p.slice(1)) return false
            } else if (p[0] === '.') {
                if (!this.classes.has(p.slice(1))) return false
            } else if (this.tagName !== p.toUpperCase()) return false
        }
        return true
    }

    querySelectorAll(sel) {
        // support comma groups and descendant combinators
        const groups = sel
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        const found = new Set()
        for (const group of groups) {
            const terms = group.split(/\s+/).filter(Boolean)
            let pool = this.descendants()
            for (let i = 0; i < terms.length; i++) {
                const term = terms[i]
                if (term === '+' || term === '~' || term === '>') continue
                const prev = terms[i - 1]
                if (prev === '+' || prev === '~') {
                    // sibling combinators: approximate by matching within parent
                    pool = pool.filter(e => e.matches(term))
                    continue
                }
                const next = []
                for (const e of pool) if (e.matches(term)) next.push(e)
                pool = i === terms.length - 1 ? next : next.flatMap(e => e.descendants())
            }
            for (const e of pool) found.add(e)
        }
        const arr = Array.from(found)
        arr.forEach = Array.prototype.forEach.bind(arr)
        return arr
    }

    querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null
    }
}

function makeDocument() {
    const root = new El('body')
    const doc = {
        body: root,
        head: new El('head'),
        documentElement: root,
        listeners: {},
        getElementById(id) {
            return root.descendants().find(e => e.id === id) || null
        },
        querySelector(sel) {
            return root.querySelector(sel)
        },
        querySelectorAll(sel) {
            return root.querySelectorAll(sel)
        },
        createElement(tag) {
            return new El(tag)
        },
        addEventListener(type, fn) {
            ;(doc.listeners[type] = doc.listeners[type] || []).push(fn)
        },
        fire(type, ev) {
            for (const fn of doc.listeners[type] || []) fn(ev)
        }
    }
    return doc
}

module.exports = { El, makeDocument }
