// Per-harness clock: never patches the test process's Date or real timers.
function clock(start = 1750000000000) {
    let now = start
    let nextId = 0
    const timers = new Map()
    class ControlledDate extends Date {
        constructor(...args) {
            super(...(args.length ? args : [now]))
        }
        static now() {
            return now
        }
    }
    function schedule(fn, delay = 0, interval = 0, args = []) {
        const id = ++nextId
        timers.set(id, { at: now + Math.max(0, delay), fn, interval, args })
        return id
    }
    return {
        Date: ControlledDate,
        setTimeout: (fn, ms, ...args) => schedule(fn, ms, 0, args),
        clearTimeout: id => timers.delete(id),
        setInterval: (fn, ms, ...args) => schedule(fn, Math.max(1, ms || 0), Math.max(1, ms || 0), args),
        clearInterval: id => timers.delete(id),
        now: () => now,
        advance(ms) {
            if (!Number.isFinite(ms) || ms < 0)
                throw new Error('Clock must advance by finite nonnegative milliseconds')
            const until = now + ms
            let count = 0
            while (true) {
                const entry = [...timers]
                    .filter(([, timer]) => timer.at <= until)
                    .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
                if (!entry) break
                if (++count > 10000) throw new Error('Clock timer loop exceeded 10000 callbacks')
                const [id, timer] = entry
                now = timer.at
                if (timer.interval) timer.at += timer.interval
                else timers.delete(id)
                timer.fn(...timer.args)
            }
            now = until
        }
    }
}
module.exports = { clock }
