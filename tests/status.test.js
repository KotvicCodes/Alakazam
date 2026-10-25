const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./harness')
const fx = require('./fixtures')

test('hidden boot can construct the HUD later and preserves its controls on updates', async () => {
    const h = boot({ disk: { settings: { hud: false, enabled: false } } })
    await h.A.store.ready('t')
    h.A.registry.get('hud').setup()
    assert.equal(h.game.doc.getElementById('alakazam-hud'), null)
    h.A.store.setSetting('hud', true)
    const control = h.game.doc.querySelector('[data-key="purchase"]')
    assert.equal(control.tagName, 'BUTTON')
    assert.equal(control.getAttribute('aria-pressed'), 'true')
    for (let i = 0; i < 3; i++) h.A.hud.render()
    assert.equal(h.game.doc.querySelector('[data-key="purchase"]'), control)
    assert.equal(h.game.doc.getElementById('alakazam-hud-pause').textContent, 'Resume')
    h.A.store.setSetting('hud', false)
    assert.equal(h.game.doc.getElementById('alakazam-hud').hidden, true)
})

test('HUD rows stay in summary order when readings appear, disappear and return', async () => {
    const h = boot({ save: fx.save({}).raw })
    await h.A.store.ready('t')
    h.A.registry.get('hud').setup()
    const body = h.game.doc.getElementById('alakazam-hud-body')
    const control = body.querySelector('[data-key="purchase"]')
    const rows = () => body.querySelectorAll('.az-row')
    const labels = () =>
        rows()
            .filter(node => !node.hidden)
            .map(node => node.firstChild.textContent)

    h.debug().garden = { unlocked: 1, goal: 'grow' }
    h.A.hud.render()
    const gardenRow = rows().find(node => node.firstChild.textContent === 'seeds')

    h.debug().decision = { action: 'wait', reason: 'saving', payback: 12 }
    h.debug().dragon = { level: 1, max: 27, aura: 'No aura' }
    h.debug().lumps = { lumps: 3, type: 'normal', ripe: true, lifeSpanHours: 24, measured: true }
    h.A.hud.render()
    assert.deepEqual(labels().slice(0, 6), [
        'clicks',
        'click measurement',
        'decision',
        'payback',
        'dragon',
        'read'
    ])
    assert.deepEqual(
        body.querySelectorAll('.az-sec').map(node => node.textContent),
        ['game', 'save', 'sugar lumps', 'garden']
    )
    const entries = Array.from(body.querySelectorAll('div')).filter(
        node => node.classList.contains('az-sec') || node.classList.contains('az-row')
    )
    assert.deepEqual(
        entries.slice(0, 8).map(node => node.firstChild?.textContent || node.textContent),
        ['game', 'clicks', 'click measurement', 'decision', 'payback', 'dragon', 'save', 'read']
    )
    const dragonRow = rows().find(node => node.firstChild.textContent === 'dragon')

    const clickStats = h.A.clicks.stats()
    h.A.clicks.stats = () => ({ ...clickStats, clickCps: 42 })
    delete h.debug().dragon
    delete h.debug().garden
    h.A.hud.render()
    assert.deepEqual(labels().slice(0, 7), [
        'from clicking',
        'effective',
        'clicks',
        'click measurement',
        'decision',
        'payback',
        'read'
    ])
    assert.equal(dragonRow.hidden, true)
    assert.equal(gardenRow.hidden, true)

    h.debug().dragon = { level: 2, max: 27, aura: 'No aura' }
    h.debug().garden = { unlocked: 2, goal: 'grow' }
    h.A.hud.render()
    assert.deepEqual(labels().slice(0, 8), [
        'from clicking',
        'effective',
        'clicks',
        'click measurement',
        'decision',
        'payback',
        'dragon',
        'read'
    ])
    assert.equal(
        rows().find(node => node.firstChild.textContent === 'dragon'),
        dragonRow
    )
    assert.equal(
        rows().find(node => node.firstChild.textContent === 'seeds'),
        gardenRow
    )
    assert.equal(dragonRow.hidden, false)
    assert.equal(gardenRow.hidden, false)
    assert.equal(body.querySelector('[data-key="purchase"]'), control)
})

for (const release of ['pointerup', 'pointercancel']) {
    test(`HUD keeps an active drag through refreshes and saves it on ${release}`, async () => {
        const h = boot({})
        await h.A.store.ready('t')
        h.A.store.set('hudPosition', { left: '20px', top: '40px' })
        h.A.registry.get('hud').setup()
        const panel = h.game.doc.getElementById('alakazam-hud')
        const head = h.game.doc.getElementById('alakazam-hud-head')
        panel.getBoundingClientRect = () => ({
            left: parseFloat(panel.style.left),
            top: parseFloat(panel.style.top)
        })
        const pointer = (type, x, y) =>
            head.dispatchEvent({
                type,
                pointerId: 1,
                button: 0,
                isTrusted: true,
                clientX: x,
                clientY: y,
                preventDefault() {}
            })

        pointer('pointerdown', 30, 50)
        pointer('pointermove', 500, 300)
        for (let i = 0; i < 3; i++) h.A.registry.get('hud').tick()
        assert.equal(panel.style.left, '490px')
        assert.equal(panel.style.top, '290px')

        h.ctx.innerWidth = 320
        h.ctx.innerHeight = 240
        h.events.find(event => event.type === 'resize').fn()
        assert.equal(panel.style.left, '44px')
        assert.equal(panel.style.top, '32px')
        pointer(release, 500, 300)
        await h.A.store.flush()
        assert.deepEqual(
            JSON.parse(JSON.stringify(h.disk[h.A.store.fieldKey('legacy:t', 'hudPosition')].value)),
            {
                left: '44px',
                top: '32px'
            }
        )
        h.ctx.innerWidth = 1440
        h.ctx.innerHeight = 900
        h.A.registry.get('hud').tick()
        assert.equal(panel.style.left, '44px')
        assert.equal(panel.style.top, '32px')
    })
}

