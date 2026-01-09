console.log('Cookie Clicker Optimizer: Content script loaded')

// Wait for the game to be ready
function waitForGame() {
  return new Promise((resolve) => {
    const checkGame = setInterval(() => {
      if (typeof Game !== 'undefined' && Game.ready) {
        clearInterval(checkGame)
        resolve()
      }
    }, 100)
  })
}

// Initialize when game is ready
waitForGame().then(() => {
  console.log('Cookie Clicker game detected and ready!')
  chrome.runtime.sendMessage({ action: 'contentScriptReady' })
})

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getGameData') {
    try {
      const data = getGameData()
      sendResponse({ success: true, data })
    } catch (error) {
      sendResponse({ success: false, error: error.message })
    }
  }
  return true
})

function getGameData() {
  if (typeof Game === 'undefined' || !Game.ready) {
    throw new Error('Game not ready')
  }
  
  return {
    cookies: Game.cookies,
    cookiesPs: Game.cookiesPs,
    cookiesEarned: Game.cookiesEarned,
    buildingCount: Object.keys(Game.Objects).reduce((sum, name) => sum + Game.Objects[name].amount, 0),
    goldenClicks: Game.goldenClicks,
    reindeerClicks: Game.reindeerClicked
  }
}
