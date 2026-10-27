const { test } = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./harness')
const { El } = require('./dom')
const fx = require('./fixtures')

const ORIGINAL = [4, 5, 6, 1, 2, 3, 4]
const KEY = { clones: 'cloneRecovery', name: 'bakeryNameRecovery' }
const plain = value => JSON.parse(JSON.stringify(value))

async function ready(opts = {}) {
    const raw =
        opts.save ||
        fx.save({
            amounts: { 19: 1 },
            appearance: ORIGINAL.join(','),
            bakeryName: 'Original'
        }).raw
    const localStorage = fx.storage({ CookieClickerGame: raw })
    const h = boot({
        ...opts,
        save: raw,
        localStorage,
        game: { genes: ORIGINAL, bakeryName: 'Original', ...opts.game }
    })
    await h.A.store.ready(h.A.identity.current())
    return h
}

function autosave(h) {
    const sections = h.A.savefile.decode(h.ctx.localStorage.getItem('CookieClickerGame')).split('|')
    const run = sections[2].split(';')
    run[3] = h.game.state.bakeryName
    run[5] = h.game.state.genes.join(',')
    sections[2] = run.join(';')
    const raw = fx.encode(sections.join('|'))
    h.ctx.localStorage.setItem('CookieClickerGame', raw)
    return raw
}

// Take a real game snapshot during the temporary change, then let the routine
// finish in the same document. Game storage still contains that temporary save.
async function restored(kind) {
    const h = await ready()
    let raw
    if (kind === 'clones') {
        const flush = h.A.store.flush
        let writes = 0
        h.A.store.flush = async () => {
            const ok = await flush()
            if (++writes === 4) raw = autosave(h)
            return ok
        }
        try {
            await h.A.registry.get('clones').tick()
        } finally {
            h.A.store.flush = flush
        }
        assert.deepEqual(Array.from(h.A.savefile.read().run.appearance), [6, 5, 6, 1, 2, 3, 4])
    } else {
        const timer = h.ctx.setTimeout
        h.ctx.setTimeout = (fn, ms, ...args) => {
            if (ms === 600) {
                assert.equal(h.game.state.bakeryName, 'Orteil')
                raw = autosave(h)
            }
            if (ms === 350 || ms === 600) return fn()
            return timer(fn, ms, ...args)
        }
        try {
            await h.A.achievements.godComplex()
        } finally {
            h.ctx.setTimeout = timer
        }
    }
    assertOriginal(h, kind)
    assert.ok(h.A.store.get(KEY[kind], null))
    await h.A.store.flush()
    return { h, raw }
}

function assertOriginal(h, kind) {
    if (kind === 'clones') assert.deepEqual(h.game.state.genes, ORIGINAL)
    else assert.equal(h.game.state.bakeryName, 'Original')
}

function importSave(h, raw, method) {
    h.game.prompt('ImportSave', [
        [
            'Load',
            () => {
                const parsed = h.A.savefile.parse(h.A.savefile.decode(raw))
                h.game.state.genes = Array.from(parsed.run.appearance)
                h.game.state.bakeryName = parsed.run.bakeryName
                h.ctx.localStorage.setItem('CookieClickerGame', raw)
            }
        ],
        ['Cancel']
    ])
    const target = h.game.doc.getElementById('promptOption0')
    h.game.doc.fire(method, { isTrusted: true, target, key: 'Enter', keyCode: 13 })
    h.A.input.simulateClick(target)
}

// The native FileLoad route reads asynchronously, then imports without opening
// a prompt. Hold that completion explicitly so recovery can run while reading.
function importFile(h, raw) {
    const input = new El('input', { id: 'FileLoadInput' })
    h.game.doc.body.append(input)
    input.files = [{ text: raw }]
    let complete
    input.addEventListener('change', event => {
        const file = event.target.files[0]
        complete = () => {
            const parsed = h.A.savefile.parse(h.A.savefile.decode(file.text))
            h.game.state.exportSave = () => liveExport(h, file.text)
            h.game.state.genes = Array.from(parsed.run.appearance)
            h.game.state.bakeryName = parsed.run.bakeryName
            // LoadSave calls bakeryNameRefresh even for an unchanged name.
            h.game.doc.getElementById('bakeryName').textContent = parsed.run.bakeryName + "'s bakery"
        }
    })
    for (const type of ['pointerdown', 'input', 'change']) {
        h.game.doc.fire(type, { isTrusted: true, target: input })
    }
    input.dispatchEvent(new h.ctx.Event('change', { target: input }))
    return () => complete()
}

