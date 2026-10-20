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
