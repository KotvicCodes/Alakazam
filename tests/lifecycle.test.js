const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./harness')
const { storageFixture } = require('./storage')
const fx = require('./fixtures')

function page(opts = {}) {
    const entries = opts.entries || {}
    const localStorage = {
        get length() {
            return Object.keys(entries).length
        },
        key: i => Object.keys(entries)[i],
        getItem: key => entries[key] || null
    }
    const h = boot({ ...opts, localStorage })
    return { ...h, entries, tick: () => h.A.registry.get('saveWatch').tick() }
}
const stateOf = h => h.A.identity.fromSave(h.A.save.get())

// explicit saved timestamps make zero-activity autosaves reproducible
const saved = (lastDate, opts = {}) => fx.save({ lastDate, ...opts }).raw

test('URL selects live or beta when both saves exist; only the selected save advances revision', async () => {
    for (const [pathname, key, resets] of [
        ['/cookieclicker/', 'CookieClickerGame', 4],
        ['/cookieclicker/beta/', 'CookieClickerGameBeta', 9]
    ]) {
        const h = page({
            location: { pathname },
            entries: {
                CookieClickerGame: saved(1750000002000, { resets: 4 }),
                CookieClickerGameBeta: saved(1750000002000, { resets: 9 })
            }
        })
        assert.equal(h.A.save.get().key, key)
        assert.equal(h.A.save.get().scalars.resets, resets)
        const before = h.A.save.stats()
        await h.tick()
        assert.equal(h.A.save.stats().revision, before.revision)
        const other = key === 'CookieClickerGame' ? key + 'Beta' : 'CookieClickerGame'
        h.entries[other] = saved(1750000062000)
        await h.tick()
        assert.equal(h.A.save.stats().revision, before.revision)
        h.entries[key] = saved(1750000062000, { resets })
        await h.tick()
        const after = h.A.save.stats()
        assert.equal(after.revision, before.revision + 1)
        assert.equal(after.savedAt, 1750000062000)
        assert.ok(after.changedAt >= before.changedAt)
        assert.equal(after.runId, before.runId)
        assert.equal(after.trusted, true)
    }
})

test('first autosave discovers identity without copying quarantined unknown state or the other variant', async () => {
    const h = page({
        location: { pathname: '/cookieclicker/beta/' },
        entries: {
            CookieClickerGame: saved(1750000002000)
        }
    })
    await h.A.save.connect()
    assert.equal(h.A.save.get().ok, false)
    h.A.store.set('clonesStyled', true)
    h.entries.CookieClickerGameBeta = saved(1750000062000, { lumps: -1, lumpsTotal: -1, lumpT: 0 })
    await h.tick()
    assert.equal(h.A.save.stats().trusted, true)
    assert.equal(h.debug().identity.known, true)
    assert.equal(h.A.store.get('clonesStyled', false), false)
    await h.A.store.flush()
})

test('fresh locked lumps are trustworthy; malformed scalars stay unreadable', () => {
    const h = boot({ save: fx.save({ lumps: -1, lumpsTotal: -1, lumpT: 0, cookieClicks: 5 }).raw })
    assert.equal(h.A.save.trusted(), true)
    assert.equal(h.A.save.get().scalars.lumpsState, 'locked')
    assert.equal(h.A.save.get().scalars.cookieClicks, 5)
    assert.equal(h.A.lumps.lumpState(), null)
    assert.equal(
        boot({ save: fx.save({ lumps: 0, lumpsTotal: 1 }).raw }).A.save.get().scalars.lumpsState,
        'unlocked'
    )
    for (const [field, bad] of [
        [42, '-2'],
        [43, '-1'],
        [43, 'NaN'],
        [43, 'Infinity'],
        [2, '5junk'],
        [25, ''],
        [22, 'not-a-season'],
        [44, '9'],
        [46, '5']
    ]) {
        const parts = fx.save().text.split('|')
        const scalars = parts[4].split(';')
        scalars[field] = bad
        parts[4] = scalars.join(';')
        const parsed = h.A.savefile.parse(parts.join('|'))
        assert.equal(parsed.stale, true, `${field}=${bad}`)
        assert.equal(parsed.scalars.lumpsState, 'unreadable')
    }
})

