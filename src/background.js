//! Tab Status Relay
// sender.tab is the browser's identity, so two tabs (even the same save) never
// overwrite one another. Only derived IDs and summaries cross this bridge.
const STATUS_PREFIX = 'status:tab:'
const gameURL = url => /^https:\/\/orteil\.dashnet\.org\/cookieclicker\//.test(url || '')
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'alakazam:publish' || !sender.tab || !gameURL(sender.url)) return
    const status = {
        ...message.status,
        publicationError: '',
        tabId: sender.tab.id,
        url: sender.url,
        documentId: sender.documentId || '',
        receivedAt: Date.now()
    }
    chrome.storage.local.set({ [STATUS_PREFIX + sender.tab.id]: status }, () => {
        const error = chrome.runtime.lastError?.message
        respond(error ? { error } : { status })
    })
    return true
})
chrome.tabs.onRemoved.addListener(tabId => chrome.storage.local.remove(STATUS_PREFIX + tabId))
chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === 'loading') chrome.storage.local.remove(STATUS_PREFIX + tabId)
})

// Recovery is shared by save family, but an undo belongs to the document that
// can still mutate that game. Serialize claims and writes in the worker; a
// read/set pair in competing content scripts cannot arbitrate a new journal.
// Owners are separate fields so old journal validation and migration still work.
const journalQueues = new Map()
const journalField = (scope, key) => 'az2:' + encodeURIComponent(scope) + ':' + encodeURIComponent(key)
const sameDocument = (a, b) => a?.tabId === b?.tabId && a?.documentId === b?.documentId
function journalCall(api, method, argument) {
    return new Promise((resolve, reject) => {
        api[method](argument, result => {
            const error = chrome.runtime.lastError
            if (error) reject(new Error(error.message))
            else resolve(result)
        })
    })
}
async function documentExists(owner) {
    // This browser query does not wait for the page to respond. Frozen and
    // cached documents remain owners; elapsed time is never evidence of death.
    try {
        const frame = await journalCall(chrome.webNavigation, 'getFrame', {
            tabId: owner.tabId,
            documentId: owner.documentId
        })
        return !!frame && frame.documentId === owner.documentId
    } catch (error) {
        // Missing browser objects may be reported as an error instead of a null
        // frame. Other failures provide no evidence that the owner is gone.
        if (/^No (?:tab|frame|document) (?:with id|found)/i.test(error.message)) return false
        throw error
    }
}
async function ownerBlocks(owner, claimant) {
    if (await documentExists(owner)) return true
    if (owner.tabId === claimant.tabId) return false
    // Keep the handoff to a reloading game tab. Otherwise an unrelated tab can
    // seize/discard the undo between document destruction and replacement boot,
    // or keep the replacement's temporary save blocked behind its own live game.
    try {
        const tab = await journalCall(chrome.tabs, 'get', owner.tabId)
        return gameURL(tab?.url) || gameURL(tab?.pendingUrl)
    } catch (error) {
        if (/^No tab (?:with id|found)/i.test(error.message)) return false
        throw error
    }
}
async function journalRequest(message, sender) {
    const { scope, key, operation } = message
    const field = journalField(scope, key)
    const ownerField = journalField(scope, '@owner:' + key)
    const baseField = journalField(scope, '@base:' + key)
    const all = await journalCall(chrome.storage.local, 'get', [field, ownerField, baseField])
    const owner = { tabId: sender.tab.id, documentId: sender.documentId }
    const heldOwner = all[ownerField]?.value
    let record = all[field] || all[baseField]
    if (operation === 'claim') {
        if (message.begin && record && !record.deleted) return { owned: false, record, owner: heldOwner }
        if (heldOwner && !sameDocument(heldOwner, owner) && (await ownerBlocks(heldOwner, owner)))
            return { owned: false, record, owner: heldOwner }
        // A migration may still have its baseline queued locally. Only an absent
        // field can promote it; a durable tombstone must never be resurrected.
        if (!record && message.mark) record = { value: message.mark }
        if (message.begin && (!record || record.deleted)) record = { value: message.mark }
        if (!record || record.deleted) return { owned: false, record, owner: heldOwner }
        await journalCall(chrome.storage.local, 'set', {
            [field]: record,
            [ownerField]: { value: owner }
        })
        return { owned: true, record, owner }
    }
    if (operation !== 'write') throw new Error('Unknown recovery operation')
    if (!sameDocument(heldOwner, owner)) return { owned: false, record, owner: heldOwner }
    const values = { [field]: message.record }
    if (message.record.deleted) values[ownerField] = { deleted: true }
    await journalCall(chrome.storage.local, 'set', values)
    return { owned: true }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'alakazam:journal' || !sender.tab || !gameURL(sender.url)) return
    if (
        !sender.documentId ||
        !message.scope?.startsWith('legacy:') ||
        !['bakeryNameRecovery', 'cloneRecovery'].includes(message.key)
    ) {
        respond({ error: 'Recovery requires a known save and browser document identity' })
        return
    }
    const field = journalField(message.scope, message.key)
    const prior = journalQueues.get(field) || Promise.resolve()
    const work = prior.catch(() => {}).then(() => journalRequest(message, sender))
    journalQueues.set(field, work)
    work.then(
        result => respond(result),
        error => respond({ error: error.message })
    ).finally(() => {
        if (journalQueues.get(field) === work) journalQueues.delete(field)
    })
    return true
})
