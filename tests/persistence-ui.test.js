const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { boot, waitFor } = require('./harness')
const { El } = require('./dom')
const { storageFixture } = require('./storage')
const fx = require('./fixtures')

async function popupScene() {
    const storage = storageFixture()
    const tab = boot({ storage, save: fx.save().raw })
    await tab.A.store.ready('game')
    const popup = boot({ storage })
    const doc = popup.game.doc
    for (const id of [
        'version',
        'error',
        'pauseBtn',
        'refreshBtn',
        'statusLine',
        'identity',
        'updated',
        'decision',
        'saveState',
        'controls',
        'gameData',
        'cookies',
        'cps',
        'buildings',
        'diagnostics'
    ])
        doc.body.append(new El('div', { id }))
    const get = popup.ctx.chrome.storage.local.get
    popup.ctx.chrome.storage.local.get = (keys, callback) =>
        get(typeof keys === 'string' ? [keys] : keys, callback)
    const snapshot = { ...tab.A.status.snapshot(), tabId: 1 }
    storage.disk['status:tab:1'] = snapshot
    popup.ctx.chrome.runtime.getManifest = () => ({ version: 'test' })
    popup.ctx.chrome.tabs = {
        query: (options, callback) =>
            callback([{ id: 1, url: 'https://orteil.dashnet.org/cookieclicker/' }]),
        sendMessage: (id, message, callback) => callback({ status: snapshot })
    }
    let periodic
    popup.ctx.setInterval = fn => ((periodic = fn), 0)
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8'), popup.ctx)
    doc.fire('DOMContentLoaded', {})
    assert.ok(await waitFor(() => doc.getElementById('identity').textContent.includes('Tab 1')))
    return {
        storage,
        tab,
        popup,
        doc,
        refresh: () => periodic(),
        retry: () => doc.getElementById('refreshBtn').listeners.click[0](),
        toggle: key => doc.querySelector(`[data-key="${key}"]`).listeners.click[0]()
    }
}

test('popup retains failed settings errors across successful status reads until a durable retry', async () => {
    const p = await popupScene()
    const error = p.doc.getElementById('error')
    const control = p.doc.querySelector('[data-key="purchase"]')
    p.storage.failNext('set', 'quota exceeded')
    await p.toggle('purchase')
    for (let i = 0; i < 3; i++) await p.refresh()
    assert.equal(p.popup.A.store.stats().pending, 1)
    assert.equal(p.popup.A.store.setting('purchase'), false)
    assert.equal(p.tab.A.store.setting('purchase'), true)
    assert.equal(control.getAttribute('aria-pressed'), 'false')
    assert.equal(error.hidden, false)
    assert.match(error.textContent, /Could not save settings: quota exceeded/)

    p.storage.failNext('set', 'still unavailable')
    await p.retry()
    assert.equal(error.hidden, false)
    assert.match(error.textContent, /still unavailable/)
    assert.equal(p.tab.A.store.setting('purchase'), true)
    await p.retry()
    assert.equal(p.popup.A.store.stats().pending, 0)
    assert.equal(p.tab.A.store.setting('purchase'), false)
    assert.equal(error.hidden, true)
    assert.equal(p.doc.querySelector('[data-key="purchase"]'), control)
})

test('popup keeps save and status failures separately and synchronizes a retry even without status', async () => {
    const p = await popupScene()
    const error = p.doc.getElementById('error')
    p.storage.failNext('set', 'quota exceeded')
    await p.toggle('purchase')
    p.storage.failNext('get', 'status unavailable')
    await p.refresh()
    assert.match(error.textContent, /quota exceeded/)
    assert.match(error.textContent, /status unavailable/)

    // A successful retry must show any newer setting received during the write,
    // even if the subsequent status read fails.
    const callback = p.storage.deferNextSetCallback()
    const retry = p.retry()
    const finish = await callback
    p.tab.A.store.setSetting('purchase', true)
    await p.tab.A.store.flush()
    p.storage.failNext('get', 'status unavailable')
    finish()
    await retry
    assert.equal(p.popup.A.store.stats().pending, 0)
    assert.equal(p.doc.querySelector('[data-key="purchase"]').getAttribute('aria-pressed'), 'true')
    assert.doesNotMatch(error.textContent, /Could not save settings/)
    assert.match(error.textContent, /status unavailable/)
    assert.equal(error.hidden, false)
    await p.refresh()
    assert.equal(error.hidden, true)
})

