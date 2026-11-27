import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { Script } from 'node:vm'

const root = resolve(__dirname, '..')
const output = resolve(root, 'dist')
const json = (directory: string, file: string) =>
    JSON.parse(readFileSync(resolve(directory, file), 'utf8'))

test('built extension preserves the manifest, script order, and package version', () => {
    const manifest = json(output, 'manifest.json')
    assert.deepEqual(manifest, json(root, 'manifest.json'))
    assert.equal(manifest.version, json(root, 'package.json').version)
    assert.equal(manifest.version, json(root, 'package-lock.json').version)
    assert.equal(manifest.version, json(root, 'package-lock.json').packages[''].version)

    const popup = readFileSync(resolve(output, 'popup.html'), 'utf8')
    assert.equal(popup, readFileSync(resolve(root, 'popup.html'), 'utf8'))
    const scripts = new Set<string>([
        ...manifest.content_scripts.flatMap((entry: { js: string[] }) => entry.js),
        manifest.background.service_worker,
        ...Array.from(popup.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), match => match[1])
    ])
    for (const file of scripts) {
        assert.equal(file.endsWith('.js'), true)
        // Plain browser scripts must have valid syntax without an ES module loader.
        new Script(readFileSync(resolve(output, file), 'utf8'), { filename: file })
    }
})

test('built extension contains runtime assets and excludes source and test tooling', () => {
    for (const file of [
        'popup.css',
        'LICENSE',
        'icons/icon16.png',
        'icons/icon48.png',
        'icons/icon128.png'
    ]) {
        assert.deepEqual(readFileSync(resolve(output, file)), readFileSync(resolve(root, file)))
    }
    for (const file of readdirSync(output, { recursive: true, encoding: 'utf8' })) {
        assert.equal(/\.tsx?$/.test(file), false)
        assert.equal(/^(tests|scripts|node_modules)(\/|$)/.test(file), false)
    }
})
