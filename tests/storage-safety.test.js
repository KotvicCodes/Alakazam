const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot, waitFor } = require('./harness')
const { storageFixture } = require('./storage')
const fx = require('./fixtures')

function page(opts = {}) {
    const entries = { CookieClickerGame: fx.save().raw }
    const h = boot({ ...opts, localStorage: { getItem: key => entries[key] || null } })
    return { ...h, entries, tick: () => h.A.registry.get('saveWatch').tick() }
}

// Keep the actual scheduler, watcher and cancellation wrapper, but isolate the
// stateful job so unrelated game routines cannot make this race nondeterministic.
function isolate(h) {
    for (const mod of h.A.registry.all()) {
        if (mod.name !== 'saveWatch') h.A.registry.register({ ...mod, setup: null, tick() {} })
    }
}

for (const missing of ['missing', 'malformed', 'stale']) {
    test(`connected ${missing} save quarantines stateful work and recovers either family`, async () => {
        const h = page()
        isolate(h)
        await h.A.save.connect()
        const first = h.debug().identity
        h.A.store.set('attempts:statsPanel', 2)
        h.A.store.set('spellsCast', 7)
        if (missing === 'missing') delete h.entries.CookieClickerGame
        else if (missing === 'malformed') h.entries.CookieClickerGame = 'malformed'
        else h.entries.CookieClickerGame = fx.save({ driftedScalars: true }).raw
        await h.tick()
        assert.equal(h.debug().identity.known, false)
        assert.equal(h.A.store.isReady(), true)
        assert.equal(h.A.store.get('attempts:statsPanel', 0), 0)
        assert.equal(h.A.store.get('spellsCast', 0), 0)

        let actions = 0
        let independent = 0
        h.A.registry.register({
            name: 'achievements',
            interval: 'frame',
            tick: () => {
                actions++
                h.A.store.update('attempts:statsPanel', 0, n => n + 1)
            }
        })
        for (const name of ['autoclick', 'shimmers', 'wrinklers']) {
            h.A.registry.register({ name, interval: 'frame', tick: () => independent++ })
        }
        await h.A.scheduler.start()
        try {
            for (let i = 0; i < 3; i++) h.frame()
            const blocked = h.A.scheduler.stats().find(mod => mod.name === 'achievements')
            assert.equal(blocked.state, 'blocked')
            assert.equal(blocked.reason, 'Save identity unresolved')
            assert.equal(actions, 0)
            assert.equal(independent, 9, 'independent harmless modules intentionally keep running')
            h.A.store.set('unknownOnly', true)
            await h.A.store.flush()
            assert.equal(
                h.disk[h.A.store.fieldKey('legacy:' + first.familyId, 'attempts:statsPanel')].value,
                2,
                'pending old-family writes retain their destination'
            )

            h.entries.CookieClickerGame = fx.save().raw
            await h.tick()
            assert.equal(h.debug().identity.runId, first.runId)
            assert.equal(h.A.store.get('attempts:statsPanel'), 2)
            assert.equal(h.A.store.get('spellsCast'), 7)
            assert.equal(h.A.store.get('unknownOnly', false), false)
            h.frame()
            assert.equal(actions, 1)
            assert.equal(h.A.store.get('attempts:statsPanel'), 3)

            delete h.entries.CookieClickerGame
            await h.tick()
            h.entries.CookieClickerGame = fx.save({ fullDate: 1750000005000 }).raw
            await h.tick()
            assert.notEqual(h.debug().identity.familyId, first.familyId)
            assert.equal(h.A.store.get('attempts:statsPanel', 0), 0)
            assert.equal(h.A.store.get('unknownOnly', false), false)
            h.frame()
            assert.equal(actions, 2)
            assert.equal(h.A.store.get('attempts:statsPanel'), 1)
            await h.A.store.flush()
            assert.equal(
                h.disk[h.A.store.fieldKey('legacy:' + first.familyId, 'attempts:statsPanel')].value,
                3
            )
        } finally {
            h.A.scheduler.stop()
        }
    })
}

test('unknown storage reads retry without exposing the old family, even when the read fails', async () => {
    const h = page()
    await h.A.save.connect()
    const first = h.debug().identity
    h.A.store.set('held', 'old')
    delete h.entries.CookieClickerGame
    h.storage.failNext('get', 'temporarily unavailable')
    await assert.rejects(h.tick(), /temporarily unavailable/)
    assert.equal(h.debug().identity.known, false)
    assert.equal(h.A.store.isReady(), false)
    assert.equal(h.A.store.get('held', null), null)
    h.A.store.set('duringFailure', true)
    await h.tick()
    assert.equal(h.A.store.isReady(), true)
    await h.A.store.flush()
    assert.equal(h.disk[h.A.store.fieldKey('legacy:' + first.familyId, 'held')].value, 'old')
    assert.equal(h.disk[h.A.store.fieldKey('legacy:' + first.familyId, 'duringFailure')], undefined)
    h.entries.CookieClickerGame = fx.save().raw
    await h.tick()
    assert.equal(h.A.store.get('held'), 'old')
    assert.equal(h.A.store.get('duringFailure', false), false)
})

