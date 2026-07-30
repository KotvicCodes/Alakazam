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
    // version specific. This list is what we have actually read the layout from.
    //
    // It is not a gate. It used to be: an unrecognised version marked the whole
    // parse untrusted, which meant every game patch silently switched off
    // everything that needs exact numbers, ascension included, until somebody
    // noticed and added a string here. The invariants in scalarsLookSane are the
    // real check, they are version independent, and they are what caught the last
    // layout drift. An unfamiliar version is worth saying out loud and nothing more.
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
        // Shiny wrinklers, written by Game.SaveWrinklers alongside the ordinary
        // pair much further up the section. These two were missing, which put
        // every field from here on two places out: `lumps` was reading the shiny
        // wrinkler count, `lumpCurrentType` was reading the lump's start
        // timestamp, and the layout check below rightly refused to trust any of
        // it. That is what left the ascension planner saying "save not
        // trustworthy" and the lump planner never harvesting or spending.
        'wrinklersShiny',
        'wrinklersShinyAmount',
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

    //* normalizeBase64
    // The game's own loader strips whitespace before decoding, so anything that
    // has been through a text field, a clipboard or a file has spaces and newlines
    // in it and is still a valid save. Beyond that this repairs the two things
    // that stop atob accepting an otherwise fine string: the URL-safe alphabet,
    // and padding that has been trimmed off the end.
    //
    // Returns null when the length is one more than a multiple of four, which no
    // amount of padding can make into valid base64.
    function normalizeBase64(body) {
        const s = body.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/')
        const remainder = s.length % 4
        if (remainder === 1) return null
        if (remainder === 0) return s
        return s + (remainder === 2 ? '==' : '=')
    }

    //* unescapeStored
    // The game does not put its base64 into localStorage directly. Game.WriteSave
    // stores `escape(base64 + '!END!')`, and Game.LoadSave calls `unescape` on the
    // way back in, before it goes looking for the marker. Exported save codes are
    // escaped the same way.
    //
    // escape() leaves most of the base64 alphabet alone but writes '=' as %3D, and
    // it turns the marker's exclamation marks into %21. So skipping this step
    // finds no marker to strip, hands a string full of percent signs to atob, and
    // reports a perfectly good save as "save is not base64". Which is exactly what
    // it did, on every save, in every real browser.
    //
    // Safe on input that was never escaped: base64 and the marker contain no
    // percent sign, so there is nothing here for it to change.
    function unescapeStored(raw) {
        return typeof unescape === 'function' ? unescape(raw) : raw
    }

    //* decodeDetailed
    // undoes Game.WriteSave: unescape, strip the !END! marker, base64 decode, then
    // undo the utf8 escaping the game applies before encoding.
    //
    // This reports which step failed rather than a single null. Every failure used
    // to collapse into "could not decode save", which said nothing about whether
    // the save was missing, not base64, or not text, and left no way to tell those
    // apart from a panel.
    //
    // The utf-8 step gets a fallback. One field in the save is free text, the
    // bakery name, and everything else is ASCII. Throwing away an entire save,
    // with the garden, the pantheon, every achievement and the click totals in it,
    // because one byte in a name is not valid utf-8, is a bad trade. On that
    // failure the raw bytes are used and the worst case is a mangled name.
    function decodeDetailed(raw) {
        if (!raw || typeof raw !== 'string') return { text: null, reason: 'no save found' }
        const body = normalizeBase64(unescapeStored(raw).split(END_MARKER)[0] || '')
        if (!body) return { text: null, reason: 'save is not base64' }

        let binary = null
        try {
            binary = atob(body)
        } catch (err) {
            return { text: null, reason: 'save is not base64' }
        }
        if (!binary) return { text: null, reason: 'save decoded to nothing' }

        try {
            // b64_to_utf8: decodeURIComponent(escape(atob(str)))
            return { text: decodeURIComponent(escape(binary)), reason: '' }
        } catch (err) {
            // only worth falling back for something that is recognisably a save.
            // base64 will happily decode arbitrary input into bytes, and handing
            // those on as text would turn "this is not a save" into a parse
            // failure further down, where it is much harder to read.
            if (binary.split('|').length <= S_BUFFS) {
                return { text: null, reason: 'save is not base64' }
            }
            return { text: binary, reason: 'save text was not valid utf-8' }
        }
    }

    //* decode
    // the plain form: decoded text, or null on anything that does not look like a
    // save. read() uses decodeDetailed so it can say which step failed.
    function decode(raw) {
        return decodeDetailed(raw).text
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
            seed: bits[4] || '',
            // the You building's clone appearance, seven comma-separated gene
            // indices. It lives in the run section but outlives the run: only a
            // hard reset clears it, not an ascension.
            appearance: parseAppearance(bits[5])
        }
    }

    //* parseAppearance
    // Game.YouCustomizer.save() is currentGenes.join(','). An empty or missing
    // field means the customizer has never been touched, which is a different
    // thing from every gene happening to be zero, so it comes back as null.
    function parseAppearance(raw) {
        if (!raw) return null
        const genes = String(raw)
            .split(',')
            .map(g => toNumber(g))
        if (genes.length === 0 || genes.some(g => !Number.isFinite(g))) return null
        return genes
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
        // the prestige fields are what ascension is decided on, so they get their
        // own check rather than riding on the lump ones
        if (!(s.resets >= 0) || !(s.prestige >= 0) || !(s.heavenlyChips >= 0)) return false
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
            stale: !scalars.trusted,
            reason: !scalars.trusted
                ? 'scalar layout drifted'
                : knownVersion
                  ? ''
                  : `game version ${version} is newer than this parser was read against`,
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

    //! saveKeys
    // CookieClickerGame is where the live game keeps its save, and it is tried
    // first. It is not the only possibility though: the beta writes elsewhere, and
    // the game has used a suffixed key before now. Rather than hard-code a list of
    // names that has already changed once, anything on this origin whose key
    // starts with CookieClickerGame is a candidate, best-known first.
    //
    // Only key names are read here. No value is inspected until it is decoded, and
    // no value is ever logged.
    function saveKeys() {
        const keys = [SAVE_KEY]
        try {
            for (let i = 0; i < window.localStorage.length; i++) {
                const key = window.localStorage.key(i)
                if (key && key !== SAVE_KEY && key.indexOf(SAVE_KEY) === 0) keys.push(key)
            }
        } catch (err) {
            // a locked-down localStorage still lets the primary key be attempted
        }
        return keys
    }

    //! read
    // the one impure entry point. content scripts share the page's origin, so
    // localStorage here is the game's own localStorage.
    //
    // Every candidate key is tried and the first one that parses wins. A key that
    // exists but does not decode is not fatal: the reason from the most promising
    // failure is kept, so the panel can say which step actually went wrong instead
    // of the flat "could not decode save" that covered four different problems.
    function read() {
        let failure = 'no save found'
        let found = false

        for (const key of saveKeys()) {
            let raw = null
            try {
                raw = window.localStorage.getItem(key)
            } catch (err) {
                return { ok: false, stale: true, reason: 'localStorage unavailable' }
            }
            if (!raw) continue
            found = true

            const decoded = decodeDetailed(raw)
            if (!decoded.text) {
                failure = decoded.reason
                continue
            }

            const parsed = parse(decoded.text)
            if (!parsed.ok) {
                failure = parsed.reason
                continue
            }
            // a mangled bakery name is worth mentioning but is not a parse problem,
            // so it only surfaces when there is nothing more important to say
            if (decoded.reason && !parsed.reason) parsed.reason = decoded.reason
            parsed.key = key
            return parsed
        }

        return { ok: false, stale: true, reason: found ? failure : 'no save found' }
    }

    //* rawFingerprint
    // a cheap change detector so callers can skip reparsing an unchanged save.
    //
    // This used to be the length and the first 24 characters, which was far too
    // weak to be a change detector at all. The save is base64, so those 24
    // characters cover the version and the start of the run metadata, and none of
    // that moves during a run. That left length as the only real signal, and two
    // consecutive autosaves very often have the same length: numbers keep their
    // digit count for long stretches. Whole autosaves were silently skipped, and
    // anything differencing the save's own totals over time saw the wrong gap.
    //
    // It is a hash now, over the whole string. That is a pass over ten or twenty
    // kilobytes once every two seconds, which is nothing, and unlike a slice it
    // notices a change wherever it happens. The digest is a number, so it still
    // never holds on to any of the save's contents.
    function rawFingerprint() {
        try {
            const raw = window.localStorage.getItem(SAVE_KEY)
            if (!raw) return ''
            // djb2: one multiply-add per character, folded to 32 bits by the
            // bitwise or, which is as much collision resistance as a change
            // detector between two consecutive saves ever needs
            let hash = 5381
            for (let i = 0; i < raw.length; i++) hash = (hash * 33 + raw.charCodeAt(i)) | 0
            return raw.length + ':' + hash
        } catch (err) {
            return ''
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.savefile = {
        read,
        rawFingerprint,
        decode,
        decodeDetailed,
        normalizeBase64,
        parse,
        SAVE_KEY,
        BUILDINGS,
        SCALAR_FIELDS,
        KNOWN_VERSIONS
    }
})()
