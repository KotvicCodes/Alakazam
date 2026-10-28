const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { boot, ROOT } = require('./harness')
const { storageFixture } = require('./storage')
const { clock } = require('./clock')
const fx = require('./fixtures')

const ORIGINAL = [4, 5, 6, 1, 2, 3, 4]
const KEY = { name: 'bakeryNameRecovery', clones: 'cloneRecovery' }
const plain = value => JSON.parse(JSON.stringify(value))

// Run the real background listener and manifest-ordered content scripts against
// serialized, shared Chrome storage/onChanged events and shared site storage.
// Browser document lifetime is independent of a suspended content-script task.
function extension() {
    const storage = storageFixture()
    const listeners = []
    const documents = new Map()
    const tabs = new Map()
    const heldReplies = new Map()
    const chrome = storage.chrome()
    let nextDocument = 0
    let navigationError = ''
    let navigationErrorTab = null
    chrome.runtime.onMessage = { addListener: fn => listeners.push(fn) }
    chrome.tabs = {
        onRemoved: { addListener() {} },
        onUpdated: { addListener() {} },
        get(tabId, callback) {
            if (tabs.has(tabId)) callback(tabs.get(tabId))
            else {
                chrome.runtime.lastError = { message: `No tab with id: ${tabId}.` }
                callback()
                delete chrome.runtime.lastError
            }
        }
    }
    chrome.webNavigation = {
        getFrame({ tabId, documentId, frameId }, callback) {
            if (navigationError && (navigationErrorTab === null || navigationErrorTab === tabId)) {
                chrome.runtime.lastError = { message: navigationError }
                callback()
                delete chrome.runtime.lastError
                return
            }
            const current = frameId === 0 ? tabs.get(tabId)?.documentId : documentId
            const doc = documents.get(current)
            callback(doc?.alive && doc.tabId === tabId ? { documentId: current } : null)
        }
    }
    const worker = () =>
        vm.runInNewContext(fs.readFileSync(ROOT + '/src/background.js', 'utf8'), { chrome })
    worker()
    const raw = fx.save({
        amounts: { 19: 1 },
        appearance: ORIGINAL.join(','),
        bakeryName: 'Original'
    }).raw
    const localStorage = fx.storage({ CookieClickerGame: raw })
    function open({
        tabId = ++nextDocument,
        name = 'Original',
        genes = ORIGINAL,
        path = '/cookieclicker/'
    } = {}) {
        const documentId = 'document-' + ++nextDocument
        documents.set(documentId, { tabId, alive: true })
        const url = 'https://orteil.dashnet.org' + path
        tabs.set(tabId, { url, documentId })
        if (path.includes('/beta/') && !localStorage.getItem('CookieClickerGameBeta'))
            localStorage.setItem('CookieClickerGameBeta', raw)
        const sender = {
            tab: { id: tabId },
            documentId,
            url
        }
        const h = boot({
            storage,
            localStorage,
            location: { pathname: path },
            clock: clock(),
            game: { bakeryName: name, genes },
            connectChrome(contentChrome) {
                contentChrome.runtime.sendMessage = (message, callback) => {
                    let replied = false
                    const respond = result => {
                        replied = true
                        const deliver = () => queueMicrotask(() => callback(structuredClone(result)))
                        const held = heldReplies.get(documentId + ':' + message.operation)
                        if (held) {
                            heldReplies.delete(documentId + ':' + message.operation)
                            held(deliver)
                        } else deliver()
                    }
                    for (const listener of listeners) listener(structuredClone(message), sender, respond)
                    assert.ok(replied || message.type === 'alakazam:journal')
                }
            }
        })
        h.documentId = documentId
        h.tabId = tabId
        h.game.state.exportSave = () => snapshot(h)
        return h
    }
    return {
        open,
        storage,
        kill: h => (documents.get(h.documentId).alive = false),
        close(h) {
            documents.get(h.documentId).alive = false
            tabs.delete(h.tabId)
        },
        navigateAway(h) {
            documents.get(h.documentId).alive = false
            tabs.set(h.tabId, { url: 'https://example.com/' })
        },
        navigationError(message, tabId = null) {
            navigationError = message
            navigationErrorTab = tabId
        },
        holdReply: (h, operation) =>
            new Promise(resolve => heldReplies.set(h.documentId + ':' + operation, resolve)),
        restartWorker() {
            listeners.length = 0
            worker()
        }
    }
}
function snapshot(h) {
    const parts = h.A.savefile.decode(h.ctx.localStorage.getItem(h.A.savefile.selectedKey())).split('|')
    const run = parts[2].split(';')
    run[2] = String(h.ctx.Date.now())
    run[3] = h.game.state.bakeryName
    run[5] = h.game.state.genes.join(',')
    parts[2] = run.join(';')
    return fx.encode(parts.join('|'))
}
function autosave(h) {
    const raw = snapshot(h)
    h.ctx.localStorage.setItem(h.A.savefile.selectedKey(), raw)
    return raw
}
async function ready(h) {
    await h.A.store.ready(h.A.identity.current())
    return h
}
async function settle(predicate) {
    for (let i = 0; i < 200; i++) {
        if (predicate()) return
        await new Promise(resolve => setImmediate(resolve))
    }
    assert.ok(predicate(), 'operation reached its explicit suspension boundary')
}
function recover(h, kind) {
    return kind === 'name' ? h.A.achievements.recoverName() : h.A.clones.recover()
}
function value(h, kind) {
    return kind === 'name' ? h.game.state.bakeryName : h.game.state.genes
}
async function suspended(h, kind) {
    let release
    if (kind === 'name') {
        const wait = h.A.safety.wait
        h.A.safety.wait = (owner, ms) => {
            if (ms === 350) return Promise.resolve()
            if (ms === 600) return new Promise(resolve => (release = resolve))
            return wait(owner, ms)
        }
    } else {
        const flush = h.A.store.flush
        let writes = 0
        h.A.store.flush = async () => {
            const ok = await flush()
            if (++writes === 3) await new Promise(resolve => (release = resolve))
            return ok
        }
    }
    const work = h.A.safety.run({ name: kind === 'name' ? 'achievements' : 'clones' }, () =>
        kind === 'name' ? h.A.achievements.godComplex() : h.A.clones.tick()
    )
    await settle(() => !!release)
    assert.notDeepEqual(value(h, kind), kind === 'name' ? 'Original' : ORIGINAL)
    return { work, release: () => release() }
}

