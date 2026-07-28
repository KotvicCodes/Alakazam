// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Save File Reader
    // Cookie Clicker writes its whole state to localStorage on the same origin we
    // run in, so a content script can read it without touching the Game object.
    // That save is the only practical source for things the page never renders:
    // the garden plot, every stock's hidden trend mode, pantheon swap timers,
    // grimoire magic, and the achievement/upgrade bitfields.
    //
    // Everything here except read() is pure (string in, plain object out) so it
    // can be unit tested under node without a DOM.
    //
    // Two hard rules for callers:
    //   - the save is written on autosave, so it lags up to 60s. Anything live
    //     (bank, CpS, prices) must still come from the DOM, never from here.
    //   - the raw string is never logged and never persisted verbatim.

    const SAVE_KEY = 'CookieClickerGame'
    const END_MARKER = '!END!'

    // section indices in the pipe-delimited save
    const S_VERSION = 0
    const S_RUN = 2 // section 1 is reserved and always empty
    const S_PREFS = 3
    const S_SCALARS = 4
    const S_BUILDINGS = 5
    const S_UPGRADES = 6
    const S_ACHIEVEMENTS = 7
    const S_BUFFS = 8

    //* Known-good game versions
    // the scalar section is positional with no field names, so its layout is
    // version specific. on an unrecognised version we still parse, but flag the
    // result so consumers fall back to the DOM instead of trusting field offsets.
    const KNOWN_VERSIONS = ['2.052', '2.053', '2.048', '2.047']

    //* Building order
    // matches Game.ObjectsById, which is the order records appear in the save
    const BUILDINGS = [
        'Cursor',
        'Grandma',
        'Farm',
        'Mine',
        'Factory',
        'Bank',
        'Temple',
        'Wizard tower',
        'Shipment',
        'Alchemy lab',
        'Portal',
        'Time machine',
        'Antimatter condenser',
        'Prism',
        'Chancemaker',
        'Fractal engine',
        'Javascript console',
        'Idleverse',
        'Cortex baker',
        'You'
    ]

    // which building index carries which minigame save in its 5th field
    const MINIGAME_OF = { 2: 'garden', 5: 'market', 6: 'pantheon', 7: 'grimoire' }

    //* Scalar field layout
    // the names of the semicolon-separated values in section 4, in order. this is
    // the single most version-fragile thing in the file, which is why parseScalars
    // cross-checks a few invariants and marks the result untrusted when they fail.
    const SCALAR_FIELDS = [
        'cookies',
        'cookiesEarned',
        'cookieClicks',
        'goldenClicks',
        'handmadeCookies',
        'missedGoldenClicks',
        'bgType',
        'milkType',
        'cookiesReset',
        'elderWrath',
        'pledges',
        'pledgeT',
        'nextResearch',
        'researchT',
        'resets',
        'goldenClicksLocal',
        'cookiesSucked',
        'wrinklersPopped',
        'santaLevel',
        'reindeerClicked',
        'seasonT',
        'seasonUses',
        'season',
        'wrinklersAmount',
        'wrinklersNumber',
        'prestige',
        'heavenlyChips',
        'heavenlyChipsSpent',
        'heavenlyCookies',
        'ascensionMode',
        'permanentUpgrade0',
        'permanentUpgrade1',
        'permanentUpgrade2',
        'permanentUpgrade3',
        'permanentUpgrade4',
        'dragonLevel',
        'dragonAura',
        'dragonAura2',
        'chimeType',
        'volume',
        'lumps',
        'lumpsTotal',
        'lumpT',
        'lumpRefill',
        'lumpCurrentType',
        'vault',
        'heralds',
        'fortuneGC',
        'fortuneCPS',
        'cookiesPsRawHighest',
        'volumeMusic',
        'cookiesSent',
        'cookiesReceived'
    ]

    //! Decoding

    //* decode
    // undoes Game.WriteSave: strip the !END! marker, base64 decode, then undo the
    // utf8 escaping the game applies before encoding. returns null on anything
    // that does not look like a save rather than throwing at the caller.
    function decode(raw) {
        if (!raw || typeof raw !== 'string') return null
        const body = raw.split(END_MARKER)[0]
        if (!body) return null
        try {
            // b64_to_utf8: decodeURIComponent(escape(atob(str)))
            return decodeURIComponent(escape(atob(body)))
        } catch (err) {
            return null
        }
    }

    //! Section parsers

    //* parseRun
    // section 2: startDate;fullDate;lastDate;bakeryName;seed
    // seed is the five-letter per-save RNG seed. it is what makes the game's
    // random events reproducible, and it doubles as a stable save identifier.
    function parseRun(section) {
        const bits = (section || '').split(';')
        return {
            startDate: toNumber(bits[0]), // this ascension began
            fullDate: toNumber(bits[1]), // this save was first created
            lastDate: toNumber(bits[2]),
            bakeryName: bits[3] || '',
            seed: bits[4] || ''
        }
    }

    //* parseScalars
    // section 4, positional. every value is read as a number except vault, which
    // is a comma-joined list of upgrade ids. `trusted` reports whether the layout
    // still looks like the one SCALAR_FIELDS describes.
    function parseScalars(section) {
        const bits = (section || '').split(';')
        const out = {}
        for (let i = 0; i < SCALAR_FIELDS.length; i++) {
            const name = SCALAR_FIELDS[i]
            out[name] = name === 'vault' ? parseIdList(bits[i]) : toNumber(bits[i])
        }
        out.trusted = scalarsLookSane(out, bits.length)
        return out
    }

    //* scalarsLookSane
    // cheap invariants that hold for every real save. if the game reorders the
    // scalar list in a future version these stop holding, and consumers that need
    // exact values (the sugar lump planner above all) fall back to the DOM.
    function scalarsLookSane(s, fieldCount) {
        if (fieldCount < SCALAR_FIELDS.length) return false
        if (!Number.isFinite(s.cookies) || s.cookies < 0) return false
        if (!Number.isFinite(s.cookiesEarned) || s.cookiesEarned < s.cookies) return false
        if (!Number.isFinite(s.lumps) || s.lumps < 0) return false
        if (s.lumpsTotal < s.lumps) return false
        if (!(s.lumpCurrentType >= 0 && s.lumpCurrentType <= 4)) return false
        // lumpT is a millisecond timestamp: sanity check it lands this century
        if (s.lumpT !== 0 && !(s.lumpT > 1e12 && s.lumpT < 4e12)) return false
        if (!(s.season >= 0)) return false
        return true
    }

    //* parseBuildings
    // section 5: one semicolon-separated record per building, each a comma list of
    // amount,bought,totalCookies,level,minigame,muted,highest.
    // the embedded minigame string is safe to split on commas because the
    // minigames deliberately encode with :, ! and spaces only.
    function parseBuildings(section) {
        const records = (section || '').split(';')
        const out = []
        for (let i = 0; i < BUILDINGS.length; i++) {
            const bits = (records[i] || '').split(',')
            const minigameRaw = bits[4] || ''
            const kind = MINIGAME_OF[i]
            out.push({
                id: i,
                name: BUILDINGS[i],
                amount: toNumber(bits[0]),
                bought: toNumber(bits[1]),
                totalCookies: toNumber(bits[2]),
                level: toNumber(bits[3]),
                muted: toNumber(bits[5]) === 1,
                highest: toNumber(bits[6]),
                minigame: kind ? parseMinigame(kind, minigameRaw) : null
            })
        }
        return out
    }

    //* parseBits
    // bitfields have no delimiter at all: one character per flag
    function parseBits(section) {
        const str = section || ''
        const out = new Array(str.length)
        for (let i = 0; i < str.length; i++) out[i] = str[i] === '1'
        return out
    }

    //* parseUpgrades
    // section 6 stores two bits per upgrade id: unlocked, then bought
    function parseUpgrades(section) {
        const bits = parseBits(section)
        const out = []
        for (let i = 0; i * 2 + 1 < bits.length; i++) {
            out.push({ id: i, unlocked: bits[i * 2], bought: bits[i * 2 + 1] })
        }
        return out
    }

    //* parseBuffs
    // section 8: type,maxTime,time,arg1,arg2,arg3 per buff. times are in frames
    // at the game's 30fps, so they are converted to seconds here.
    function parseBuffs(section) {
        const out = []
        for (const entry of (section || '').split(';')) {
            if (!entry) continue
            const bits = entry.split(',')
            out.push({
                type: toNumber(bits[0]),
                maxSeconds: toNumber(bits[1]) / 30,
                secondsLeft: toNumber(bits[2]) / 30,
                arg1: toNumber(bits[3]),
                arg2: toNumber(bits[4]),
                arg3: toNumber(bits[5])
            })
        }
        return out
    }

    //! Minigame sub-saves
    // each minigame serialises itself into its parent building's 5th field. the
    // formats below are taken from the game's own minigame*.js save() functions.

    function parseMinigame(kind, raw) {
        if (!raw) return null
        if (kind === 'garden') return parseGarden(raw)
        if (kind === 'market') return parseMarket(raw)
        if (kind === 'pantheon') return parsePantheon(raw)
        if (kind === 'grimoire') return parseGrimoire(raw)
        return null
    }

    //* parseGarden
    // "<meta> <unlockBits> <plot>" where meta is colon separated, unlockBits is
    // one character per plant species, and plot is 36 colon-separated id:age
    // pairs in row-major order. a plot id of 0 means the tile is empty; anything
    // else is the plant's index plus one.
    function parseGarden(raw) {
        const parts = raw.split(' ')
        const meta = (parts[0] || '').split(':')
        const unlocked = parseBits(parts[1])
        const flat = (parts[2] || '').split(':')

        const plot = []
        for (let y = 0; y < 6; y++) {
            const row = []
            for (let x = 0; x < 6; x++) {
                const at = (y * 6 + x) * 2
                const id = toNumber(flat[at])
                row.push({
                    x,
                    y,
                    empty: id === 0,
                    plantId: id === 0 ? -1 : id - 1,
                    age: toNumber(flat[at + 1])
                })
            }
            plot.push(row)
        }

        return {
            nextStep: toNumber(meta[0]),
            soil: toNumber(meta[1]),
            nextSoil: toNumber(meta[2]),
            frozen: toNumber(meta[3]) === 1,
            harvests: toNumber(meta[4]),
            harvestsTotal: toNumber(meta[5]),
            open: toNumber(meta[6]) === 1,
            convertTimes: toNumber(meta[7]),
            nextFreeze: toNumber(meta[8]),
            unlocked,
            plot
        }
    }

    //* parseMarket
    // "<office> <goods> <open>" where each good is
    // val*100:mode:delta*100:dur:stock:hidden:last:prev*100 terminated by '!'.
    // mode is the good's hidden trend, which the page never shows: 0 stable,
    // 1 slow rise, 2 slow fall, 3 fast rise, 4 fast fall, 5 chaotic.
    function parseMarket(raw) {
        const parts = raw.split(' ')
        const office = (parts[0] || '').split(':')
        const goods = []
        for (const entry of (parts[1] || '').split('!')) {
            if (!entry) continue
            const bits = entry.split(':')
            goods.push({
                id: goods.length,
                value: toNumber(bits[0]) / 100,
                mode: toNumber(bits[1]),
                delta: toNumber(bits[2]) / 100,
                duration: toNumber(bits[3]),
                stock: toNumber(bits[4]),
                hidden: toNumber(bits[5]) === 1,
                last: toNumber(bits[6]),
                prev: toNumber(bits[7]) / 100
            })
        }
        return {
            officeLevel: toNumber(office[0]),
            brokers: toNumber(office[1]),
            graphLines: toNumber(office[2]),
            profit: toNumber(office[3]),
            graphCols: toNumber(office[4]),
            goods,
            open: toNumber(parts[2]) === 1
        }
    }

    //* parsePantheon
    // "<slot0/slot1/slot2> <swaps> <swapT> <open>", -1 meaning an empty slot.
    // slots are diamond, ruby, jade in that order (strongest to mildest).
    function parsePantheon(raw) {
        const parts = raw.split(' ')
        const slots = (parts[0] || '').split('/').map(toNumber)
        return {
            slots: [pickSlot(slots[0]), pickSlot(slots[1]), pickSlot(slots[2])],
            swaps: toNumber(parts[1]),
            swapT: toNumber(parts[2]),
            open: toNumber(parts[3]) === 1
        }
    }

    function pickSlot(value) {
        return Number.isFinite(value) && value >= 0 ? value : -1
    }

    //* parseGrimoire
    // "<magic> <spellsCast> <spellsCastTotal> <open>". max magic is not stored:
    // it is derived from the wizard tower count and level, see modules/grimoire.
    function parseGrimoire(raw) {
        const parts = raw.split(' ')
        return {
            magic: toNumber(parts[0]),
            spellsCast: toNumber(parts[1]),
            spellsCastTotal: toNumber(parts[2]),
            open: toNumber(parts[3]) === 1
        }
    }

    //! Helpers

    function toNumber(value) {
        const n = parseFloat(value)
        return Number.isFinite(n) ? n : 0
    }

    function parseIdList(value) {
        if (!value) return []
        return value
            .split(',')
            .map(v => parseInt(v, 10))
            .filter(Number.isFinite)
    }

    //! parse
    // decoded save text in, structured state out. `stale` is set when we cannot
    // trust the field offsets, which is the signal for consumers to prefer the
    // DOM. a stale parse is still returned: the bitfields and minigame sub-saves
    // are self-delimiting and stay usable even when the scalar layout drifts.
    function parse(text) {
        if (!text) return { ok: false, stale: true, reason: 'empty save' }
        const sections = text.split('|')
        if (sections.length <= S_BUFFS) {
            return { ok: false, stale: true, reason: 'too few sections' }
        }

        const version = sections[S_VERSION] || ''
        const scalars = parseScalars(sections[S_SCALARS])
        const knownVersion = KNOWN_VERSIONS.indexOf(version) !== -1

        return {
            ok: true,
            stale: !knownVersion || !scalars.trusted,
            reason: knownVersion
                ? scalars.trusted
                    ? ''
                    : 'scalar layout drifted'
                : 'unknown game version',
            version,
            run: parseRun(sections[S_RUN]),
            prefs: parseBits(sections[S_PREFS]),
            scalars,
            buildings: parseBuildings(sections[S_BUILDINGS]),
            upgrades: parseUpgrades(sections[S_UPGRADES]),
            achievements: parseBits(sections[S_ACHIEVEMENTS]),
            buffs: parseBuffs(sections[S_BUFFS])
        }
    }

    //! read
    // the one impure entry point. content scripts share the page's origin, so
    // localStorage here is the game's own localStorage.
    function read() {
        let raw = null
        try {
            raw = window.localStorage.getItem(SAVE_KEY)
        } catch (err) {
            return { ok: false, stale: true, reason: 'localStorage unavailable' }
        }
        const text = decode(raw)
        if (!text) return { ok: false, stale: true, reason: 'could not decode save' }
        return parse(text)
    }

    //* rawFingerprint
    // a cheap change detector so callers can skip reparsing an unchanged save.
    // deliberately only the length and a short prefix: never the save contents.
    function rawFingerprint() {
        try {
            const raw = window.localStorage.getItem(SAVE_KEY)
            if (!raw) return ''
            return raw.length + ':' + raw.slice(0, 24)
        } catch (err) {
            return ''
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.savefile = {
        read,
        rawFingerprint,
        decode,
        parse,
        SAVE_KEY,
        BUILDINGS,
        SCALAR_FIELDS,
        KNOWN_VERSIONS
    }
})()
