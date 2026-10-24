;(function () {
    //! Shared Controls
    // plain scripts load in both the content script and popup; no bundler needed
    const LABELS = {
        enabled: 'Automation',
        autoclick: 'Autoclicker',
        shimmers: 'Golden cookies',
        wrinklers: 'Wrinklers',
        purchase: 'Buying',
        lumps: 'Sugar lumps',
        grimoire: 'Grimoire',
        pantheon: 'Pantheon',
        dragon: 'Dragon',
        garden: 'Garden',
        achievements: 'Achievements',
        marketTrading: 'Stock trading',
        ascend: 'Ascension',
        clones: 'Clone look',
        gifts: 'Gift codes',
        hud: 'In-page HUD'
    }
    const GROUPS = [
        { label: 'Clicking & buying', keys: ['autoclick', 'shimmers', 'wrinklers', 'purchase'] },
        {
            label: 'Minigames & resources',
            keys: ['lumps', 'grimoire', 'pantheon', 'dragon', 'garden', 'marketTrading']
        },
        { label: 'Progress & appearance', keys: ['achievements', 'ascend', 'clones', 'gifts'] },
        { label: 'Display', keys: ['hud'] }
    ]
    const DEFAULTS = Object.fromEntries(Object.keys(LABELS).map(key => [key, true]))
    const SETTINGS_KEY = 'settings'
    const STATUS_PREFIX = 'status:tab:'
    const STALE_MS = 30000

    function text(node, value) {
        const next = String(value ?? '-')
        if (node.textContent !== next) node.textContent = next
    }

    function moduleText(mod) {
        if (!mod) return 'Waiting for game'
        return mod.reason || mod.state
    }

    function headline(status) {
        if (status.publicationError) return `Status publication failed: ${status.publicationError}`
        if (status.storageError) return `Storage failed: ${status.storageError}`
        if (status.lifecycle === 'starting') return 'Starting up — waiting for the game'
        const paused = status.paused ? 'Paused · ' : ''
        const failed = status.modules.filter(mod => mod.disabled || mod.failures > 0)
        if (failed.length) return `${paused}Module failure: ${failed.map(mod => mod.name).join(', ')}`
        if (status.blockedReasons.length) return paused + status.blockedReasons.join('; ')
        if (status.paused) return 'Paused — status is live'
        return status.decision || 'Running — waiting for a decision'
    }

    function buildControls(container, change) {
        const buttons = new Map()
        for (const group of GROUPS) {
            const fieldset = document.createElement('fieldset')
            const legend = document.createElement('legend')
            legend.textContent = group.label
            fieldset.appendChild(legend)
            for (const key of group.keys) {
                const button = document.createElement('button')
                button.type = 'button'
                button.setAttribute('data-key', key)
                const label = document.createElement('span')
                label.textContent = LABELS[key]
                const state = document.createElement('small')
                button.appendChild(label)
                button.appendChild(state)
                button.addEventListener('click', () => change(key))
                fieldset.appendChild(button)
                buttons.set(key, { button, state })
            }
            container.appendChild(fieldset)
        }
        return buttons
    }

    function updateControls(buttons, settings, modules = []) {
        for (const [key, { button, state }] of buttons) {
            const on = settings[key] !== false
            button.setAttribute('aria-pressed', String(on))
            const mod = modules.find(mod => mod.name === key) || modules.find(mod => mod.setting === key)
            text(state, !on ? 'Off' : key === 'hud' ? 'On' : moduleText(mod))
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.ui = {
        LABELS,
        GROUPS,
        DEFAULTS,
        SETTINGS_KEY,
        STATUS_PREFIX,
        STALE_MS,
        text,
        moduleText,
        headline,
        buildControls,
        updateControls
    }
})()