// ExportSave serializes the loaded game, independently of localStorage, and
// always writes a fresh lastDate. Cosmetics can keep moving after this load.
function liveExport(h, raw) {
    const sections = h.A.savefile.decode(raw).split('|')
    const run = sections[2].split(';')
    run[2] = String(Date.now())
    run[3] = h.game.state.bakeryName
    run[5] = h.game.state.genes.join(',')
    sections[2] = run.join(';')
    return fx.encode(sections.join('|'))
}

async function recover(h, kind, consumer = 'recovery') {
    if (consumer === 'tick')
        return h.A.registry.get(kind === 'clones' ? 'clones' : 'achievements').tick()
    if (kind === 'clones') return h.A.clones.recover()
    return h.A.achievements.recoverName()
}

for (const kind of ['clones', 'name']) {
    for (const consumer of ['tick', 'recovery']) {
        for (const delayed of [false, true]) {
            test(`${kind} ${consumer} recovers a no-prompt file import${delayed ? ' after recovery during the read' : ''}`, async () => {
                const { h, raw } = await restored(kind)
                const who = h.A.identity.current()
                const revision = h.A.safety.revision('prompt')
                const complete = importFile(h, raw)
                if (delayed) {
                    // Invalidation only at selection would be consumed here.
                    await recover(h, kind, consumer)
                    await recover(h, kind)
                    assertOriginal(h, kind)
                }
                const mark = plain(h.A.store.get(KEY[kind]))
                const before = h.A.safety.revision('prompt')
                const label = h.game.doc.getElementById('bakeryName').firstChild
                complete()
                assert.notEqual(h.game.doc.getElementById('bakeryName').firstChild, label)
                assert.equal(h.A.safety.prompt(), null)
                assert.equal(h.A.safety.revision('prompt'), before)
                if (!delayed) assert.equal(before, revision)
                assert.equal(h.A.identity.current().runId, who.runId)
                assert.deepEqual(plain(h.A.store.get(KEY[kind])), mark)
                assert.equal(h.ctx.localStorage.getItem('CookieClickerGame'), raw)

                await recover(h, kind, consumer)
                assertOriginal(h, kind)
                assert.ok(h.A.store.get(KEY[kind]), 'retain the undo until restoration is saved')
                const prompts = h.game.state.log.filter(line => line.startsWith('prompt ')).length
                await recover(h, kind, 'tick')
                await recover(h, kind)
                assert.equal(h.game.state.log.filter(line => line.startsWith('prompt ')).length, prompts)
                autosave(h)
                await recover(h, kind)
                assert.equal(h.A.store.get(KEY[kind], null), null)
            })
        }
    }

    for (const consumer of ['tick', 'recovery']) {
        for (const method of ['pointerdown', 'keydown']) {
            test(`${kind} ${consumer} recovers a same-document ${method} import after restoration`, async () => {
                const { h, raw } = await restored(kind)
                const who = h.A.identity.current()
                const mark = plain(h.A.store.get(KEY[kind]))
                importSave(h, raw, method)
                assert.equal(h.A.identity.current().runId, who.runId)
                assert.deepEqual(plain(h.A.store.get(KEY[kind])), mark)
                assert.equal(h.ctx.localStorage.getItem('CookieClickerGame'), raw)

                const result = await recover(h, kind, consumer)
                if (kind === 'name' && consumer === 'recovery') assert.equal(result, true)
                assertOriginal(h, kind)
                assert.equal(h.A.safety.prompt(), null)
                assert.ok(h.A.store.get(KEY[kind]), 'live restoration must survive until autosave')
                autosave(h)
                await recover(h, kind)
                assert.equal(h.A.store.get(KEY[kind], null), null)
            })
        }
    }

    test(`${kind} keeps an unsaved restoration without reopening its prompt`, async () => {
        const { h } = await restored(kind)
        const prompts = h.game.state.log.filter(line => line.startsWith('prompt ')).length
        await recover(h, kind, 'tick')
        await recover(h, kind)
        assertOriginal(h, kind)
        assert.equal(h.game.state.log.filter(line => line.startsWith('prompt ')).length, prompts)
        assert.ok(h.A.store.get(KEY[kind]))
        assert.equal(h.A.store.stats().pending, 0)
    })

    test(`${kind} recovers the imported temporary snapshot again after reload`, async () => {
        const { h, raw } = await restored(kind)
        importSave(h, raw, 'pointerdown')
        const reloaded = await ready({
            disk: h.disk,
            save: raw,
            game: { genes: [6, 5, 6, 1, 2, 3, 4], bakeryName: 'Orteil' }
        })
        await recover(reloaded, kind)
        assertOriginal(reloaded, kind)
        assert.ok(reloaded.A.store.get(KEY[kind]))
    })

    test(`${kind} rechecks an owned prompt instead of trusting cached restoration`, async () => {
        const { h } = await restored(kind)
        const input = h.A.safety.input(kind === 'clones' ? 'clones' : 'achievements')
        if (kind === 'clones') {
            input.simulateClick(h.game.doc.getElementById('row19').children[0])
            input.simulateClick(h.game.doc.getElementById('customizerSelect-R-hair'))
        } else {
            input.simulateClick(h.game.doc.getElementById('bakeryName'))
            input.typeInto(h.game.doc.getElementById('bakeryNameInput'), 'Orteil')
        }
        await recover(h, kind, 'tick')
        assertOriginal(h, kind)
        assert.equal(h.A.safety.prompt(), null)
        assert.ok(h.A.store.get(KEY[kind]))
    })

    test(`${kind} defers imported recovery around a foreign prompt`, async () => {
        const { h, raw } = await restored(kind)
        importSave(h, raw, 'pointerdown')
        h.game.prompt('WipeSave', [['Yes', () => assert.fail('answered foreign prompt')], ['No']])
        const prompt = h.A.safety.prompt()
        await recover(h, kind, 'tick')
        await recover(h, kind)
        assert.equal(h.A.safety.prompt(), prompt)
        assert.ok(h.A.store.get(KEY[kind]))
        h.A.input.simulateClick(h.game.doc.getElementById('promptOption1'))
        await recover(h, kind)
        assertOriginal(h, kind)
    })

    for (const owned of [false, true]) {
        test(`${kind} respects a manual ${owned ? 'journal-owned' : 'new'} value after cached restoration`, async () => {
            const { h } = await restored(kind)
            if (kind === 'clones') {
                h.A.input.simulateClick(h.game.doc.getElementById('row19').children[0])
                const target = h.game.doc.getElementById('customizerSelect-R-hair')
                h.game.doc.fire('pointerdown', { isTrusted: true, target })
                h.A.input.simulateClick(target)
                if (!owned) h.game.state.genes = [2, 4, 1, 0, 3, 5, 7]
            } else {
                h.A.input.simulateClick(h.game.doc.getElementById('bakeryName'))
                const input = h.game.doc.getElementById('bakeryNameInput')
                h.A.input.typeInto(input, owned ? 'Orteil' : 'My deliberate name')
                h.game.doc.fire('input', { isTrusted: true, target: input })
            }
            h.A.input.simulateClick(h.game.doc.getElementById('promptOption0'))
            const chosen = kind === 'clones' ? h.game.state.genes.slice() : h.game.state.bakeryName
            await recover(h, kind, 'tick')
            await recover(h, kind)
            assert.deepEqual(kind === 'clones' ? h.game.state.genes : h.game.state.bakeryName, chosen)
            assert.equal(h.A.store.get(KEY[kind], null), null)
        })
    }
}