function drag(h) {
    const panel = h.game.doc.getElementById('alakazam-hud')
    const head = h.game.doc.getElementById('alakazam-hud-head')
    panel.getBoundingClientRect = () => ({
        left: parseFloat(panel.style.left),
        top: parseFloat(panel.style.top)
    })
    return (type, x, y) =>
        head.dispatchEvent({
            type,
            pointerId: 1,
            button: 0,
            isTrusted: true,
            clientX: x,
            clientY: y,
            preventDefault() {}
        })
}

for (const position of [null, { left: '75px', top: '120px' }]) {
    test(`HUD reloads family preferences without replacing controls (${position ? 'saved position' : 'dock'})`, async () => {
        const entries = { CookieClickerGame: fx.save().raw }
        const h = boot({ localStorage: { getItem: key => entries[key] || null } })
        await h.A.save.connect()
        h.A.store.set('hudDock', 'top-left')
        h.A.store.set('hudFolded', false)
        await h.A.store.flush()
        h.A.registry.get('hud').setup()
        const doc = h.game.doc
        const panel = doc.getElementById('alakazam-hud')
        const control = doc.querySelector('[data-key="purchase"]')
        const pointer = drag(h)
        pointer('pointerdown', 18, 50)
        pointer('pointermove', 500, 300)
        const next = fx.save({ fullDate: 1750000005000 }).raw
        const who = boot({ save: next }).A.identity.current()
        const scope = 'legacy:' + who.familyId
        h.disk[h.A.store.fieldKey(scope, 'hudDock')] = { value: 'bottom-center' }
        h.disk[h.A.store.fieldKey(scope, 'hudFolded')] = { value: true }
        if (position) h.disk[h.A.store.fieldKey(scope, 'hudPosition')] = { value: position }
        entries.CookieClickerGame = next
        await h.A.registry.get('saveWatch').tick()
        assert.equal(doc.getElementById('alakazam-hud'), panel)
        assert.equal(doc.querySelector('[data-key="purchase"]'), control)
        assert.equal(doc.getElementById('alakazam-hud-dock').textContent, 'Dock: bottom center')
        assert.equal(doc.getElementById('alakazam-hud-body').hidden, true)
        assert.equal(doc.getElementById('alakazam-hud-fold').getAttribute('aria-expanded'), 'false')
        assert.equal(panel.style.left, position?.left || '586px')
        assert.equal(panel.style.top, position?.top || '692px')
        assert.equal(doc.getElementById('alakazam-hud-head').hasPointerCapture(1), false)
        pointer('pointerup', 500, 300)
        assert.deepEqual(JSON.parse(JSON.stringify(h.A.store.get('hudPosition', null))), position)
        await h.A.store.flush()
    })
}

test('same-family reconciliation preserves manual folding and an active HUD drag', async () => {
    const entries = { CookieClickerGame: fx.save().raw }
    const h = boot({ localStorage: { getItem: key => entries[key] || null } })
    await h.A.save.connect()
    h.A.registry.get('hud').setup()
    const doc = h.game.doc
    doc.getElementById('alakazam-hud-fold').listeners.click[0]()
    const pointer = drag(h)
    pointer('pointerdown', 18, 702)
    pointer('pointermove', 500, 300)
    const panel = doc.getElementById('alakazam-hud')
    const before = { ...panel.style }
    entries.CookieClickerGame = fx.save({ seed: 'other', resets: 1 }).raw
    await h.A.registry.get('saveWatch').tick()
    h.A.registry.get('hud').tick()
    assert.equal(doc.getElementById('alakazam-hud-body').hidden, false)
    assert.equal(doc.getElementById('alakazam-hud-head').hasPointerCapture(1), true)
    assert.deepEqual(panel.style, before)
    pointer('pointerup', 500, 300)
    assert.equal(h.A.store.get('hudPosition').left, before.left)
    assert.equal(h.A.store.get('hudPosition').top, before.top)
    await h.A.store.flush()
})
