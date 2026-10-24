// Discover explicitly: Node 22 does not expand a directory passed to --test.
const { readdirSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { spawnSync } = require('node:child_process')

const root = resolve(__dirname, '..')
function discover(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = join(directory, entry.name)
        return entry.isDirectory() ? discover(file) : entry.name.endsWith('.test.js') ? [file] : []
    })
}
const files = discover(join(root, 'tests')).sort()
if (!files.length) throw new Error('No unit tests discovered')
const result = spawnSync(
    process.execPath,
    ['--test', '--test-timeout=120000', ...process.argv.slice(2), ...files],
    { cwd: root, stdio: 'inherit' }
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