for (const kind of ['name', 'clones']) {
    for (const unrelated of [false, true]) {
        test(`${kind}: a shared ${unrelated ? 'unrelated' : 'original'} tab cannot consume or rewrite a suspended document undo`, async () => {
            const ext = extension()
            const a = await ready(ext.open())
            const b = await ready(
                ext.open({
                    name: unrelated ? 'Player choice' : 'Original',
                    genes: unrelated ? [1, 1, 1, 1, 1, 1, 1] : ORIGINAL
                })
            )
            const boundary = await suspended(a, kind)
            const key = KEY[kind]
            const mark = plain(a.A.store.get(key))
            const field = a.A.store.fieldKey('legacy:' + mark.legacyId, key)
            const bValue = structuredClone(value(b, kind))
            // A may stay frozen indefinitely. Its browser document still exists,
            // including across worker restarts; wall-clock age is irrelevant.
            ext.restartWorker()
            b.ctx.Date = class extends Date {
                static now() {
                    return 9999999999999
                }
            }
            for (let i = 0; i < 3; i++) {
                const result = recover(b, kind)
                if (kind !== 'name') await result
                await b.A.registry.get(kind === 'name' ? 'achievements' : 'clones').tick()
                await b.A.store.flush()
                assert.deepEqual(
                    plain(ext.storage.disk[field].value || null),
                    mark,
                    'foreign recovery retains the durable undo'
                )
                if (kind === 'name') assert.equal(result, false, 'synchronous API')
                // Even trusted input or an accidental direct write cannot alter
                // another document's journal through the shared store.
                b.A.store.set(key, { ...mark, intervened: true })
                b.A.store.forget(key)
                await b.A.store.flush()
                assert.deepEqual(plain(ext.storage.disk[field].value), mark)
                assert.deepEqual(value(b, kind), bValue)
            }
            assert.equal(
                b.game.state.log.some(
                    line => line === 'prompt NameBakery' || line === 'prompt CustomizeYou'
                ),
                false
            )
            // The temporary save is written AFTER B tries to retire the undo.
            // Reload without letting A's old task reach its finally cleanup.
            autosave(a)
            ext.kill(a)
            // Let B run in the reload gap, before A's replacement initializes.
            // The original game tab reserves the handoff to that replacement.
            assert.equal(await b.A.store.claimRecovery(key), false)
            await recover(b, kind)
            await b.A.store.flush()
            assert.deepEqual(plain(ext.storage.disk[field].value), mark)
            const replacement = await ready(
                ext.open({ tabId: a.tabId, name: a.game.state.bakeryName, genes: a.game.state.genes })
            )
            const result = recover(replacement, kind)
            if (kind === 'name') assert.equal(result, true)
            else await result
            assert.deepEqual(value(replacement, kind), kind === 'name' ? 'Original' : ORIGINAL)
            assert.ok(replacement.A.store.get(key, null), 'temporary autosave still needs undo')
            autosave(replacement)
            await recover(replacement, kind)
            await replacement.A.store.flush()
            assert.equal(ext.storage.disk[field].deleted, true)
            const after = plain(ext.storage.disk[field])
            boundary.release()
            await boundary.work
            await a.A.store.flush()
            assert.deepEqual(
                ext.storage.disk[field],
                after,
                'stale old task cannot resurrect or consume the replacement undo'
            )
        })
    }

    test(`${kind}: competing local journal starts preserve one durable original`, async () => {
        const ext = extension()
        const a = await ready(ext.open())
        const b = await ready(ext.open({ name: 'Other original', genes: [1, 1, 1, 1, 1, 1, 1] }))
        const key = KEY[kind]
        const legacyId = a.A.identity.current().legacyId
        const mark = h =>
            kind === 'name'
                ? { legacyId, original: h.game.state.bakeryName, expected: 'Orteil' }
                : { legacyId, original: h.game.state.genes, expected: ORIGINAL }
        const results = await Promise.all([
            a.A.store.claimRecovery(key, mark(a)),
            b.A.store.claimRecovery(key, mark(b))
        ])
        assert.deepEqual(results, [true, false])
        assert.deepEqual(plain(b.A.store.get(key)), mark(a))
        b.A.store.set(key, mark(b))
        b.A.store.forget(key)
        await b.A.store.flush()
        assert.deepEqual(plain(a.A.store.get(key)), mark(a))
        assert.equal(b.A.store.ownsRecovery(key), false)
    })
}

