//! Tab Status Relay
// sender.tab is the browser's identity, so two tabs (even the same save) never
// overwrite one another. Only derived IDs and summaries cross this bridge.
const STATUS_PREFIX = 'status:tab:'
const NAMESPACE_PREFIX = 'journal:namespace:tab:'
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
chrome.tabs.onRemoved.addListener(tabId =>
    chrome.storage.local.remove([STATUS_PREFIX + tabId, NAMESPACE_PREFIX + tabId])
)
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
async function unrelatedNamespace(tabId, documentId, scope) {
    const field = NAMESPACE_PREFIX + tabId
    // An earlier transition announcement must land before a competing claim
    // can use the previous confirmed scope.
    if (journalQueues.has(field)) await journalQueues.get(field)
    const all = await journalCall(chrome.storage.local, 'get', [field])
    const held = all[field]
    return (
        held?.documentId === documentId &&
        held.settled === true &&
        typeof held.scope === 'string' &&
        held.scope.startsWith('legacy:') &&
        held.scope !== scope
    )
}
async function ownerBlocks(owner, claimant, scope) {
    if (await documentExists(owner))
        return !(await unrelatedNamespace(owner.tabId, owner.documentId, scope))
    if (owner.tabId === claimant.tabId) return false
    // Keep the handoff to a reloading game tab. Otherwise an unrelated tab can
    // seize/discard the undo between document destruction and replacement boot,
    // or keep the replacement's temporary save blocked behind its own live game.
    try {
        const tab = await journalCall(chrome.tabs, 'get', owner.tabId)
        if (!gameURL(tab?.url) && !gameURL(tab?.pendingUrl)) return false
        const frame = await journalCall(chrome.webNavigation, 'getFrame', {
            tabId: owner.tabId,
            frameId: 0
        })
        return !frame?.documentId || !(await unrelatedNamespace(owner.tabId, frame.documentId, scope))
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
        if (heldOwner && !sameDocument(heldOwner, owner) && (await ownerBlocks(heldOwner, owner, scope)))
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
async function namespaceRequest(message, sender) {
    const frame = await journalCall(chrome.webNavigation, 'getFrame', {
        tabId: sender.tab.id,
        frameId: 0
    })
    if (frame?.documentId !== sender.documentId)
        throw new Error('Namespace document is no longer current')
    const field = NAMESPACE_PREFIX + sender.tab.id
    const all = await journalCall(chrome.storage.local, 'get', [field])
    const held = all[field]
    if (
        held?.documentId === sender.documentId &&
        (held.version > message.version ||
            (held.version === message.version && held.settled && !message.settled))
    )
        return { accepted: true }
    await journalCall(chrome.storage.local, 'set', {
        [field]: {
            documentId: sender.documentId,
            scope: message.scope,
            version: message.version,
            settled: message.settled
        }
    })
    return { accepted: true }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== 'alakazam:journal' || !sender.tab || !gameURL(sender.url)) return
    const announcing = message.operation === 'namespace'
    if (
        !sender.documentId ||
        (announcing
            ? !Number.isSafeInteger(message.version) ||
              message.version < 1 ||
              typeof message.settled !== 'boolean' ||
              (message.scope !== null && !message.scope?.startsWith('legacy:'))
            : !message.scope?.startsWith('legacy:') ||
              !['bakeryNameRecovery', 'cloneRecovery'].includes(message.key))
    ) {
        respond({ error: 'Recovery requires a known save and browser document identity' })
        return
    }
    const field = announcing
        ? NAMESPACE_PREFIX + sender.tab.id
        : journalField(message.scope, message.key)
    const prior = journalQueues.get(field) || Promise.resolve()
    const work = prior
        .catch(() => {})
        .then(() => (announcing ? namespaceRequest(message, sender) : journalRequest(message, sender)))
    journalQueues.set(field, work)
    work.then(
        result => respond(result),
        error => respond({ error: error.message })
    ).finally(() => {
        if (journalQueues.get(field) === work) journalQueues.delete(field)
    })
    return true
})