test('ascension with changing seed retains family state, resets run state, and survives reload', async () => {
    const storage = storageFixture()
    const h = page({ storage, entries: { CookieClickerGame: saved(1750000002000) } })
    await h.A.save.connect()
    const first = stateOf(h)
    h.A.store.set('clonesStyled', true)
    h.A.store.set('giftRedeemedAt', 123)
    h.A.store.set('spellsCast', 12)
    h.A.store.set('ascendPhase', 'ascending')
    h.entries.CookieClickerGame = saved(1750000062000, {
        seed: 'zzzzz',
        startDate: 1750000061000,
        resets: 1
    })
    await h.tick()
    const next = stateOf(h)
    assert.equal(next.familyId, first.familyId)
    assert.notEqual(next.runId, first.runId)
    assert.equal(h.A.store.get('clonesStyled'), true)
    assert.equal(h.A.store.get('giftRedeemedAt'), 123)
    assert.equal(h.A.store.get('spellsCast', 0), 0)
    assert.equal(h.A.store.get('ascendPhase', 'watching'), 'watching')
    h.A.store.set('spellsCast', 2)
    await h.A.store.flush()
    const reload = page({ storage, entries: h.entries })
    await reload.A.save.connect()
    assert.equal(reload.A.store.get('clonesStyled'), true)
    assert.equal(reload.A.store.get('spellsCast'), 2)
    assert.equal(reload.A.save.stats().runId, next.runId)
    await reload.A.store.flush()
})

test('imports select their family even if counters increase; same-family copies share long-term state', async () => {
    const h = page({ entries: { CookieClickerGame: saved(1750000002000) } })
    await h.A.save.connect()
    h.A.store.set('clonesStyled', true)
    h.A.store.set('spellsCast', 7)
    const original = stateOf(h)
    h.entries.CookieClickerGame = saved(1750000062000, { fullDate: 1750000005000, cookieClicks: 99999 })
    await h.tick()
    assert.notEqual(stateOf(h).familyId, original.familyId)
    assert.equal(h.A.store.get('clonesStyled', false), false)
    h.entries.CookieClickerGame = saved(1750000122000, { seed: 'xxxxx', cookieClicks: 999999 })
    await h.tick()
    assert.equal(stateOf(h).familyId, original.familyId)
    assert.equal(h.A.store.get('clonesStyled'), true)
    assert.equal(h.A.store.get('spellsCast', 0), 0)
    await h.A.store.flush()
})

test('matching legacy migration copies family fields only, preserves source, and honors tombstones on reload', async () => {
    const entries = { CookieClickerGame: saved(1750000002000) }
    const probe = page({ entries })
    const who = stateOf(probe)
    const old = { clonesStyled: true, lumpLifeSpan: 123, spellsCast: 40, ascendPhase: 'ascending' }
    const storage = storageFixture({ ['legacy:' + who.previousLegacyId]: structuredClone(old) })
    const h = page({ storage, entries })
    await h.A.save.connect()
    assert.equal(h.A.store.get('clonesStyled'), true)
    assert.equal(h.A.store.get('spellsCast', 0), 0)
    h.A.store.forget('clonesStyled')
    await h.A.store.flush()
    assert.deepEqual(storage.disk['legacy:' + who.previousLegacyId], old)
    const reload = page({
        storage,
        entries: { CookieClickerGame: saved(1750000062000, { seed: 'other' }) }
    })
    await reload.A.save.connect()
    assert.equal(reload.A.store.get('clonesStyled', false), false)
    assert.equal(reload.A.store.get('lumpLifeSpan'), 123)
    await reload.A.store.flush()
})

test('pending namespace writes survive switches, callback failures, synchronous throws, and retry', async () => {
    const storage = storageFixture()
    const h = boot({ storage })
    await h.A.store.ready('one')
    const value = { nested: [1] }
    h.A.store.set('first', value)
    value.nested.push(2)
    await h.A.store.ready('two')
    h.A.store.set('second', 2)
    storage.failNext('set', 'quota exceeded')
    await assert.rejects(h.A.store.flush(), /quota exceeded/)
    assert.match(h.A.store.stats().error, /quota/)
    assert.equal(h.A.store.stats().pending, 2)
    assert.equal(Object.keys(storage.disk).length, 0)
    const realSet = h.ctx.chrome.storage.local.set
    h.ctx.chrome.storage.local.set = () => {
        throw new Error('disconnected')
    }
    await assert.rejects(h.A.store.flush(), /disconnected/)
    h.ctx.chrome.storage.local.set = realSet
    await h.A.store.flush()
    assert.equal(h.A.store.stats().error, '')
    assert.deepEqual(storage.disk[h.A.store.fieldKey('legacy:one', 'first')].value, { nested: [1] })
    assert.equal(storage.disk[h.A.store.fieldKey('legacy:two', 'second')].value, 2)
})