test('a surviving foreign tab claims an owner journal after its tab closes without reloading', async () => {
    const ext = extension()
    const a = await ready(ext.open())
    const b = await ready(ext.open({ name: 'Orteil' }))
    const boundary = await suspended(a, 'name')
    autosave(a)
    assert.equal(b.A.achievements.recoverName(), false)
    ext.close(a)
    await settle(() => b.A.store.ownsRecovery(KEY.name))
    assert.equal(b.A.achievements.recoverName(), true)
    assert.equal(b.game.state.bakeryName, 'Original')
    boundary.release()
    await boundary.work
})

test('an unavailable document-liveness query preserves undo and permits a later retry', async () => {
    const ext = extension()
    const a = await ready(ext.open())
    const boundary = await suspended(a, 'name')
    const b = await ready(ext.open())
    ext.navigationError('navigation temporarily unavailable')
    assert.equal(await b.A.store.claimRecovery(KEY.name), false)
    assert.equal(b.A.achievements.recoverName(), false)
    await b.A.store.flush()
    assert.ok(a.A.store.get(KEY.name))
    ext.navigationError('')
    ext.close(a)
    await settle(() => b.A.store.ownsRecovery(KEY.name))
    boundary.release()
    await boundary.work
})

for (const kind of ['name', 'clones']) {
    test(`${kind}: failed durable creation prevents mutation and a later attempt can retry`, async () => {
        const ext = extension()
        const h = await ready(ext.open())
        h.A.safety.wait = () => Promise.resolve()
        ext.storage.failNext('set')
        await h.A.safety.run({ name: kind === 'name' ? 'achievements' : 'clones' }, () =>
            kind === 'name' ? h.A.achievements.godComplex() : h.A.clones.tick()
        )
        assert.deepEqual(value(h, kind), kind === 'name' ? 'Original' : ORIGINAL)
        assert.equal(h.A.store.get(KEY[kind], null), null)
        const boundary = await suspended(h, kind)
        boundary.release()
        await boundary.work
        assert.deepEqual(value(h, kind), kind === 'name' ? 'Original' : ORIGINAL)
    })

    for (const action of ['pause', 'same-family import', 'different-family import']) {
        test(`${kind}: ${action} during document claim prevents the first mutation`, async () => {
            const ext = extension()
            const h = await ready(ext.open())
            h.A.safety.wait = () => Promise.resolve()
            const pending = ext.storage.deferNextSet()
            const work = h.A.safety.run({ name: kind === 'name' ? 'achievements' : 'clones' }, () =>
                kind === 'name' ? h.A.achievements.godComplex() : h.A.clones.tick()
            )
            const commit = await pending
            if (action === 'pause') h.A.scheduler.pause()
            else {
                h.game.state.bakeryName = 'Imported player choice'
                h.game.state.genes = [1, 1, 1, 1, 1, 1, 1]
                h.game.doc.getElementById('bakeryName').textContent = "Imported player choice's bakery"
                const raw = fx.save({
                    fullDate: action === 'different-family import' ? 1750000050000 : undefined,
                    bakeryName: h.game.state.bakeryName,
                    appearance: h.game.state.genes.join(','),
                    amounts: { 19: 1 }
                }).raw
                h.ctx.localStorage.setItem('CookieClickerGame', raw)
            }
            const expected = structuredClone(value(h, kind))
            commit()
            await work
            assert.deepEqual(value(h, kind), expected)
            assert.equal(h.A.safety.prompt(), null)
        })
    }

    for (const source of ['previousLegacyId', 'previousRecoveryId']) {
        test(`${kind}: owned document recovery preserves ${source} migration and tombstones`, async () => {
            const ext = extension()
            const temporary = [6, 5, 6, 1, 2, 3, 4]
            const h = ext.open({ name: 'Orteil', genes: temporary })
            autosave(h)
            const who = h.A.identity.current()
            const key = KEY[kind]
            const original = kind === 'name' ? 'Original' : ORIGINAL
            const expected = kind === 'name' ? 'Orteil' : temporary
            const mark = { legacyId: who[source], original, expected }
            ext.storage.disk['legacy:' + who[source]] = { [key]: structuredClone(mark) }
            await ready(h)
            assert.equal(h.A.store.ownsRecovery(key), true)
            await recover(h, kind)
            assert.deepEqual(value(h, kind), original)
            autosave(h)
            await recover(h, kind)
            await h.A.store.flush()
            ext.kill(h)
            const reloaded = await ready(ext.open({ tabId: h.tabId }))
            assert.equal(reloaded.A.store.get(key, null), null)
            assert.deepEqual(ext.storage.disk['legacy:' + who[source]][key], mark)
        })
    }
}

