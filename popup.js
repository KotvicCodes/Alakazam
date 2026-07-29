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
    ascend: 'Ascension',
    clones: 'Clone look',
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

//* format
// Cookie Clicker's own magnitude suffixes, at every third power from a thousand
// up to 10^276, after which the game itself switches to an exponent.
//
// This is deliberately a copy of formatNumber in src/parse.js rather than a
// shared import. The popup is a separate document in a separate context with no
// access to the content scripts, and a two-file duplicate beats a build step for
// one function. Change one, change the other.
const MAGNITUDES = (() => {
    const bases = ['', 'Un', 'Do', 'Tr', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No']
    const tiers = ['', 'D', 'V', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No']
    const names = ['k', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc']
    for (let tier = 1; tier < tiers.length; tier++) {
        for (let base = 1; base < bases.length; base++) names.push(bases[base] + tiers[tier])
    }
    return names.map((suffix, i) => [Math.pow(10, 3 * (i + 1)), suffix]).reverse()
})()

function format(n) {
    if (!Number.isFinite(n)) return '-'
    if (n < 0) return '-' + format(-n)
    if (n < 1000) return n < 100 && n % 1 !== 0 ? trimZeros(n.toFixed(1)) : String(Math.round(n))
    for (const [value, suffix] of MAGNITUDES) {
        if (n < value) continue
        const scaled = n / value
        if (scaled >= 1000) break
        return trimZeros(scaled.toFixed(3)) + suffix
    }
    return n.toExponential(2)
}

function trimZeros(text) {
    return text.indexOf('.') === -1 ? text : text.replace(/\.?0+$/, '')
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
        // the master switch is the one that has to read at a glance, so it gets
        // the loud treatment: green running, red paused. the rest just light up.
        const classes = ['btn']
        if (key === 'enabled') {
            classes.push('btn-primary')
            if (!on) classes.push('active')
        } else if (on) {
            classes.push('on')
        }
        button.className = classes.join(' ')
        button.textContent =
            key === 'enabled' ? (on ? 'RUNNING' : 'PAUSED') : `${LABELS[key]}: ${on ? 'on' : 'off'}`
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
