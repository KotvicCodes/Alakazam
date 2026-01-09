//! Background Service Worker

//* Extension Lifecycle
chrome.runtime.onInstalled.addListener(() => {
  console.log('Cookie Clicker Optimizer installed')
})

//* Message Handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'contentScriptReady') {
    console.log('Content script ready on tab:', sender.tab.id)
  }
  
  return true
})

//* Periodic Data Collection (Optional)
// you can implement periodic analysis here
// for example, check game state every minute
let analysisInterval = null

function startPeriodicAnalysis() {
  if (analysisInterval) return
  
  analysisInterval = setInterval(async () => {
    // you can implement periodic game state checks here
    const tabs = await chrome.tabs.query({ url: 'https://orteil.dashnet.org/cookieclicker/*' })
    
    tabs.forEach(async (tab) => {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'getGameData' })
        if (response.success) {
          // analyze the data and potentially send notifications
          // or store historical data for trend analysis
        }
      } catch (error) {
        // tab might not be ready
      }
    })
  }, 60000) // check every minute
}

function stopPeriodicAnalysis() {
  if (analysisInterval) {
    clearInterval(analysisInterval)
    analysisInterval = null
  }
}

// you can start/stop periodic analysis based on your needs
// startPeriodicAnalysis()