test('store.ready unknown never selects a previous family or run namespace', async () => {
    const h = page()
    await h.A.save.connect()
    const first = h.debug().identity
    h.A.store.set('held', 'old')
    h.A.store.set('spellsCast', 7)
    await h.A.store.ready(h.A.identity.fromSave(null))
    assert.equal(h.A.store.get('held', null), null)
    assert.equal(h.A.store.get('spellsCast', 0), 0)
    h.A.store.set('held', 'quarantined')
    h.A.store.set('spellsCast', 1)
    await h.A.store.ready(first)
    assert.equal(h.A.store.get('held'), 'old')
    assert.equal(h.A.store.get('spellsCast'), 7)
    await h.A.store.flush()
})

test('a queued old namespace read cannot undo a newer quarantine request', async () => {
    const h = page()
    await h.A.save.connect()
    h.A.store.set('held', 'old')
    const delayed = h.storage.deferNextGetCallback()
    const oldRead = h.A.store.ready(h.debug().identity)
    const finishOld = await delayed
    const delayedUnknown = h.storage.deferNextGetCallback()
    const unknownRead = h.A.store.ready(h.A.identity.fromSave(null))
    assert.equal(h.A.store.get('held', null), null)
    finishOld()
    const finishUnknown = await delayedUnknown
    await oldRead
    assert.equal(h.A.store.isReady(), false)
    assert.equal(h.A.store.get('held', null), null)
    h.A.store.set('held', 'quarantined')
    finishUnknown()
    await unknownRead
    assert.equal(h.A.store.get('held'), 'quarantined')
    await h.A.store.ready(h.debug().identity)
    assert.equal(h.A.store.get('held'), 'old')
    await h.A.store.flush()
})

test('scheduled save watcher drains cancelled old actions without waiting on itself', async () => {
    const h = page()
    isolate(h)
    await h.A.save.connect()
    const first = h.debug().identity
    let release
    let started = false
    let cancelled = false
    h.A.registry.register({
        name: 'achievements',
        interval: 100000,
        tick: async ({ task }) => {
            started = true
            try {
                await new Promise(resolve => (release = resolve))
                task.check()
                assert.fail('old task must be cancelled')
            } finally {
                cancelled = !task.active
                h.A.store.set('oldCleanup', true)
            }
        }
    })
    const watcher = h.A.registry.get('saveWatch')
    watcher.interval = 10
    await h.A.scheduler.start()
    try {
        assert.ok(await waitFor(() => started))
        delete h.entries.CookieClickerGame
        assert.ok(
            await waitFor(() =>
                h.A.scheduler.stats().some(mod => mod.reason === 'Save lifecycle transition')
            )
        )
        release()
        assert.ok(
            await waitFor(() =>
                h.A.scheduler.stats().some(mod => mod.reason === 'Save identity unresolved')
            )
        )
        assert.equal(cancelled, true)
        assert.equal(h.A.store.get('oldCleanup', false), false)
        h.entries.CookieClickerGame = fx.save().raw
        assert.ok(await waitFor(() => h.debug().identity?.runId === first.runId))
        assert.equal(h.A.store.get('oldCleanup'), true)
        assert.equal(h.A.scheduler.stats().find(mod => mod.name === 'saveWatch').disabled, false)
        await h.A.store.flush()
    } finally {
        release?.()
        h.A.scheduler.stop()
    }
})

const original = [4, 5, 6, 1, 2, 3, 4]
const temporary = [9, 1, 1, 3, 7, 3, 0]
const journal = (key, id) =>
    key === 'bakeryNameRecovery'
        ? { legacyId: id, original: 'Original', expected: 'Orteil' }
        : { legacyId: id, original, expected: temporary, previous: temporary, history: [temporary] }