test('changes made while a write is in flight stay pending, including after a namespace switch', async () => {
    const storage = storageFixture()
    const h = boot({ storage })
    await h.A.store.ready('one')
    h.A.store.set('value', 1)
    const commit = storage.deferNextSet()
    const writing = h.A.store.flush()
    const complete = await commit
    h.A.store.set('value', 2)
    await h.A.store.ready('two')
    h.A.store.set('other', 3)
    complete()
    await writing
    assert.equal(h.A.store.stats().pending, 2)
    await h.A.store.flush()
    assert.equal(storage.disk[h.A.store.fieldKey('legacy:one', 'value')].value, 2)
    assert.equal(storage.disk[h.A.store.fieldKey('legacy:two', 'other')].value, 3)
})

test('competing tabs and settings writers preserve unrelated pending and external values', async () => {
    const storage = storageFixture({ settings: { hud: false } })
    const a = boot({ storage }).A.store
    const b = boot({ storage }).A.store
    await Promise.all([a.ready('same'), b.ready('same')])
    a.set('first', 1)
    b.set('second', 2)
    a.setSetting('garden', false)
    b.setSetting('purchase', false)
    await Promise.all([a.flush(), b.flush()])
    assert.equal(a.get('second'), 2)
    assert.equal(b.get('first'), 1)
    assert.equal(a.setting('purchase'), false)
    assert.equal(b.setting('garden'), false)
    assert.equal(a.setting('hud'), false)
    a.forget('first')
    b.set('second', 3)
    await Promise.all([a.flush(), b.flush()])
    const c = boot({ storage }).A.store
    await c.ready('same')
    assert.equal(c.get('first', null), null)
    assert.equal(c.get('second'), 3)
    assert.equal(c.setting('garden'), false)
    assert.equal(c.setting('purchase'), false)
})

test('failed namespace reads are surfaced and can retry without erasing pending writes', async () => {
    const h = boot()
    await h.A.store.ready('one')
    h.A.store.set('value', 1)
    h.storage.failNext('get', 'read denied')
    await assert.rejects(h.A.store.ready('two'), /read denied/)
    assert.equal(h.A.store.isReady(), false)
    assert.equal(h.A.store.stats().pending, 1)
    await h.A.store.ready('two')
    await h.A.store.flush()
    assert.equal(h.disk[h.A.store.fieldKey('legacy:one', 'value')].value, 1)
})

test('unreadable saves invalidate trust without claiming a new accepted revision', async () => {
    const h = page({ entries: { CookieClickerGame: saved(1750000002000) } })
    const before = h.A.save.stats()
    h.entries.CookieClickerGame = 'malformed'
    await h.tick()
    assert.equal(h.A.save.stats().trusted, false)
    assert.equal(h.A.save.stats().revision, before.revision)
    h.entries.CookieClickerGame = saved(1750000062000)
    await h.tick()
    assert.equal(h.A.save.stats().revision, before.revision + 1)
    assert.equal(h.A.save.stats().trusted, true)
})

test('copying an older seed namespace requires an explicit request and preserves destination values', async () => {
    const storage = storageFixture({
        'legacy:0123abcd': {
            clonesStyled: true,
            lumpLifeSpan: 123,
            spellsCast: 99,
            ascendPhase: 'ascending',
            removed: 1
        }
    })
    const h = page({ storage, entries: { CookieClickerGame: saved(1750000002000) } })
    await h.A.save.connect()
    assert.equal(h.A.store.get('lumpLifeSpan', 0), 0)
    h.A.store.set('clonesStyled', false)
    h.A.store.forget('removed')
    await h.A.store.copyLegacy('0123abcd')
    assert.equal(h.A.store.get('clonesStyled'), false)
    assert.equal(h.A.store.get('lumpLifeSpan'), 123)
    assert.equal(h.A.store.get('spellsCast', 0), 0)
    assert.equal(h.A.store.get('removed', null), null)
    assert.ok(storage.disk['legacy:0123abcd'])
    await assert.rejects(h.A.store.copyLegacy('unknown'), /old legacy hash/)
})

