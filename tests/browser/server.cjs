const http = require('node:http')
const { readFileSync } = require('node:fs')
const { resolve, extname, sep } = require('node:path')
const { execFileSync } = require('node:child_process')
const pin = require('./game-pin.json')
const root = resolve(__dirname, '../../.cache/cookieclicker')
const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (head !== pin.commit) throw new Error('Run npm run test:game:fetch first')
if (execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) {
    throw new Error('Test-game checkout must be clean')
}
const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.woff2': 'font/woff2',
    '.mp3': 'audio/mpeg'
}
http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(root + sep) || pathname.split('/').some(part => part.startsWith('.'))) {
        response.writeHead(403).end()
        return
    }
    try {
        const content = readFileSync(file)
        response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
        response.end(content)
    } catch {
        response.writeHead(404).end()
    }
}).listen(4173, '127.0.0.1')
