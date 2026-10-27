;(function () {
    //! Cancellation & Shared UI Ownership
    // A tick keeps its generation through every await. Resuming never revives it.
    // UI leases serialize automation; DOM identity and trusted input keep a lease
    // from authorizing actions on a replacement prompt or a player's controls.
    const { store } = window.Alakazam
    const scopes = new Map()
    const leases = new Map()
    let generation = 0
    let paused = false
    let exclusive = null
    let promptOwner = null
    let userRevision = 0
    const revisions = new Map()
    const settingEpochs = new Map()
    const expected = {
        achievements: ['NameBakery', 'ExportSave'],
        clones: ['CustomizeYou', 'ExportSave'],
        gifts: ['GiftSend', 'GiftSendReady', 'GiftRedeem'],
        ascend: ['Ascend', 'Reincarnate', 'PickPermaUpgrade', 'ExportSave'],
        dragon: ['PickDragonAura'],
        lumps: ['SpendLump']
    }

    function cancelled() {
        const err = new Error('Automation cancelled or UI ownership changed')
        err.name = 'CancellationError'
        return err
    }

    function isCancellation(err) {
        return err && err.name === 'CancellationError'
    }

    function prompt() {
        const anchor = document.getElementById('promptAnchor')
        if (anchor && anchor.style.display === 'none') return null
        const content = document.getElementById('promptContent')
        if (content && content.firstChild) return content.firstChild
        // also handles the game's named content when it is mounted elsewhere
        return (
            Array.from(document.querySelectorAll('[id]')).find(
                node => node.id.startsWith('promptContent') && node.id !== 'promptContent'
            ) || null
        )
    }

    function ownsPrompt(owner, name) {
        const node = prompt()
        return !!(
            node &&
            promptOwner &&
            promptOwner.owner === owner &&
            promptOwner.node === node &&
            (!name || node.id === 'promptContent' + name)
        )
    }

    // Cosmetic guards may abort while the task is still active. Dismiss only
    // its exact original prompt; imports can leave it up, while trusted input
    // or a replacement prompt forfeits ownership. These options never commit edits.
    function dismissCosmeticPrompt(ctx, node) {
        const name = ctx.owner === 'achievements' ? 'NameBakery' : 'CustomizeYou'
        if (
            !['achievements', 'clones'].includes(ctx.owner) ||
            !node ||
            prompt() !== node ||
            !ownsPrompt(ctx.owner, name)
        )
            return
        const option = document.getElementById('promptOption' + (name === 'NameBakery' ? 2 : 0))
        if (option) ctx.cleanup(() => ctx.input('simulateClick', option))
    }

    function acquire(resource, owner) {
        if (leases.has(resource)) return null
        const lease = { owner, revision: revision(resource) }
        leases.set(resource, lease)
        return {
            valid: () => leases.get(resource) === lease && lease.revision === revision(resource),
            release: () => {
                if (leases.get(resource) === lease) leases.delete(resource)
            }
        }
    }

    function context(owner = '', setting = owner, always = false) {
        const born = generation
        const masterEpoch = settingEpochs.get('enabled') || 0
        const settingEpoch = settingEpochs.get(setting) || 0
        let invalid = false
        let cleanup = 0
        let promptLease = null
        return {
            owner,
            cancel() {
                invalid = true
            },
            release() {
                if (promptLease) promptLease.release()
            },
            get active() {
                return (
                    !invalid &&
                    (always ||
                        (born === generation &&
                            masterEpoch === (settingEpochs.get('enabled') || 0) &&
                            settingEpoch === (settingEpochs.get(setting) || 0) &&
                            !paused &&
                            (!exclusive || exclusive === owner) &&
                            store.moduleEnabled(setting)))
                )
            },
            check() {
                if (!cleanup && !this.active) throw cancelled()
            },
            cleanup(fn) {
                cleanup++
                try {
                    const result = fn()
                    if (result && typeof result.then === 'function')
                        return result.finally(() => cleanup--)
                    cleanup--
                    return result
                } catch (err) {
                    cleanup--
                    throw err
                }
            },
            input(method, ...args) {
                this.check()
                // store restoration may cross a foreign prompt, but only during
                // cleanup and only for the game's exact mode/quantity controls.
                // return before prompt bookkeeping so ownership stays untouched.
                if (method === 'restoreStoreControl') {
                    const node = args[0]
                    if (
                        !cleanup ||
                        args.length !== 1 ||
                        !/^storeBulk(Buy|Sell|1|10|100|Max)$/.test(node?.id || '') ||
                        document.getElementById(node.id) !== node
                    )
                        throw cancelled()
                    return window.Alakazam.input.simulateClick(node)
                }
                if (expected[owner] && scopes.get(owner) === this && !promptLease) {
                    promptLease = acquire('prompt', owner)
                    if (!promptLease) throw cancelled()
                }
                if (promptLease && !cleanup && !promptLease.valid()) throw cancelled()
                const before = prompt()
                if (before && !ownsPrompt(owner)) throw cancelled()
                if (before && !(expected[owner] || []).includes(before.id.slice(13))) throw cancelled()
                const result = window.Alakazam.input[method](...args)
                const after = prompt()
                if (after !== before) {
                    if (after && (expected[owner] || []).includes(after.id.slice(13))) {
                        promptOwner = { owner, node: after }
                    } else if (!after) promptOwner = null
                }
                return result
            }
        }
    }

    function scope(owner) {
        return scopes.get(owner) || context(owner)
    }

    function input(owner) {
        return Object.fromEntries(
            ['simulateClick', 'simulateClickAt', 'typeInto', 'hoverOn', 'hoverOff'].map(method => [
                method,
                (...args) => scope(owner).input(method, ...args)
            ])
        )
    }

    // Pass the same context down into action helpers, including after a wait.
    function bind(owner, api) {
        return Object.fromEntries(
            Object.entries(api).map(([key, value]) => [
                key,
                typeof value === 'function'
                    ? (...args) => {
                          const ctx = scope(owner)
                          ctx.check()
                          return value(...args, ctx)
                      }
                    : value
            ])
        )
    }

    async function wait(owner, ms) {
        const ctx = scope(owner)
        ctx.check()
        await new Promise(resolve => setTimeout(resolve, ms))
        ctx.check()
    }

    function run(mod, tick, ctx = {}) {
        if (scopes.has(mod.name)) return
        const task = context(mod.name, mod.setting, mod.always)
        if (!task.active) return
        const needsPrompt = !!expected[mod.name]
        if (needsPrompt && prompt() && !ownsPrompt(mod.name)) return
        scopes.set(mod.name, task)
        const finish = () => {
            try {
                if (!task.active && ownsPrompt(mod.name)) {
                    const name = prompt().id.slice(13)
                    // Gifts dismiss completed Wrap results only after persisting
                    // their code. Failed storage must leave that result visible.
                    if (name === 'GiftSendReady') return
                    const option = ['CustomizeYou', 'ExportSave'].includes(name)
                        ? 0
                        : name === 'NameBakery'
                          ? 2
                          : 1
                    task.cleanup(() =>
                        task.input(
                            'simulateClick',
                            // GiftRedeem has two promptOption0 elements and no option1.
                            name === 'GiftRedeem'
                                ? document.getElementById('darken')
                                : document.getElementById('promptOption' + option)
                        )
                    )
                }
            } finally {
                scopes.delete(mod.name)
                task.cancel()
                task.release()
            }
        }
        const fail = err => {
            if (!isCancellation(err)) throw err
        }
        try {
            const result = tick({ ...ctx, task })
            if (result && typeof result.then === 'function') return result.catch(fail).finally(finish)
            finish()
            return result
        } catch (err) {
            finish()
            return fail(err)
        }
    }

    function revision(resource) {
        return resource ? revisions.get(resource) || 0 : userRevision
    }

    // LoadSave refreshes this label with textContent, replacing its text node
    // even when the imported name is unchanged. Check the node synchronously:
    // FileReader.onload can finish long after selection and any intervening
    // recovery. Prompt revisions alone cannot prove cosmetics are still live.
    function cosmeticCheck() {
        const label = document.getElementById('bakeryName')
        const content = label?.firstChild
        const text = label?.textContent
        return () =>
            !!label &&
            !!text &&
            document.getElementById('bakeryName') === label &&
            label.firstChild === content &&
            label.textContent === text
    }

    let cosmeticIdentityProof = null
    const COSMETIC_RETRY_MS = 5000

    // Autosave identity can lag a file load. A fresh DOM export must agree with
    // it before recovery may consume a journal, including discarding one for a
    // newer player choice. Concrete mismatches stay cached until identity or
    // the live label changes. Unavailable/stale exports retry after a cooldown:
    // WriteSave(1) can temporarily reuse a snapshot when Game.time is throttled.
    function cosmeticIdentity(ctx, who) {
        const { identity, savefile, act } = window.Alakazam
        const current = () => {
            const live = identity.current()
            return live.known && live.runId === who.runId && live.legacyId === who.legacyId
        }
        if (!who.known || !current()) return null
        if (
            cosmeticIdentityProof?.valid() &&
            (cosmeticIdentityProof.retryAt === null || Date.now() < cosmeticIdentityProof.retryAt)
        )
            return cosmeticIdentityProof.proven
        if (prompt()) return null
        const unchanged = cosmeticCheck()
        const key = savefile.selectedKey()
        const valid = () => unchanged() && key === savefile.selectedKey() && current()
        const snapshot = act.ascend.liveSave(ctx)
        const live = identity.fromSave(snapshot)
        const proven =
            valid() && live.known && live.runId === who.runId && live.legacyId === who.legacyId
                ? valid
                : null
        cosmeticIdentityProof = {
            valid,
            proven,
            retryAt: live.known ? null : Date.now() + COSMETIC_RETRY_MS
        }
        return proven
    }

    function invalidate() {
        generation++
    }
    function pause() {
        paused = true
        invalidate()
    }
    function resume() {
        paused = false
    }
    function isolate(owner) {
        if (exclusive) return null
        exclusive = owner
        return () => {
            if (exclusive === owner) exclusive = null
        }
    }

    // Even a quick off/on during an await invalidates the old tick permanently.
    store.subscribe(settings => {
        for (const [key, enabled] of Object.entries(settings)) {
            if (enabled === false) settingEpochs.set(key, (settingEpochs.get(key) || 0) + 1)
        }
    })
    for (const type of ['pointerdown', 'keydown', 'input', 'mousemove']) {
        document.addEventListener(
            type,
            event => {
                if (!event.isTrusted) return
                const ids = []
                for (let node = event.target; node; node = node.parentElement || node.parent) {
                    if (node.id) ids.push(node.id)
                }
                if (ids.some(id => id.startsWith('alakazam-'))) return
                userRevision++
                const touch = resource => revisions.set(resource, revision(resource) + 1)
                touch('tooltip')
                if (type === 'mousemove') return
                // loading even a save from the same run forfeits deferred panel
                // cleanup. Dismissing Import Save leaves that permission intact.
                if (
                    prompt()?.id === 'promptContentImportSave' &&
                    ((type === 'pointerdown' && ids.includes('promptOption0')) ||
                        (type === 'keydown' && (event.key === 'Enter' || event.keyCode === 13)))
                )
                    touch('dragonPanel')
                const inPrompt = ids.some(id => id.startsWith('prompt') || id === 'darken')
                if (inPrompt) {
                    promptOwner = null
                    touch('prompt')
                }
                if (ids.some(id => id === 'store' || id.startsWith('storeBulk'))) touch('store')
                if (ids.some(id => id === 'specialPopup' || id === 'backgroundLeftCanvas'))
                    touch('dragonPanel')
                if (ids.some(id => id.startsWith('gardenSeed-') || id.startsWith('gardenTile-')))
                    touch('gardenSeed')
                if (type === 'input' && ids.includes('bakeryNameInput')) {
                    const mark = store.get('bakeryNameRecovery', null)
                    if (mark) store.set('bakeryNameRecovery', { ...mark, intervened: true })
                }
                if (ids.includes('promptContentCustomizeYou')) {
                    const mark = store.get('cloneRecovery', null)
                    if (mark) store.set('cloneRecovery', { ...mark, intervened: true })
                }
            },
            true
        )
    }

    window.Alakazam.safety = {
        context,
        scope,
        input,
        bind,
        wait,
        run,
        acquire,
        prompt,
        ownsPrompt,
        dismissCosmeticPrompt,
        invalidate,
        pause,
        resume,
        isolate,
        isCancellation,
        revision,
        cosmeticCheck,
        cosmeticIdentity
    }
})()