test('malformed run metadata cannot establish a trusted measurement or known identity', () => {
    const h = boot()
    for (const value of ['', 'NaN', '1750000000000junk']) {
        const parts = fx.save().text.split('|')
        const run = parts[2].split(';')
        run[1] = value
        parts[2] = run.join(';')
        const parsed = h.A.savefile.parse(parts.join('|'))
        assert.equal(parsed.stale, true)
        assert.equal(h.A.identity.fromSave(parsed).known, false)
    }
})

test('real save season strings and locked lump timestamps remain valid', () => {
    for (const season of ['', 'christmas', 'halloween', 'valentines', 'easter', 'fools']) {
        const h = boot({ save: fx.save({ season, lumps: -1, lumpsTotal: -1 }).raw })
        assert.equal(h.A.save.trusted(), true, season)
        assert.equal(h.A.save.get().scalars.season, season)
        assert.equal(h.A.lumps.lumpState(), null)
    }
})

test('popup uses the same field writer as tabs and reports failed setting writes', async () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const vm = require('node:vm')
    const { El } = require('./dom')
    const storage = storageFixture()
    const tab = boot({ storage }).A.store
    await tab.ready('game')
    tab.set('status', { at: Date.now(), cookies: 123, cps: 4, lumps: 0 })
    await tab.flush()
    const popup = boot({ storage })
    const doc = popup.game.doc
    for (const id of ['status', 'controls', 'gameData', 'cookies', 'cps', 'buildings']) {
        doc.body.append(new El('div', { id }))
    }
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8'), popup.ctx)
    await popup.ctx.render()
    assert.equal(doc.getElementById('cookies').textContent, '123')
    const purchase = doc.getElementById('controls').children.find(el => el.textContent === 'Buying: on')
    tab.setSetting('garden', false)
    storage.failNext('set', 'quota exceeded')
    await purchase.listeners.click[0]()
    await popup.ctx.render()
    assert.match(doc.getElementById('status').textContent, /could not be saved/)
    assert.equal(popup.A.store.stats().pending, 1)
    await Promise.all([tab.flush(), popup.A.store.flush()])
    assert.equal(tab.setting('purchase'), false)
    assert.equal(popup.A.store.setting('garden'), false)
    assert.equal(popup.A.store.stats().error, '')
})

test('migration baselines cannot overwrite concurrent field writes', async () => {
    const entries = { CookieClickerGame: saved(1750000002000) }
    const who = stateOf(page({ entries }))
    const storage = storageFixture({
        ['legacy:' + who.previousLegacyId]: { clonesStyled: false, lumpLifeSpan: 123 }
    })
    const first = page({ storage, entries })
    const second = page({ storage, entries })
    await Promise.all([first.A.save.connect(), second.A.save.connect()])
    first.A.store.set('clonesStyled', true)
    const delayed = storage.deferNextSet()
    const migrating = second.A.store.flush()
    const commit = await delayed
    await first.A.store.flush()
    commit()
    await migrating
    const reload = page({ storage, entries })
    await reload.A.save.connect()
    assert.equal(reload.A.store.get('clonesStyled'), true)
    assert.equal(reload.A.store.get('lumpLifeSpan'), 123)
    await reload.A.store.flush()
})

