import type { ParsedSave } from '../core/savefile'

export interface SaveIdentity {
    known: boolean
    familyId: string
    legacyId: string
    runId: string
    previousLegacyId?: string | null
    previousRecoveryId?: string | null
    seed?: string
    ascensions?: number
}

export interface ModuleContext {
    now?: number
    budget?: { take(n?: number): boolean; readonly left: number }
    task?: ReturnType<typeof import('../core/safety').api.context>
}

export interface ResetContext {
    previousIdentity?: SaveIdentity
    identity?: SaveIdentity
}

export interface AutomationModule {
    name: string
    interval?: number | 'frame'
    setting?: string
    always?: boolean
    setup?: () => unknown
    reset?: (context: ResetContext) => unknown
    tick: (context?: ModuleContext) => unknown
}

export interface RegisteredModule extends AutomationModule {
    interval: number | 'frame'
    setting: string
    always: boolean
}

export interface SchedulerSlot {
    dueAt: number
    busy: boolean
    failures: number
    disabled: boolean
    ran: number
    lastError: string
}

export interface RecoveryOwner {
    tabId: number
    documentId: string
}

export interface RecoveryReply {
    owned?: boolean
    accepted?: boolean
    record?: { value?: unknown; deleted?: boolean }
    owner?: RecoveryOwner
    error?: string
}

export type LiveStatus = ReturnType<typeof import('../core/status').api.snapshot>
export type TabStatus = LiveStatus & {
    tabId: number
    documentId: string
    url: string
    receivedAt: number
}

export type SaveSnapshot = Partial<ParsedSave>