const malformed = {
    bakeryNameRecovery: [
        mark => delete mark.original,
        mark => (mark.original = null),
        mark => (mark.original = 5),
        mark => delete mark.expected,
        mark => (mark.expected = {}),
        mark => (mark.legacyId = 5)
    ],
    cloneRecovery: [
        mark => (mark.history = {}),
        mark => delete mark.original,
        mark => delete mark.expected,
        mark => (mark.original = {}),
        mark => (mark.expected = temporary.slice(1)),
        mark => (mark.original = [...original, 0]),
        mark => (mark.original[0] = -1),
        mark => (mark.expected[0] = 17),
        mark => (mark.expected[1] = 18),
        mark => (mark.expected[2] = 15),
        mark => (mark.expected[3] = 5),
        mark => (mark.expected[4] = 10),
        mark => (mark.expected[5] = 36),
        mark => (mark.expected[6] = 36),
        mark => (mark.expected[0] = 1.5),
        mark => (mark.expected[0] = Number.MAX_SAFE_INTEGER + 1),
        mark => (mark.expected[0] = '9'),
        mark => (mark.previous = {}),
        mark => (mark.previous[0] = -1),
        mark => (mark.history = null),
        mark => (mark.history = [null]),
        mark => (mark.history[0][0] = -1),
        mark => (mark.history[0][0] = 0.5)
    ]
}

for (const source of ['old-seed', 'old-stable', 'family', 'field', 'baseline', 'external']) {
    for (const [key, mutations] of Object.entries(malformed)) {
        test(`${source} malformed ${key} stays inert and preserves storage evidence`, async () => {
            for (const mutate of mutations) {
                const raw = fx.save({ bakeryName: 'Orteil', amounts: { 19: 1 } }).raw
                const who = boot({ save: raw }).A.identity.current()
                const id =
                    source === 'old-seed'
                        ? who.previousLegacyId
                        : source === 'old-stable'
                          ? who.previousRecoveryId
                          : who.familyId
                const mark = structuredClone(journal(key, id))
                mutate(mark)
                const family = 'legacy:' + who.familyId
                const encoded = boot().A.store.fieldKey(
                    family,
                    source === 'baseline' ? '@base:' + key : key
                )
                const disk = ['field', 'baseline'].includes(source)
                    ? { [encoded]: { value: mark } }
                    : source === 'external'
                      ? {}
                      : { ['legacy:' + id]: { [key]: mark } }
                const evidence = structuredClone(disk)
                const h = boot({ disk, save: raw, game: { bakeryName: 'Orteil', genes: temporary } })
                await h.A.save.connect()
                if (source === 'external') {
                    const writer = h.storage.chrome()
                    writer.storage.local.set({ [encoded]: { value: mark } }, () => {})
                    evidence[encoded] = { value: mark }
                }
                const hint = `${key}: ${source}: ${mutate.toString()}`
                assert.equal(h.A.store.get(key, null), null, hint)
                await h.A.registry.get(key === 'bakeryNameRecovery' ? 'achievements' : 'clones').setup()
                assert.equal(h.game.state.bakeryName, 'Orteil', hint)
                assert.deepEqual(h.game.state.genes, temporary, hint)
                assert.equal(h.game.state.log.includes('renamed bakery'), false, hint)
                assert.equal(h.game.doc.getElementById('promptContentCustomizeYou'), null, hint)
                await h.A.store.flush()
                assert.deepEqual(disk, evidence, hint)
            }
        })
    }
}

for (const old of ['previousLegacyId', 'previousRecoveryId']) {
    for (const key of ['bakeryNameRecovery', 'cloneRecovery']) {
        test(`${old} valid ${key} normalizes identity, restores, and honors tombstones`, async () => {
            const raw = fx.save({ bakeryName: 'Orteil', amounts: { 19: 1 } }).raw
            const who = boot({ save: raw }).A.identity.current()
            const mark = structuredClone(journal(key, who[old]))
            // Journals predating multi-step recovery have no previous/history.
            delete mark.previous
            delete mark.history
            const storage = storageFixture({ ['legacy:' + who[old]]: { [key]: mark } })
            const h = boot({ storage, save: raw, game: { bakeryName: 'Orteil', genes: temporary } })
            await h.A.save.connect()
            assert.equal(h.A.store.get(key).legacyId, who.familyId)
            await h.A.registry.get(key === 'bakeryNameRecovery' ? 'achievements' : 'clones').setup()
            if (key === 'bakeryNameRecovery') assert.equal(h.game.state.bakeryName, 'Original')
            else assert.deepEqual(h.game.state.genes, original)
            h.A.store.forget(key)
            await h.A.store.flush()
            const reload = boot({ storage, save: raw })
            await reload.A.save.connect()
            assert.equal(reload.A.store.get(key, null), null)
            assert.deepEqual(storage.disk['legacy:' + who[old]][key], mark)
        })
    }
}