test('worker rejects a replaced document pending write while unrelated fields still flush', async () => {
    const ext = extension()
    const a = await ready(ext.open())
    const key = KEY.name
    const mark = { legacyId: a.A.identity.current().legacyId, original: 'Original', expected: 'Orteil' }
    assert.equal(await a.A.store.claimRecovery(key, mark), true)
    a.A.store.set(key, { ...mark, original: 'Stale replacement' })
    a.A.store.setSetting('autoclick', false)
    ext.kill(a)
    const b = await ready(ext.open({ tabId: a.tabId }))
    assert.equal(b.A.store.ownsRecovery(key), true)
    assert.equal(await a.A.store.flush(), false)
    assert.equal(a.A.store.stats().pending, 0)
    assert.equal(b.A.store.setting('autoclick'), false)
    assert.deepEqual(plain(b.A.store.get(key)), mark)
    const field = b.A.store.fieldKey('legacy:' + mark.legacyId, key)
    assert.deepEqual(ext.storage.disk[field].value, mark)
})

for (const kind of ['name', 'clones']) {
    test(`${kind}: simultaneous routines cannot replace the winning document original`, async () => {
        const ext = extension()
        const a = await ready(ext.open())
        const b = await ready(ext.open({ name: 'Other original', genes: [1, 1, 1, 1, 1, 1, 1] }))
        let release
        if (kind === 'name') {
            a.A.safety.wait = (owner, ms) =>
                ms === 600 ? new Promise(resolve => (release = resolve)) : Promise.resolve()
            b.A.safety.wait = () => Promise.resolve()
        } else {
            const flush = a.A.store.flush
            let writes = 0
            a.A.store.flush = async () => {
                const ok = await flush()
                if (++writes === 3) await new Promise(resolve => (release = resolve))
                return ok
            }
        }
        const start = h =>
            h.A.safety.run({ name: kind === 'name' ? 'achievements' : 'clones' }, () =>
                kind === 'name' ? h.A.achievements.godComplex() : h.A.clones.tick()
            )
        const first = start(a)
        let otherFinished = false
        const other = start(b).finally(() => (otherFinished = true))
        await settle(() => release && otherFinished)
        assert.deepEqual(value(b, kind), kind === 'name' ? 'Other original' : [1, 1, 1, 1, 1, 1, 1])
        assert.equal(b.A.safety.prompt(), null)
        const mark = a.A.store.get(KEY[kind])
        assert.deepEqual(plain(mark.original), kind === 'name' ? 'Original' : ORIGINAL)
        assert.equal(a.A.store.ownsRecovery(KEY[kind]), true)
        assert.equal(b.A.store.ownsRecovery(KEY[kind]), false)
        release()
        await Promise.all([first, other])
        assert.deepEqual(value(a, kind), kind === 'name' ? 'Original' : ORIGINAL)
    })
}

