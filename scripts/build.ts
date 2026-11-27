import { build } from 'esbuild'
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

async function main() {
    const root = resolve(__dirname, '..')
    const manifest: chrome.runtime.ManifestV3 = JSON.parse(
        await readFile(resolve(root, 'manifest.json'), 'utf8')
    )
    const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
    if (manifest.version !== pkg.version) throw new Error('Package and manifest versions must match')
    const popup = await readFile(resolve(root, 'popup.html'), 'utf8')
    const scripts = new Set<string>([
        ...manifest.content_scripts.flatMap((entry: { js: string[] }) => entry.js),
        manifest.background.service_worker,
        ...Array.from(popup.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), match => match[1])
    ])
    const outdir = resolve(root, 'dist')
    await rm(outdir, { recursive: true, force: true })
    await mkdir(outdir, { recursive: true })
    await build({
        absWorkingDir: root,
        entryPoints: [...scripts].map(file => file.replace(/\.js$/, '.ts')),
        outbase: '.',
        outdir,
        bundle: false,
        format: 'iife',
        platform: 'browser',
        target: 'chrome120',
        legalComments: 'none'
    })
    for (const file of ['manifest.json', 'popup.html', 'popup.css', 'icons', 'LICENSE']) {
        await cp(resolve(root, file), resolve(outdir, file), { recursive: true })
    }
    console.log(`Built Alakazam ${manifest.version} in dist/`)
}

main().catch(() => {
    console.error('Extension build failed')
    process.exitCode = 1
})
