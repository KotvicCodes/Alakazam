;(function () {
    //! Active Tab Popup
    const { ui, parse, store } = window.Alakazam
    const { STATUS_PREFIX, DEFAULTS, STALE_MS, text } = ui
    const byId = id => document.getElementById(id)
    let settings = { ...DEFAULTS }
    let storageReady = null

    function ready() {
        if (!storageReady)
            storageReady = store.ready('popup').catch(error => {
                storageReady = null
                throw error
            })
        return storageReady
    }
    let activeTabId = null
    let pageId = null
    let current = null
    let buttons
    let refreshing = false
    let saveError = ''
    let statusError = ''
    const diagnostics = new Map()

    function call(api, method, ...args) {
        return new Promise((resolve, reject) => {
            api[method](...args, result => {
                const error = chrome.runtime.lastError
                if (error) reject(new Error(error.message))
                else resolve(result)
            })
        })
    }

    function showErrors() {
        const error = [saveError, statusError].filter(Boolean).join('\n')
        byId('error').hidden = !error
        text(byId('error'), error || '')
    }

    async function persistSettings() {
        await ready()
        const saved = await store.flush()
        const persistence = store.stats()
        if (saved && !persistence.pending && !persistence.error) saveError = ''
        settings = store.allSettings()
        update()
        showErrors()
    }

    async function toggle(key) {
        try {
            await ready()
            store.setSetting(key, store.setting(key) === false)
            await persistSettings()
            await refresh()
        } catch (error) {
            saveError = `Could not save settings: ${error.message}`
            showErrors()
        }
    }

    function update() {
        const fresh = current && Date.now() - current.at < STALE_MS
        const paused = settings.enabled === false
        text(byId('pauseBtn'), paused ? 'Resume automation' : 'Pause automation')
        byId('pauseBtn').setAttribute('aria-pressed', String(Boolean(paused)))
        ui.updateControls(buttons, settings, fresh ? current.modules : [])
        byId('gameData').hidden = !fresh
        if (!current) return
        if (!fresh) {
            text(byId('statusLine'), 'Status is stale — reconnect to the game tab')
        } else {
            text(byId('statusLine'), ui.headline(current))
        }
        const who = current.identity
        text(
            byId('identity'),
            `Tab ${current.tabId} · Save ${who.known ? who.legacyId : 'unresolved'} · Run ${who.runId}`
        )
        text(
            byId('updated'),
            `Updated ${Math.max(0, Math.round((Date.now() - current.at) / 1000))}s ago · ${new Date(current.at).toLocaleTimeString()}`
        )
        text(byId('decision'), current.decision ? `Last decision: ${current.decision}` : '')
        text(
            byId('saveState'),
            `Save: ${current.save.ok ? 'read' : 'failed'}${current.save.stale ? ' (untrusted)' : ''}${current.save.reason ? ` · ${current.save.reason}` : ''}`
        )
        text(byId('cookies'), parse.formatNumber(current.cookies))
        text(byId('cps'), parse.formatNumber(current.cps))
        text(byId('buildings'), parse.formatNumber(current.buildings))
        const names = new Set()
        for (const mod of current.modules) {
            names.add(mod.name)
            if (!diagnostics.has(mod.name)) {
                const row = document.createElement('div')
                const name = document.createElement('dt')
                const value = document.createElement('dd')
                text(name, ui.LABELS[mod.name] || mod.name)
                row.append(name, value)
                byId('diagnostics').appendChild(row)
                diagnostics.set(mod.name, { row, value })
            }
            const { row, value } = diagnostics.get(mod.name)
            row.hidden = false
            text(
                value,
                `${fresh ? ui.moduleText(mod) : 'Stale'}${mod.failures ? ` · ${mod.failures} failure(s)` : ''}${mod.lastError ? ` · ${mod.lastError}` : ''}`
            )
        }
        for (const [name, { row }] of diagnostics) row.hidden = !names.has(name)
    }

    function disconnected(message) {
        current = null
        pageId = null
        text(byId('statusLine'), message)
        for (const id of ['identity', 'updated', 'decision', 'saveState']) text(byId(id), '')
        for (const { row } of diagnostics.values()) row.hidden = true
        update()
    }

    async function refresh() {
        if (refreshing) return
        refreshing = true
        try {
            const [tabs] = await Promise.all([
                call(chrome.tabs, 'query', { active: true, currentWindow: true }),
                ready()
            ])
            statusError = ''
            settings = store.allSettings()
            const tab = tabs[0]
            activeTabId = tab?.id ?? null
            if (!/^https:\/\/orteil\.dashnet\.org\/cookieclicker\//.test(tab?.url || '')) {
                disconnected('Select a Cookie Clicker tab to see its status')
                return
            }
            let reply
            try {
                reply = await call(chrome.tabs, 'sendMessage', activeTabId, {
                    type: 'alakazam:get-status'
                })
            } catch {
                disconnected('Game tab is not responding — wait for startup or reload it')
                return
            }
            if (reply?.status?.publicationError) throw new Error(reply.status.publicationError)
            pageId = reply?.status?.pageId
            // read the actual storage bridge, bound to this tab and document
            const key = STATUS_PREFIX + activeTabId
            const stored = await call(chrome.storage.local, 'get', key)
            const status = stored[key]
            if (!pageId || status?.pageId !== pageId || status.tabId !== activeTabId) {
                disconnected('Waiting for this game tab to publish status')
                return
            }
            current = status
            update()
        } catch (error) {
            disconnected('Could not read game status')
            statusError = error.message
        } finally {
            refreshing = false
            showErrors()
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const manifest = chrome.runtime.getManifest()
        text(byId('version'), `v${manifest.version}`)
        buttons = ui.buildControls(byId('controls'), toggle)
        byId('pauseBtn').addEventListener('click', () => toggle('enabled'))
        byId('refreshBtn').addEventListener('click', async () => {
            try {
                await persistSettings()
            } catch (error) {
                saveError = `Could not save settings: ${error.message}`
                showErrors()
            }
            await refresh()
        })
        store.subscribe(() => {
            settings = store.allSettings()
            update()
        })
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local') return
            const status = changes[STATUS_PREFIX + activeTabId]?.newValue
            if (status && status.pageId === pageId && status.tabId === activeTabId) current = status
            update()
        })
        refresh()
        setInterval(refresh, 2000)
    })
})()