test('a browser missing-tab error releases ownership while retaining the journal for recovery', async () => {
    const ext = extension()
    const a = await ready(ext.open())
    const boundary = await suspended(a, 'name')
    autosave(a)
    ext.close(a)
    ext.navigationError(`No tab with id: ${a.tabId}.`, a.tabId)
    const b = await ready(ext.open({ name: 'Orteil' }))
    assert.equal(b.A.store.ownsRecovery(KEY.name), true)
    assert.equal(b.A.achievements.recoverName(), true)
    assert.equal(b.game.state.bakeryName, 'Original')
    boundary.release()
    await boundary.work
})

test('a delayed stale-write rejection cannot replace newer shared journal events', async () => {
    const ext = extension()
    const a = await ready(ext.open())
    const key = KEY.name
    const mark = { legacyId: a.A.identity.current().legacyId, original: 'Original', expected: 'Orteil' }
    assert.equal(await a.A.store.claimRecovery(key, mark), true)
    a.A.store.set(key, { ...mark, intervened: true })
    ext.kill(a)
    const b = await ready(ext.open({ tabId: a.tabId }))
    const held = ext.holdReply(a, 'write')
    const flushing = a.A.store.flush()
    const deliver = await held
    const latest = { ...mark, earned: true }
    b.A.store.set(key, latest)
    await b.A.store.flush()
    deliver()
    assert.equal(await flushing, false)
    assert.deepEqual(plain(a.A.store.get(key)), latest)
    assert.deepEqual(plain(b.A.store.get(key)), latest)
})

test('a foreign tab may recover after the owner navigates away from the game', async () => {
    const ext = extension()
    const a = await ready(ext.open())
    const boundary = await suspended(a, 'name')
    autosave(a)
    ext.navigateAway(a)
    const b = await ready(ext.open({ name: 'Orteil' }))
    assert.equal(b.A.store.ownsRecovery(KEY.name), true)
    assert.equal(b.A.achievements.recoverName(), true)
    assert.equal(b.game.state.bakeryName, 'Original')
    boundary.release()
    await boundary.work
})