for (const kind of ['name', 'clones']) {
    for (const consumer of ['tick', 'recovery']) {
        for (const replacement of ['family', 'run']) {
            for (const unrelated of [false, true]) {
                test(`${kind} ${consumer} preserves ${replacement} file replacement and journal with ${unrelated ? 'unrelated' : 'owned'} cosmetics`, async () => {
                    const { h, raw } = await restored(kind)
                    const mark = plain(h.A.store.get(KEY[kind]))
                    const imported = fx.save({
                        ...(replacement === 'family'
                            ? { fullDate: 1750000009000 }
                            : { seed: 'replacement-run' }),
                        amounts: { 19: 1 },
                        appearance: unrelated ? '2,4,1,0,3,5,7' : '6,5,6,1,2,3,4',
                        bakeryName: unrelated ? 'Imported bakery' : 'Orteil'
                    }).raw
                    importFile(h, imported)()
                    const genes = h.game.state.genes.slice()
                    const name = h.game.state.bakeryName
                    await recover(h, kind, consumer)
                    const prompts = h.game.state.log.filter(line => line.startsWith('prompt ')).length
                    await recover(h, kind)
                    await recover(h, kind, 'tick')
                    assert.deepEqual(h.game.state.genes, genes)
                    assert.equal(h.game.state.bakeryName, name)
                    assert.deepEqual(plain(h.A.store.get(KEY[kind])), mark)
                    assert.equal(h.ctx.localStorage.getItem('CookieClickerGame'), raw)
                    assert.equal(
                        h.game.state.log.filter(line => line.startsWith('prompt ')).length,
                        prompts,
                        'unchanged mismatch must not reopen the export prompt'
                    )
                    await h.A.store.flush()
                    const who = h.A.identity.current()
                    assert.deepEqual(
                        h.disk[h.A.store.fieldKey('legacy:' + who.legacyId, KEY[kind])].value,
                        mark
                    )
                    // The same-run file must still recover before autosave.
                    importFile(h, raw)()
                    await recover(h, kind)
                    assertOriginal(h, kind)
                })
            }
        }
    }

    for (const invalid of ['malformed', 'unknown', 'stale', 'future']) {
        test(`${kind} keeps imported game and journal when live export is ${invalid}`, async () => {
            const { h, raw } = await restored(kind)
            const mark = plain(h.A.store.get(KEY[kind]))
            importFile(h, raw)()
            h.game.state.exportSave = () => {
                if (invalid === 'malformed') return 'not a save'
                const sections = h.A.savefile.decode(liveExport(h, raw)).split('|')
                const run = sections[2].split(';')
                if (invalid === 'unknown') run[4] = ''
                else run[2] = String(Date.now() + (invalid === 'stale' ? -10000 : 10000))
                sections[2] = run.join(';')
                return fx.encode(sections.join('|'))
            }
            const genes = h.game.state.genes.slice()
            const name = h.game.state.bakeryName
            await recover(h, kind)
            const prompts = h.game.state.log.filter(line => line.startsWith('prompt ')).length
            await recover(h, kind)
            assert.deepEqual(h.game.state.genes, genes)
            assert.equal(h.game.state.bakeryName, name)
            assert.deepEqual(plain(h.A.store.get(KEY[kind])), mark)
            assert.equal(h.game.state.log.filter(line => line.startsWith('prompt ')).length, prompts)
        })
    }
}

