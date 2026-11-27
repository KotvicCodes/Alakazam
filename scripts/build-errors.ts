export type BuildStage =
    | 'reading extension metadata'
    | 'reading package metadata'
    | 'checking versions'
    | 'reading the popup template'
    | 'preparing output'
    | 'compiling scripts'
    | 'copying assets'

const reasons = {
    ENOENT: 'a required input is missing',
    EACCES: 'access was denied',
    EPERM: 'the operation was not permitted',
    ENOSPC: 'storage is full',
    EIO: 'an input/output operation failed',
    EROFS: 'the filesystem is read-only',
    EMFILE: 'too many files are open',
    ENFILE: 'the system file limit was reached'
}

export function buildFailureMessage(stage: BuildStage, error: unknown): string {
    const prefix = `Extension build failed while ${stage}`
    if (stage === 'checking versions') return `${prefix}: package and manifest versions differ`
    if (error instanceof SyntaxError) return `${prefix}: metadata is not valid JSON`
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    if (typeof code === 'string' && Object.hasOwn(reasons, code)) {
        return `${prefix}: ${reasons[code]} (${code})`
    }
    const errors = error && typeof error === 'object' && 'errors' in error ? error.errors : undefined
    if (stage === 'compiling scripts' && Array.isArray(errors) && errors.length) {
        return `${prefix}: ${errors.length} compiler error(s); run npm run typecheck`
    }
    // Error messages, paths, source excerpts, and stacks can contain private data.
    return `${prefix}: the operation failed`
}
