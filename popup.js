//! Toolbar Popup
// The popup runs in its own context and cannot see the game page at all. It talks
// to the content script the only way it can without a service worker: through
// chrome.storage. The HUD writes a status summary every few seconds, and setting
// changes made here reach the page through chrome.storage.onChanged.

const SETTINGS_KEY = 'settings'

const LABELS = {
    enabled: 'Master switch',
    autoclick: 'Autoclicker',
    shimmers: 'Golden cookies',
    wrinklers: 'Wrinklers',
    purchase: 'Buying',
    lumps: 'Sugar lumps',
    grimoire: 'Grimoire',
    pantheon: 'Pantheon',
    garden: 'Garden',
    achievements: 'Achievements',
    marketTrading: 'Stock trading',
    hud: 'In-page panel'
}

function get(keys) {
    return new Promise(resolve => chrome.storage.local.get(keys, resolve))
}

function set(obj) {
    return new Promise(resolve => chrome.storage.local.set(obj, resolve))
}

//* latestStatus
// the HUD writes status under whichever save it belongs to, so pick the most
// recently written one rather than guessing at a save id
function latestStatus(all) {
    let best = null
    for (const key of Object.keys(all)) {
        if (key.indexOf('legacy:') !== 0) continue
        const status = all[key] && all[key].status
        if (!status) continue
        if (!best || status.at > best.at) best = status
    }
    return best
}

function format(n) {
    if (!Number.isFinite(n)) return '-'
    if (n < 1000) return String(Math.round(n))
    const units = [
        [1e24, 'Sp'],
        [1e21, 'Sx'],
        [1e18, 'Qi'],
        [1e15, 'Qa'],
        [1e12, 'T'],
        [1e9, 'B'],
        [1e6, 'M'],
        [1e3, 'k']
    ]
    for (const [v, s] of units) if (n >= v) return `${(n / v).toFixed(2)}${s}`
    return String(Math.round(n))
}

async function render() {
    const all = await get(null)
    const settings = all[SETTINGS_KEY] || {}
    const status = latestStatus(all)

    const statusEl = document.getElementById('status')
    const controls = document.getElementById('controls')
    const data = document.getElementById('gameData')

    // a status older than half a minute means no game page is currently running
    const fresh = status && Date.now() - status.at < 30000
    if (!fresh) {
        statusEl.innerHTML = '<p>Open Cookie Clicker to begin analysis</p>'
        data.style.display = 'none'
    } else {
        statusEl.innerHTML = `<p>${status.decision || 'running'}</p>`
        data.style.display = ''
        document.getElementById('cookies').textContent = format(status.cookies)
        document.getElementById('cps').textContent = format(status.cps)
        document.getElementById('buildings').textContent = status.seeds
            ? `${status.seeds} seeds`
            : `${status.lumps === null || status.lumps === undefined ? '-' : status.lumps} lumps`
    }

    controls.style.display = ''
    controls.innerHTML = ''
    for (const key of Object.keys(LABELS)) {
        const on = settings[key] !== false
        const button = document.createElement('button')
        button.className = 'btn ' + (key === 'enabled' ? 'btn-primary' : '')
        button.textContent = `${LABELS[key]}: ${on ? 'on' : 'off'}`
        button.addEventListener('click', async () => {
            const current = (await get([SETTINGS_KEY]))[SETTINGS_KEY] || {}
            current[key] = !on
            await set({ [SETTINGS_KEY]: current })
            render()
        })
        controls.appendChild(button)
    }
}

//* showVersion
// read from the manifest rather than written into the markup. it was hardcoded,
// so it still claimed v1.0 ten releases later. deriving it means there is one
// version number in the project and no ritual to forget.
function showVersion() {
    const el = document.getElementById('version')
    if (!el) return
    const manifest = chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest() : null
    el.textContent = manifest ? `v${manifest.version}` : ''
}

document.addEventListener('DOMContentLoaded', () => {
    showVersion()
    render()
    // the page keeps writing status, so refresh while the popup is open
    setInterval(render, 2000)
    document.getElementById('refreshBtn').addEventListener('click', render)
})