for (const kind of ['name', 'clones']) {
    test(`${kind}: explicit legacy copy acquires ownership before promoting a valid source journal`, async () => {
        const ext = extension()
        const h = await ready(ext.open({ name: 'Orteil', genes: [6, 5, 6, 1, 2, 3, 4] }))
        autosave(h)
        const key = KEY[kind]
        const sourceId = 'aabbccdd'
        const mark = {
            legacyId: sourceId,
            original: kind === 'name' ? 'Original' : ORIGINAL,
            expected: kind === 'name' ? 'Orteil' : [6, 5, 6, 1, 2, 3, 4]
        }
        ext.storage.disk['legacy:' + sourceId] = { [key]: structuredClone(mark) }
        await h.A.store.copyLegacy(sourceId)
        assert.equal(h.A.store.ownsRecovery(key), true)
        assert.equal(h.A.store.get(key).legacyId, h.A.identity.current().legacyId)
        await recover(h, kind)
        assert.deepEqual(value(h, kind), mark.original)
        assert.deepEqual(ext.storage.disk['legacy:' + sourceId][key], mark)
    })
}

for (const kind of ['name', 'clones']) {
    test(`${kind}: a confirmed beta replacement releases stable recovery while its tab stays open`, async () => {
        const ext = extension()
        const a = await ready(ext.open())
        const boundary = await suspended(a, kind)
        autosave(a)
        const key = KEY[kind]
        const mark = plain(a.A.store.get(key))
        ext.kill(a)
        const beta = ext.open({ tabId: a.tabId, path: '/cookieclicker/beta/' })
        const b = await ready(ext.open({ name: a.game.state.bakeryName, genes: a.game.state.genes }))
        // A missing/initializing replacement does not forfeit reload protection.
        assert.equal(await b.A.store.claimRecovery(key), false)
        await beta.A.store.ready({ known: false })
        assert.equal(await b.A.store.claimRecovery(key), false)
        await ready(beta)
        assert.notEqual(beta.A.identity.current().familyId, mark.legacyId)
        ext.restartWorker()
        assert.equal(
            await b.A.store.claimRecovery(key),
            true,
            'known beta scope releases stable reservation across worker restart'
        )
        await recover(b, kind)
        assert.deepEqual(value(b, kind), kind === 'name' ? 'Original' : ORIGINAL)
        assert.ok(b.A.store.get(key), 'temporary stable autosave keeps durable undo')
        // Returning to stable can recover the original journal after the new
        // recovery owner has closed; the beta namespace never consumes it.
        ext.close(b)
        ext.kill(beta)
        const back = await ready(
            ext.open({ tabId: a.tabId, name: a.game.state.bakeryName, genes: a.game.state.genes })
        )
        await recover(back, kind)
        assert.deepEqual(value(back, kind), kind === 'name' ? 'Original' : ORIGINAL)
        boundary.release()
        await boundary.work
    })

    test(`${kind}: an unrelated-family import releases the old journal after its task drains`, async () => {
        const ext = extension()
        const a = await ready(ext.open())
        const boundary = await suspended(a, kind)
        const temporary = autosave(a)
        const key = KEY[kind]
        const mark = plain(a.A.store.get(key))
        const b = await ready(ext.open({ name: a.game.state.bakeryName, genes: a.game.state.genes }))
        a.game.state.bakeryName = 'Imported family'
        a.game.state.genes = [1, 1, 1, 1, 1, 1, 1]
        a.game.doc.getElementById('bakeryName').textContent = "Imported family's bakery"
        const imported = fx.save({
            fullDate: 1750000090000,
            bakeryName: 'Imported family',
            appearance: '1,1,1,1,1,1,1',
            amounts: { 19: 1 }
        }).raw
        a.ctx.localStorage.setItem('CookieClickerGame', imported)
        // While the old action is still suspended, its document remains owner.
        assert.equal(await b.A.store.claimRecovery(key), false)
        boundary.release()
        await boundary.work
        // Old-namespace writes still flush to their captured destination.
        a.A.store.set('oldFamilyPending', true)
        await a.A.scheduler.reconcile(a.A.identity.current())
        await a.A.store.flush()
        assert.equal(
            ext.storage.disk[a.A.store.fieldKey('legacy:' + mark.legacyId, 'oldFamilyPending')].value,
            true
        )
        // B is independently still running the original stable game/save.
        b.ctx.localStorage.setItem('CookieClickerGame', temporary)
        ext.restartWorker()
        assert.equal(
            await b.A.store.claimRecovery(key),
            true,
            'known unrelated family releases ownership in a surviving document'
        )
        await recover(b, kind)
        assert.deepEqual(value(b, kind), kind === 'name' ? 'Original' : ORIGINAL)
        ext.close(b)
        a.game.state.bakeryName = kind === 'name' ? 'Orteil' : 'Original'
        a.game.state.genes = kind === 'clones' ? plain(mark.previous) : ORIGINAL
        a.game.doc.getElementById('bakeryName').textContent = a.game.state.bakeryName + "'s bakery"
        await a.A.scheduler.reconcile(a.A.identity.current())
        await recover(a, kind)
        assert.deepEqual(value(a, kind), kind === 'name' ? 'Original' : ORIGINAL)
    })
}

