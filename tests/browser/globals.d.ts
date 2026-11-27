// External Cookie Clicker APIs are available only to browser test fixtures.
// The extension itself never reads Game in the page world.
export {}
declare global {
    const Game: any
    const Alakazam: import('../../types/runtime').AlakazamAPI
    const __alakazam: Record<string, any>
    interface Window {
        Game?: any
        runStartupSaveRetry?: any
        transactionProduct?: any
        refusedClicks?: any
        restoreLumpWait?: any
        releaseLumpWait?: any
        pendingLumpTick?: any
        restoreStoreWait?: any
        releaseStoreWait?: any
        pendingStoreBuy?: any
        restoreGiftWait?: any
        releaseGiftWait?: any
        generatedGiftCode?: any
        pendingGiftTick?: any
        recoverImportedCosmetic?: any
        restoreCosmeticFlush?: any
        releaseCosmeticFlush?: any
        pendingCosmetic?: any
        acceptanceControl?: any
        acceptanceScroll?: any
    }
}
