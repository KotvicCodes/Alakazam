document.addEventListener('DOMContentLoaded', async () => {
  const refreshBtn = document.getElementById('refreshBtn')
  const statusDiv = document.getElementById('status')
  const gameDataDiv = document.getElementById('gameData')
  
  refreshBtn.addEventListener('click', loadGameData)
  
  // Load data on popup open
  await loadGameData()
})

async function loadGameData() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    
    if (!tab.url || !tab.url.includes('orteil.dashnet.org/cookieclicker')) {
      showStatus('Please open Cookie Clicker first!', false)
      return
    }
    
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'getGameData' })
    
    if (response.success) {
      displayGameData(response.data)
    } else {
      showStatus('Could not read game data', false)
    }
  } catch (error) {
    showStatus('Error connecting to game. Try refreshing the page.', false)
    console.error('Error:', error)
  }
}

function displayGameData(data) {
  const statusDiv = document.getElementById('status')
  const gameDataDiv = document.getElementById('gameData')
  
  statusDiv.style.display = 'none'
  gameDataDiv.style.display = 'block'
  
  document.getElementById('cookies').textContent = formatNumber(data.cookies)
  document.getElementById('cps').textContent = formatNumber(data.cookiesPs)
  document.getElementById('buildings').textContent = data.buildingCount
}

function showStatus(message, isSuccess) {
  const statusDiv = document.getElementById('status')
  const gameDataDiv = document.getElementById('gameData')
  
  statusDiv.style.display = 'block'
  gameDataDiv.style.display = 'none'
  statusDiv.innerHTML = `<p>${message}</p>`
}

function formatNumber(num) {
  if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T'
  if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B'
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M'
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K'
  return num.toFixed(0)
}