test('status stays current with a hidden HUD and paused automation', async () => {
    const h = boot({ save: fx.save({}).raw, disk: { settings: { hud: false, enabled: false } } })
    await h.A.store.ready('t')
    h.A.scheduler.pause()
    const first = await h.A.registry.get('status').tick()
    assert.equal(first.paused, true)
    assert.equal(first.hudVisible, false)
    assert.equal(first.identity.known, true)
    h.game.doc.getElementById('cookies').innerText = '987 cookies'
    h.game.doc.getElementById('cookiesPerSecond').innerText = 'per second: 42'
    const next = await h.A.registry.get('status').tick()
    assert.equal(next.cookies, 987)
    assert.equal(next.cps, 42)
    assert.ok(next.at >= first.at)
    assert.equal(h.game.doc.getElementById('alakazam-hud'), null)
    assert.equal(h.A.registry.get('saveWatch').always, true)
    assert.equal(h.A.registry.get('status').always, true)
})

test('scheduler exposes restrictions and enforces them on the same path', async () => {
    const h = boot({ save: fx.save({}).raw, disk: { settings: { hud: false } } })
    await h.A.store.ready('t')
    h.debug().identity = { known: false }
    let calls = 0
    h.A.registry.register({ name: 'purchase', interval: 10, tick: () => calls++ })
    await h.A.scheduler.start()
    try {
        const blocked = h.A.scheduler.stats().find(mod => mod.name === 'purchase')
        assert.equal(blocked.state, 'blocked')
        assert.equal(blocked.reason, 'Save identity unresolved')
        assert.equal(blocked.enabled, false)
        h.debug().identity = { known: true }
        h.ctx.localStorage.getItem = key => (key === 'CookieClickerLang' ? 'FR' : null)
        assert.match(
            h.A.scheduler.stats().find(mod => mod.name === 'purchase').reason,
            /Unsupported language: FR/
        )
        assert.equal(calls, 0)
        h.ctx.localStorage.getItem = () => null
        h.A.scheduler.pause()
        assert.equal(h.A.scheduler.stats().find(mod => mod.name === 'purchase').state, 'paused')
        assert.equal(h.A.scheduler.stats().find(mod => mod.name === 'status').enabled, true)
        h.A.store.setSetting('purchase', false)
        assert.equal(h.A.scheduler.stats().find(mod => mod.name === 'purchase').state, 'off')
    } finally {
        h.A.scheduler.stop()
    }
})

test('setup failure is reported with the actual error', async () => {
    const h = boot({ disk: { settings: { hud: false } } })
    await h.A.store.ready('t')
    h.A.registry.register({
        name: 'broken',
        setup: () => {
            throw new Error('setup exploded')
        },
        tick() {}
    })
    await h.A.scheduler.start()
    try {
        const mod = h.A.status.snapshot().modules.find(mod => mod.name === 'broken')
        assert.equal(mod.state, 'failed')
        assert.equal(mod.lastError, 'setup exploded')
        assert.equal(mod.failures, 1)
    } finally {
        h.A.scheduler.stop()
    }
})

test('Buildings reports owned buildings and never garden seeds', async () => {
    const h = boot({ game: { owned: [10, 5, 1, 0, 0, 0, 0, 0] } })
    h.debug().garden = { unlocked: 34 }
    assert.equal(h.A.status.snapshot().buildings, 16)
})

test('save observation refreshes identity and storage namespace while paused', async () => {
    const h = boot({
        save: fx.save({ seed: 'abcde' }).raw,
        disk: { settings: { enabled: false, hud: false } }
    })
    const original = h.A.identity.fromSave(h.A.save.get())
    h.debug().identity = original
    await h.A.save.connect()
    h.A.store.set('marker', 'old save')
    h.ctx.localStorage.getItem = key =>
        key === 'CookieClickerGame' ? fx.save({ seed: 'vwxyz', fullDate: 1600000000001 }).raw : null
    await h.A.registry.get('saveWatch').tick()
    const next = h.A.status.snapshot()
    assert.equal(next.paused, true)
    assert.notEqual(next.identity.legacyId, original.legacyId)
    assert.equal(h.debug().identity.legacyId, next.identity.legacyId)
    assert.equal(h.A.store.get('marker', null), null)
    await h.A.store.flush()
    assert.equal(h.disk[h.A.store.fieldKey('legacy:' + original.legacyId, 'marker')].value, 'old save')
})

test('status and settings storage failures are observable and recover', async () => {
    const h = boot({})
    await h.A.store.ready('t')
    h.ctx.chrome.runtime = {
        lastError: { message: 'write failed' },
        sendMessage: (message, callback) => callback()
    }
    h.A.store.set('counter', 1)
    await assert.rejects(h.A.store.flush(), /write failed/)
    assert.equal(h.A.status.snapshot().storageError, 'write failed')
    assert.equal((await h.A.status.publish()).publicationError, 'write failed')
    h.ctx.chrome.runtime.lastError = undefined
    await h.A.store.flush()
    assert.equal(h.A.status.snapshot().storageError, '')
    assert.equal((await h.A.status.publish()).publicationError, '')
})
