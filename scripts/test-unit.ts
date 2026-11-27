// Discover explicitly: Node 22 does not expand a directory passed to --test.
import { readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(__dirname, '..')
function discover(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = join(directory, entry.name)
        return entry.isDirectory() ? discover(file) : entry.name.endsWith('.test.ts') ? [file] : []
    })
}
const files = discover(join(root, 'tests')).sort()
if (!files.length) throw new Error('No unit tests discovered')
const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--test', '--test-timeout=120000', ...process.argv.slice(2), ...files],
    { cwd: root, stdio: 'inherit' }
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