test('income observes zero-activity revisions and resets its run measurements on imports', async () => {
    const h = page({
        entries: { CookieClickerGame: saved(1750000002000, { cookies: 0, cookiesEarned: 0 }) }
    })
    let now = 1750000002000
    h.ctx.Date = class extends Date {
        static now() {
            return now
        }
    }
    h.A.live.readGlobals = () => ({ cps: 0 })
    h.A.live.readShimmers = () => []
    h.A.buffs.hasProductionBuff = () => false
    h.A.clicks.stats = () => ({ clickCps: 0 })
    const tick = h.A.registry.get('income').tick
    await h.A.save.connect()
    tick()
    now += 60000
    h.entries.CookieClickerGame = saved(now, { cookies: 0, cookiesEarned: 6000 })
    await h.tick()
    tick()
    const active = h.A.income.stats().goldenCps
    assert.ok(active > 0)
    now += 60000
    h.entries.CookieClickerGame = saved(now, { cookies: 0, cookiesEarned: 6000 })
    await h.tick()
    tick()
    assert.ok(h.A.income.stats().goldenCps < active)
    now += 60000
    tick() // cached data must not add another saved interval
    const inactive = h.A.income.stats().goldenCps
    tick()
    assert.equal(h.A.income.stats().goldenCps, inactive)
    h.entries.CookieClickerGame = saved(now + 60000, { fullDate: 1750000005000, cookiesEarned: 1e12 })
    await h.tick()
    assert.equal(h.A.income.stats().goldenCps, 0)
    assert.equal(h.A.income.stats().samples, 0)
    await h.A.store.flush()
})

test('a waiting flush retries retained records after the preceding write fails', async () => {
    const h = boot()
    await h.A.store.ready('one')
    h.A.store.set('value', 1)
    const deferred = h.storage.deferNextSet()
    const writing = h.A.store.flush()
    const firstFailure = assert.rejects(writing, /temporarily unavailable/)
    const complete = await deferred
    h.A.store.set('value', 2)
    await h.A.store.ready('two')
    h.A.store.set('other', 3)
    const retry = h.A.store.flush()
    h.storage.failNext('set', 'temporarily unavailable')
    complete()
    await firstFailure
    await retry
    assert.equal(h.A.store.stats().pending, 0)
    assert.equal(h.A.store.stats().error, '')
    assert.equal(h.disk[h.A.store.fieldKey('legacy:one', 'value')].value, 2)
    assert.equal(h.disk[h.A.store.fieldKey('legacy:two', 'other')].value, 3)
})

test('missing and stale saves load storage once, retry failures, and still discover a valid save', async () => {
    for (const raw of [null, fx.save({ driftedScalars: true }).raw]) {
        const h = page({ entries: raw ? { CookieClickerGame: raw } : {} })
        let reads = 0
        const get = h.ctx.chrome.storage.local.get
        h.ctx.chrome.storage.local.get = (...args) => {
            reads++
            get(...args)
        }
        h.storage.failNext('get', 'temporarily unavailable')
        await assert.rejects(h.A.save.connect(), /temporarily unavailable/)
        assert.equal(h.A.store.isReady(), false)
        await h.tick()
        assert.equal(reads, 2)
        assert.equal(h.A.store.isReady(), true)
        for (let i = 0; i < 3; i++) await h.tick()
        assert.equal(reads, 2, 'unchanged missing/stale saves must not reload all storage')
        h.entries.CookieClickerGame = saved(1750000062000)
        await h.tick()
        assert.equal(reads, 3, 'a valid save must still select its family and run')
        assert.equal(h.debug().identity.runId, h.A.save.stats().runId)
        await h.A.store.flush()
    }
})

test('same-family reconciliation preserves active ascension phases through reload and reincarnation', async () => {
    for (const phase of ['ascending', 'shopping', 'returning']) {
        const storage = storageFixture()
        const h = page({ storage, entries: { CookieClickerGame: saved(1750000002000) } })
        await h.A.save.connect()
        h.A.act.ascend.openLegacy()
        h.A.act.ascend.confirmPrompt('ascend')
        h.A.store.set('ascendPhase', phase)
        h.A.store.set('ascendAwaitReset', 0)
        h.A.store.set('spellsCast', 4)
        h.A.store.set('clonesStyled', true)
        h.A.registry.get('ascend').setup()
        h.entries.CookieClickerGame = saved(1750000062000, {
            seed: 'other',
            resets: 1,
            startDate: 1750000061000
        })
        await h.tick()
        assert.equal(h.A.ascend.state().phase, phase, `${phase} must survive on the ascension screen`)
        assert.equal(h.A.store.get('ascendPhase'), phase)
        assert.equal(h.A.store.get('ascendAwaitReset', null), null)
        assert.equal(h.A.store.get('spellsCast', 0), 0)
        assert.equal(h.A.store.get('clonesStyled'), true)
        await h.A.store.flush()
        const reload = page({ storage, entries: h.entries })
        reload.A.act.ascend.openLegacy()
        reload.A.act.ascend.confirmPrompt('ascend')
        await reload.A.save.connect()
        assert.equal(reload.A.ascend.state().phase, phase)
        for (let i = 0; i < 8; i++) await reload.A.registry.get('ascend').tick()
        assert.equal(reload.game.state.log.filter(item => item === 'reincarnated').length, 1)
        assert.equal(reload.A.ascend.state().phase, 'watching')
        await reload.A.store.flush()
    }
})

