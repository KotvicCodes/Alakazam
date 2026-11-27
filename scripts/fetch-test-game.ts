// Download into an ignored checkout; never copy a player's game or profile.
import { mkdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import pin from '../tests/browser/game-pin.json'
const destination = resolve(__dirname, '../.cache/cookieclicker')
const git = (...args: string[]) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
mkdirSync(destination, { recursive: true })
if (!existsSync(resolve(destination, '.git'))) {
    git('init', destination)
    git('-C', destination, 'remote', 'add', 'origin', pin.repository)
}
if (git('-C', destination, 'remote', 'get-url', 'origin') !== pin.repository) {
    throw new Error('Unexpected test-game remote; remove .cache/cookieclicker and retry')
}
try {
    git('-C', destination, 'cat-file', '-e', pin.commit + '^{commit}')
} catch {
    git('-C', destination, 'fetch', '--depth=1', 'origin', pin.commit)
}
if (git('-C', destination, 'status', '--porcelain')) {
    throw new Error('Test-game checkout is modified; remove .cache/cookieclicker and retry')
}
git('-C', destination, 'checkout', '--detach', pin.commit)
console.log(`Test game ${pin.version} at ${git('-C', destination, 'rev-parse', 'HEAD')}`)