for (const kind of ['name', 'clones']) {
    test(`${kind}: quarantine and an initializing reload keep the reservation until a known unrelated scope`, async () => {
        const ext = extension()
        const a = await ready(ext.open())
        const boundary = await suspended(a, kind)
        autosave(a)
        const key = KEY[kind]
        ext.kill(a)
        const beta = ext.open({ tabId: a.tabId, path: '/cookieclicker/beta/' })
        const b = await ready(ext.open({ name: a.game.state.bakeryName, genes: a.game.state.genes }))
        await ready(beta)
        await beta.A.store.ready({ known: false })
        ext.restartWorker()
        assert.equal(
            await b.A.store.claimRecovery(key),
            false,
            'quarantine invalidates the earlier unrelated scope'
        )
        // Hold the pending announcement's response after it has landed. A known
        // identity argument alone does not confirm a completed namespace load.
        const held = ext.holdReply(beta, 'namespace')
        const loading = ready(beta)
        const deliver = await held
        assert.equal(beta.A.store.isReady(), false)
        ext.restartWorker()
        assert.equal(
            await b.A.store.claimRecovery(key),
            false,
            'initializing state survives worker restart'
        )
        deliver()
        await loading
        assert.equal(await b.A.store.claimRecovery(key), true)
        boundary.release()
        await boundary.work
    })
}

test('stale document and namespace announcements cannot replace current quarantine confirmation', async () => {
    const ext = extension()
    const a = await ready(ext.open())
    ext.kill(a)
    const beta = await ready(ext.open({ tabId: a.tabId, path: '/cookieclicker/beta/' }))
    const field = 'journal:namespace:tab:' + beta.tabId
    const stale = plain(ext.storage.disk[field])
    await beta.A.store.ready({ known: false })
    const quarantined = plain(ext.storage.disk[field])
    const announce = (h, version, scope) =>
        new Promise(resolve =>
            h.ctx.chrome.runtime.sendMessage(
                {
                    type: 'alakazam:journal',
                    operation: 'namespace',
                    version,
                    scope,
                    settled: true
                },
                resolve
            )
        )
    assert.equal((await announce(beta, stale.version, stale.scope)).accepted, true)
    assert.deepEqual(ext.storage.disk[field], quarantined, 'lower namespace generation stays superseded')
    assert.match((await announce(a, 100, 'legacy:unrelated')).error, /no longer current/)
    assert.deepEqual(
        ext.storage.disk[field],
        quarantined,
        'old document cannot overwrite replacement confirmation'
    )
    ext.restartWorker()
    assert.deepEqual(ext.storage.disk[field], quarantined)
})