test('an active ascension phase is not copied into an imported different family', async () => {
    const h = page({ entries: { CookieClickerGame: saved(1750000002000) } })
    await h.A.save.connect()
    h.A.act.ascend.openLegacy()
    h.A.act.ascend.confirmPrompt('ascend')
    h.A.store.set('ascendPhase', 'shopping')
    h.A.registry.get('ascend').setup()
    h.entries.CookieClickerGame = saved(1750000062000, { fullDate: 1750000005000 })
    await h.tick()
    assert.equal(h.A.ascend.state().phase, 'watching')
    assert.equal(h.A.store.get('ascendPhase', null), null)
    await h.A.store.flush()
})

test('external pause received before a delayed write callback is retained and notifies subscribers', async () => {
    const storage = storageFixture()
    const a = boot({ storage }).A.store
    const b = boot({ storage }).A.store
    await Promise.all([a.ready('same'), b.ready('same')])
    const notifications = []
    a.subscribe(settings => notifications.push(settings.enabled))
    a.setSetting('enabled', true)
    const delayed = storage.deferNextSetCallback()
    const writing = a.flush()
    const acknowledge = await delayed
    assert.equal(storage.disk[a.fieldKey('settings', 'enabled')].value, true)
    b.setSetting('enabled', false)
    await b.flush()
    assert.equal(storage.disk[a.fieldKey('settings', 'enabled')].value, false)
    acknowledge()
    await writing
    assert.equal(a.setting('enabled'), false)
    assert.equal(a.moduleEnabled('autoclick'), false)
    assert.equal(notifications.at(-1), false)
    assert.equal(a.stats().pending, 0)
})

test('external overwrites and deletions survive a delayed callback across namespace switches', async () => {
    for (const remove of [false, true]) {
        const storage = storageFixture()
        const a = boot({ storage }).A.store
        const b = boot({ storage }).A.store
        await Promise.all([a.ready('same'), b.ready('same')])
        a.set('value', { count: 1 })
        const delayed = storage.deferNextSetCallback()
        const writing = a.flush()
        const acknowledge = await delayed
        if (remove) b.forget('value')
        else b.set('value', { count: 2 })
        await b.flush()
        await a.ready('other')
        a.set('unrelated', 3)
        await a.ready('same')
        acknowledge()
        await writing
        if (remove) assert.equal(a.get('value', null), null)
        else assert.equal(a.get('value').count, 2)
        await a.flush()
        assert.equal(storage.disk[a.fieldKey('legacy:other', 'unrelated')].value, 3)
    }
})

test('new local edits made before acknowledgment stay pending after an external overwrite', async () => {
    const storage = storageFixture()
    const a = boot({ storage }).A.store
    const b = boot({ storage }).A.store
    await Promise.all([a.ready('same'), b.ready('same')])
    a.set('value', 1)
    const delayed = storage.deferNextSetCallback()
    const writing = a.flush()
    const acknowledge = await delayed
    b.set('value', 2)
    await b.flush()
    a.set('value', 3)
    acknowledge()
    await writing
    assert.equal(a.get('value'), 3)
    assert.equal(a.stats().pending, 1)
    assert.equal(storage.disk[a.fieldKey('legacy:same', 'value')].value, 2)
    await a.flush()
    assert.equal(a.get('value'), 3)
    assert.equal(b.get('value'), 3)
    assert.equal(a.stats().pending, 0)
})