for (const replacement of ['family', 'run', 'same run']) {
    test(`clone restoration stops across a journal await when a ${replacement} file loads`, async () => {
        const { h, raw } = await restored('clones')
        importFile(h, raw)()
        const imported = fx.save({
            ...(replacement === 'family' ? { fullDate: 1750000009000 } : {}),
            ...(replacement === 'run' ? { seed: 'replacement-run' } : {}),
            amounts: { 19: 1 },
            appearance: '6,5,6,1,2,3,4',
            bakeryName: 'Orteil'
        }).raw
        const complete = importFile(h, imported)
        const flush = h.A.store.flush
        let mark
        let genes
        let importedOnce = false
        h.A.store.flush = async () => {
            const ok = await flush()
            if (!importedOnce) {
                importedOnce = true
                mark = plain(h.A.store.get(KEY.clones))
                complete()
                genes = h.game.state.genes.slice()
            }
            return ok
        }
        try {
            await recover(h, 'clones')
        } finally {
            h.A.store.flush = flush
        }
        assert.equal(importedOnce, true)
        assert.deepEqual(h.game.state.genes, genes)
        assert.equal(h.game.state.bakeryName, 'Orteil')
        assert.deepEqual(plain(h.A.store.get(KEY.clones)), mark)
        assert.equal(h.ctx.localStorage.getItem('CookieClickerGame'), raw)
    })
}

