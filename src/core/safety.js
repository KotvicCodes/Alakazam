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
        achievements: ['NameBakery'],
        clones: ['CustomizeYou'],
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
                    const option = ['CustomizeYou', 'ExportSave', 'GiftSendReady'].includes(name)
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
        invalidate,
        pause,
        resume,
        isolate,
        isCancellation,
        revision
    }
})()