test('external pause survives a delayed namespace load with or without an existing setting', async () => {
    for (const existing of [false, true]) {
        const storage = storageFixture()
        const h = page({ storage, entries: { CookieClickerGame: saved(1750000002000) } })
        const popup = boot({ storage }).A.store
        await h.A.save.connect()
        await popup.ready('popup')
        if (existing) {
            h.A.store.setSetting('enabled', true)
            await h.A.store.flush()
        }
        const notifications = []
        h.A.store.subscribe(settings => notifications.push(settings.enabled))
        const delayed = storage.deferNextGetCallback()
        h.entries.CookieClickerGame = saved(1750000062000, {
            seed: 'other',
            resets: 1,
            startDate: 1750000061000
        })
        const switching = h.tick()
        const acknowledge = await delayed
        popup.setSetting('enabled', false)
        await popup.flush()
        assert.equal(h.A.store.setting('enabled'), false)
        acknowledge()
        await switching
        assert.equal(h.A.store.setting('enabled'), false)
        assert.equal(h.A.store.moduleEnabled('autoclick'), false)
        assert.equal(notifications.at(-1), false)
        assert.equal(h.A.store.stats().pending, 0)
        assert.equal(storage.disk[h.A.store.fieldKey('settings', 'enabled')].value, false)
    }
})

test('initial load preserves storage events received before its first callback', async () => {
    const storage = storageFixture()
    const a = boot({ storage }).A.store
    const b = boot({ storage }).A.store
    await b.ready('same')
    const delayed = storage.deferNextGetCallback()
    const loading = a.ready('same')
    const acknowledge = await delayed
    b.setSetting('enabled', false)
    b.set('value', 2)
    await b.flush()
    acknowledge()
    await loading
    assert.equal(a.setting('enabled'), false)
    assert.equal(a.get('value'), 2)
    assert.equal(a.stats().pending, 0)
})

test('queued namespace loads preserve creations, tombstones, and physical storage deletions', async () => {
    const storage = storageFixture()
    const a = boot({ storage }).A.store
    const b = boot({ storage }).A.store
    await Promise.all([a.ready('one'), b.ready('one')])
    b.set('removed', 1)
    b.setSetting('purchase', false)
    await b.flush()
    const firstRead = storage.deferNextGetCallback()
    const first = a.ready('one')
    const last = a.ready('two')
    const acknowledgeFirst = await firstRead
    b.forget('removed')
    b.set('created', 2)
    await b.flush()
    const secondRead = storage.deferNextGetCallback()
    acknowledgeFirst()
    await first
    const acknowledgeLast = await secondRead
    assert.equal(a.isReady(), false)
    assert.equal(a.get('removed', null), null)
    assert.equal(a.get('created'), 2)
    // The second snapshot includes the creation, but another deletion arrives
    // before its callback. Neither load may resurrect data from its own snapshot.
    await new Promise(resolve => {
        storage
            .chrome()
            .storage.local.remove(
                [a.fieldKey('legacy:one', 'created'), a.fieldKey('settings', 'purchase')],
                resolve
            )
    })
    acknowledgeLast()
    await last
    assert.equal(a.isReady(), true)
    assert.equal(a.get('removed', null), null)
    assert.equal(a.get('created', null), null)
    assert.equal(a.setting('purchase'), true)
    assert.equal(a.stats().pending, 0)
    await a.ready('two')
    await a.ready('one')
    assert.equal(a.get('removed', null), null)
    assert.equal(a.get('created', null), null)
    assert.equal(a.setting('purchase'), true)
})

test('load reconciliation retains pending-write external events and newer local edits', async () => {
    for (const editAgain of [false, true]) {
        const storage = storageFixture()
        const a = boot({ storage }).A.store
        const b = boot({ storage }).A.store
        await Promise.all([a.ready('same'), b.ready('same')])
        a.set('value', 1)
        const delayedWrite = storage.deferNextSetCallback()
        const writing = a.flush()
        const acknowledgeWrite = await delayedWrite
        const delayedRead = storage.deferNextGetCallback()
        const loading = a.ready('same')
        const acknowledgeRead = await delayedRead
        b.set('value', 2)
        await b.flush()
        if (editAgain) a.set('value', 3)
        acknowledgeWrite()
        await writing
        acknowledgeRead()
        await loading
        assert.equal(a.get('value'), editAgain ? 3 : 2)
        assert.equal(a.stats().pending, editAgain ? 1 : 0)
        await a.flush()
        assert.equal(storage.disk[a.fieldKey('legacy:same', 'value')].value, editAgain ? 3 : 2)
        assert.equal(a.stats().pending, 0)
    }
})
