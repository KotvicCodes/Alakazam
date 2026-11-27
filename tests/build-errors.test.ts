import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildFailureMessage } from '../scripts/build-errors'

const root = resolve(__dirname, '..')

function failingBuild(metadata?: string, files: Record<string, string> = {}) {
    const cache = resolve(root, '.cache')
    mkdirSync(cache, { recursive: true })
    const fixture = mkdtempSync(resolve(cache, 'build-error-'))
    try {
        mkdirSync(resolve(fixture, 'scripts'))
        for (const file of ['build.ts', 'build-errors.ts']) {
            cpSync(resolve(root, 'scripts', file), resolve(fixture, 'scripts', file))
        }
        if (metadata !== undefined) writeFileSync(resolve(fixture, 'manifest.json'), metadata)
        for (const [file, contents] of Object.entries(files)) {
            writeFileSync(resolve(fixture, file), contents)
        }
        return spawnSync(process.execPath, ['--import', 'tsx', resolve(fixture, 'scripts/build.ts')], {
            cwd: root,
            encoding: 'utf8'
        })
    } finally {
        rmSync(fixture, { recursive: true, force: true })
    }
}

test('a missing build input reports its stage and filesystem code and exits unsuccessfully', () => {
    const result = failingBuild()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /reading extension metadata: a required input is missing \(ENOENT\)/)
    assert.equal(result.stderr.includes(root), false)
    assert.equal(result.stderr.includes('manifest.json'), false)
})

test('invalid build metadata is diagnosed without exposing its contents', () => {
    const privateValue = 'private-build-fixture-value'
    const result = failingBuild(privateValue)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /reading extension metadata: metadata is not valid JSON/)
    assert.equal(result.stderr.includes(privateValue), false)
})

test('unexpected build errors and unrecognized codes cannot expose raw diagnostics', () => {
    const error = Object.assign(new Error('private-value'), {
        code: 'private-code',
        path: '/private/path'
    })
    assert.equal(
        buildFailureMessage('copying assets', error),
        'Extension build failed while copying assets: the operation failed'
    )
    assert.match(buildFailureMessage('compiling scripts', null), /compiling scripts/)
    assert.match(buildFailureMessage('checking versions', error), /versions differ/)
})

test('compiler failures report a count without printing source excerpts or paths', () => {
    const privateValue = 'private-compiler-fixture-value'
    const result = failingBuild(
        JSON.stringify({
            version: '1.4.1',
            content_scripts: [{ js: ['fixture.js'] }],
            background: { service_worker: 'fixture.js' }
        }),
        {
            'package.json': JSON.stringify({ version: '1.4.1' }),
            'popup.html': '',
            'fixture.ts': `const = '${privateValue}'`
        }
    )
    assert.equal(result.status, 1)
    assert.match(result.stderr, /compiling scripts: 1 compiler error\(s\); run npm run typecheck/)
    assert.equal(result.stderr.includes(privateValue), false)
    assert.equal(result.stderr.includes(root), false)
    assert.equal(result.stderr.includes('fixture.ts'), false)
})
