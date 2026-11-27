// Runtime APIs are published by separately built content scripts in manifest order.
export interface AlakazamAPI {
    input: typeof import('../src/input').api
    hud: typeof import('../src/hud').api
    parse: typeof import('../src/parse').api
    dragon: typeof import('../src/modules/dragon').api
    wrinklers: typeof import('../src/modules/wrinklers').api
    garden: typeof import('../src/modules/garden').api
    shimmers: typeof import('../src/modules/shimmers').api
    autoclick: typeof import('../src/modules/autoclick').api
    gifts: typeof import('../src/modules/gifts').api
    lumps: typeof import('../src/modules/lumps').api
    achievements: typeof import('../src/modules/achievements').api
    grimoire: typeof import('../src/modules/grimoire').api
    ascend: typeof import('../src/modules/ascend').api
    market: typeof import('../src/modules/market').api
    clones: typeof import('../src/modules/clones').api
    pantheon: typeof import('../src/modules/pantheon').api
    purchase: typeof import('../src/modules/purchase').api
    ui: typeof import('../src/shared/ui').api
    clicks: typeof import('../src/measure/clicks').api
    save: typeof import('../src/measure/save').api
    catalog: typeof import('../src/measure/catalog').api
    income: typeof import('../src/measure/income').api
    live: typeof import('../src/measure/live').api
    buffs: typeof import('../src/measure/buffs').api
    status: typeof import('../src/core/status').api
    store: typeof import('../src/core/store').api
    safety: typeof import('../src/core/safety').api
    registry: typeof import('../src/core/registry').api
    scheduler: typeof import('../src/core/scheduler').api
    transactions: typeof import('../src/core/transactions').api
    savefile: typeof import('../src/core/savefile').api
    identity: typeof import('../src/core/identity').api
    data: {
        dragon: typeof import('../src/data/dragon').api
        loans: typeof import('../src/data/loans').api
        heavenly: typeof import('../src/data/heavenly').api
        effects: typeof import('../src/data/effects').api
        buildings: typeof import('../src/data/buildings').api
        plants: typeof import('../src/data/plants').api
        gods: typeof import('../src/data/gods').api
        clones: typeof import('../src/data/clones').api
    }
    act: {
        dragon: typeof import('../src/act/dragon').api
        drag: typeof import('../src/act/drag').api
        loans: typeof import('../src/act/loans').api
        store: typeof import('../src/act/store').api
        ascend: typeof import('../src/act/ascend').api
    }
    strategy: typeof import('../src/strategy/score').api & {
        dragon: typeof import('../src/strategy/dragon').api
        ascend: typeof import('../src/strategy/ascend').api
        pantheon: typeof import('../src/strategy/pantheon').api
    }
}

declare global {
    interface Window {
        Alakazam: AlakazamAPI
        // Diagnostic snapshots intentionally combine different module-specific shapes.
        __alakazam: Record<string, any>
    }
}
