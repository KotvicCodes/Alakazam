//

console.log('Alakazam: Content script loaded')

let autoClickerEnabled = false
let autoClickerInterval = null

// wait for the game to be ready
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

// initialize when game is ready
waitForGame().then(() => {
  console.log('Alakazam: Cookie Clicker game detected and ready!')
  chrome.runtime.sendMessage({ action: 'contentScriptReady' })
})

// listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
     if (request.action === 'getGameData') {
          try {
               const data = getGameData()
               sendResponse({ success: true, data })
          } catch (error) {
               sendResponse({ success: false, error: error.message })
          }
     }

     if (request.action === 'toggleAutoClicker') {
          autoClickerEnabled = !autoClickerEnabled
          if (autoClickerEnabled) {
               startAutoClicker()
          } else {
               stopAutoClicker()
          }
          sendResponse({ success: true, enabled: autoClickerEnabled })
     }

     if (request.action === 'getAutoClickerStatus') {
          sendResponse({ success: true, enabled: autoClickerEnabled })
     }

     return true
})

function startAutoClicker() {
     if (autoClickerInterval) return

     autoClickerInterval = setInterval(() => {
          if (typeof Game !== 'undefined' && Game.ready) {
               // click the big cookie
               Game.ClickCookie()
          }
     }, 10) // click every 10ms (100 clicks per second)
}

function stopAutoClicker() {
     if (autoClickerInterval) {
          clearInterval(autoClickerInterval)
          autoClickerInterval = null
     }
}

function getGameData() {
     if (typeof Game === 'undefined' || !Game.ready) {
          throw new Error('Game not ready')
     }

     return {
          cookies: Game.cookies,
          cookiesPs: Game.cookiesPs,
          cookiesEarned: Game.cookiesEarned,
          buildingCount: Object.keys(Game.Objects).reduce(
               (sum, name) => sum + Game.Objects[name].amount,
               0
          ),
          goldenClicks: Game.goldenClicks,
          reindeerClicks: Game.reindeerClicked
     }
}