for (const replacement of ['family', 'run']) {
    for (const phase of ['menu wait', 'journal wait', 'name wait']) {
        test(`name routine preserves a ${replacement} file loaded during ${phase}`, async () => {
            const h = await ready()
            const raw = h.ctx.localStorage.getItem('CookieClickerGame')
            const imported = fx.save({
                ...(replacement === 'family'
                    ? { fullDate: 1750000009000 }
                    : { seed: 'replacement-run' }),
                amounts: { 19: 1 },
                appearance: '6,5,6,1,2,3,4',
                bakeryName: 'Orteil'
            }).raw
            // Selection precedes the action. Only FileReader completion crosses
            // its await, without another trusted event to revoke ownership.
            const complete = importFile(h, imported)
            let mark
            const load = () => {
                mark = plain(h.A.store.get(KEY.name, null))
                complete()
            }
            const flush = h.A.store.flush
            h.A.store.flush = async () => {
                const ok = await flush()
                if (phase === 'journal wait') load()
                return ok
            }
            const timer = h.ctx.setTimeout
            h.ctx.setTimeout = (fn, ms, ...args) => {
                if (ms === 350 || ms === 600) {
                    if ((ms === 350 && phase === 'menu wait') || (ms === 600 && phase === 'name wait'))
                        load()
                    return fn()
                }
                return timer(fn, ms, ...args)
            }
            try {
                await h.A.safety.run({ name: 'achievements' }, () => h.A.achievements.godComplex())
            } finally {
                h.ctx.setTimeout = timer
                h.A.store.flush = flush
            }
            assert.equal(h.game.state.bakeryName, 'Orteil')
            assert.deepEqual(h.game.state.genes, [6, 5, 6, 1, 2, 3, 4])
            assert.deepEqual(plain(h.A.store.get(KEY.name, null)), mark)
            assert.equal(h.ctx.localStorage.getItem('CookieClickerGame'), raw)
        })
    }
}

for (const kind of ['name', 'clones']) {
    test(`${kind} validates the selected beta variant when a stable save also exists`, async () => {
        const { h, raw } = await restored(kind)
        const storage = h.ctx.localStorage
        const key = 'CookieClickerGameBeta'
        storage.setItem(key, raw)
        h.ctx.location = { pathname: '/cookieclicker/beta/' }
        const who = h.A.identity.current()
        assert.notEqual(
            who.legacyId,
            h.A.identity.fromSave(h.A.savefile.parse(h.A.savefile.decode(raw))).legacyId
        )
        await h.A.store.ready(who)
        const mark =
            kind === 'name'
                ? { legacyId: who.legacyId, original: 'Original', expected: 'Orteil' }
                : { legacyId: who.legacyId, original: ORIGINAL, expected: [6, 5, 6, 1, 2, 3, 4] }
        h.A.store.set(KEY[kind], mark)
        importFile(h, raw)()
        await recover(h, kind)
        assertOriginal(h, kind)
        assert.ok(h.A.store.get(KEY[kind]))
        assert.equal(storage.getItem(key), raw)
        assert.equal(storage.getItem('CookieClickerGame'), raw)
    })
}

for (const kind of ['name', 'clones']) {
    test(`${kind} retries a refused live run when stored identity catches up without a DOM change`, async () => {
        const { h } = await restored(kind)
        const imported = fx.save({
            seed: 'new-live-run',
            amounts: { 19: 1 },
            appearance: '6,5,6,1,2,3,4',
            bakeryName: 'Orteil'
        }).raw
        importFile(h, imported)()
        const mark = plain(h.A.store.get(KEY[kind]))
        await recover(h, kind)
        assert.deepEqual(plain(h.A.store.get(KEY[kind])), mark)
        const label = h.game.doc.getElementById('bakeryName').firstChild
        h.ctx.localStorage.setItem('CookieClickerGame', imported)
        await recover(h, kind)
        assertOriginal(h, kind)
        if (kind === 'clones') assert.equal(h.game.doc.getElementById('bakeryName').firstChild, label)
        assert.ok(h.A.store.get(KEY[kind]))
    })
}

test('clone restoration rechecks a file completion after awaiting an already matching look', async () => {
    const { h, raw } = await restored('clones')
    const matching = fx.save({
        appearance: ORIGINAL.join(','),
        bakeryName: 'Original',
        amounts: { 19: 1 }
    }).raw
    importFile(h, matching)()
    const imported = fx.save({
        fullDate: 1750000009000,
        appearance: '6,5,6,1,2,3,4',
        bakeryName: 'Orteil',
        amounts: { 19: 1 }
    }).raw
    const complete = importFile(h, imported)
    const pending = recover(h, 'clones')
    const mark = plain(h.A.store.get(KEY.clones))
    complete()
    await pending
    assert.deepEqual(h.game.state.genes, [6, 5, 6, 1, 2, 3, 4])
    assert.equal(h.game.state.bakeryName, 'Orteil')
    assert.deepEqual(plain(h.A.store.get(KEY.clones)), mark)
    assert.equal(h.ctx.localStorage.getItem('CookieClickerGame'), raw)
})
