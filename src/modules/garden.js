// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Garden
    // A 6x6 plot where planting the right pair of seeds next to each other can
    // mutate into a new species. Unlocking the whole seed log is the long game:
    // it is worth ten sugar lumps and a permanent bonus when sacrificed.
    //
    // The garden is the clearest case for reading the save. The plot contents and
    // the seed log are both in there exactly, and neither is rendered anywhere:
    // working them out from the page would mean hovering all thirty six tiles
    // every pass. Reading them costs nothing, so this module knows the whole
    // garden state for free.
    //
    // One thing the save does not settle is whether a plant has finished growing.
    // Tiles carry an age, but the age at which a plant counts as mature differs
    // per species, and those thresholds are not something this extension can read.
    // So maturity is confirmed from the live growth sprite, the same four stages
    // a player sees. Tooltip descriptions also mention maturity on young plants
    // and cannot establish that a plant is ready to harvest.

    const { simulateClick } = window.Alakazam.safety.input('garden')
    const { save, store, registry } = window.Alakazam
    const plants = window.Alakazam.data.plants

    const INTERVAL_MS = 20000
    const SIZE = 6

    let lastActionAt = 0

    //! Reading the plot

    function unlockedKeys(garden) {
        const keys = []
        for (let i = 0; i < plants.PLANTS.length; i++) {
            if (garden.unlocked[i]) keys.push(plants.PLANTS[i].key)
        }
        return keys
    }

    function state() {
        const garden = save.minigame('garden')
        const farm = save.building(2)
        if (!garden || !farm || farm.level < 1) return null

        const unlocked = unlockedKeys(garden)
        const occupied = []
        const empty = []

        for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
                if (!plants.isTileUnlocked(x, y, farm.level)) continue
                const tile = garden.plot[y][x]
                if (tile.empty) empty.push({ x, y })
                else occupied.push({ ...tile, plant: plants.byId(tile.plantId) })
            }
        }

        return {
            unlocked,
            unlockedCount: unlocked.length,
            total: plants.PLANTS.length,
            complete: unlocked.length >= plants.PLANTS.length,
            soil: garden.soil,
            frozen: garden.frozen,
            occupied,
            empty,
            // the plot only grows to a full 6x6 at farm level 9, so tiles beyond
            // the unlocked area simply never report as plantable
            plotTiles: occupied.length + empty.length
        }
    }

    //! Goals

    //* nextGoal
    // the cheapest not-yet-unlocked plant we could actually attempt: every parent
    // its recipe needs is already in the seed log. picking the highest chance
    // among those keeps the wait down.
    function nextGoal(s) {
        let best = null
        const slots = s.plotTiles ?? SIZE * SIZE
        for (const plant of plants.PLANTS) {
            if (s.unlocked.indexOf(plant.key) !== -1) continue
            for (const recipe of plants.recipesFor(plant.key)) {
                if (!plants.reachable(recipe, s.unlocked, slots)) continue
                const candidate = { plant, recipe }
                // Total plot size alone cannot establish room for a recipe.
                // Immortal plants may permanently block every eight-parent
                // nursery while another mutation remains possible nearby.
                if (Array.isArray(s.occupied) && Array.isArray(s.empty) && !bestNursery(s, candidate))
                    continue
                if (!best || recipe.chance > best.recipe.chance) best = candidate
            }
        }
        return best
    }

    //! Acting on tiles

    function tileEl(x, y) {
        return document.getElementById(`gardenTile-${x}-${y}`)
    }

    function seedEl(plantId) {
        return document.getElementById(`gardenSeed-${plantId}`)
    }

    //* stageOf
    // buildPlot in the game's minigameGarden.js renders bud/sprout/bloom/mature
    // in columns 1/2/3/4 of its 48px sprite sheet. buildPanel renders each seed
    // in column 0 of the same species row (which is NOT always the plant id).
    // https://github.com/ozh/cookieclicker/blob/gh-pages/minigameGarden.js
    // compare those live sprites instead of interpreting localized tooltip prose.
    // never cache readiness: even the same species can be replanted between ticks.
    function stageOf(tile) {
        const el = tileEl(tile.x, tile.y)
        const icon = document.getElementById(`gardenTileIcon-${tile.x}-${tile.y}`)
        const seed = seedEl(tile.plantId)
        const seedIcon = seed ? seed.querySelector('.gardenSeedIcon') : null
        if (!el || !el.isConnected || !icon || !el.contains(icon) || !seedIcon) return null
        if (el.style.display !== 'block' || icon.style.display !== 'block') return null
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return null

        const position = spritePosition(icon)
        const reference = spritePosition(seedIcon)
        if (!position || !reference || reference.x !== 0 || position.y !== reference.y) return null
        const stage = -position.x / 48
        return Number.isInteger(stage) && stage >= 1 && stage <= 4 ? stage : null
    }

    function spritePosition(el) {
        const match = /^(-?\d+)px\s+(-?\d+)px$/.exec(el.style.backgroundPosition || '')
        if (!match) return null
        const x = Number(match[1])
        const y = Number(match[2])
        return y <= 0 && y % 48 === 0 ? { x, y } : null
    }

    function isAdjacent(a, b) {
        return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && (a.x !== b.x || a.y !== b.y)
    }

    function compareScores(a, b) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return a[i] - b[i]
        }
        return 0
    }

    //* bestNursery
    // find the best empty tile that can host the current recipe's mutation, along
    // with the adjacent occupied parent tiles it uses and the empty neighbors left
    // to plant into
    function bestNursery(s, goal) {
        if (
            !s ||
            !goal ||
            !goal.recipe ||
            !Array.isArray(s.occupied) ||
            !Array.isArray(s.empty) ||
            s.empty.length === 0
        )
            return null

        const parents = goal.recipe.parents
        const neededCounts = {}
        for (const key of parents) {
            neededCounts[key] = (neededCounts[key] || 0) + 1
        }

        let best = null
        for (const center of s.empty) {
            const seenCounts = {}
            const matchedTiles = []
            for (const tile of s.occupied) {
                if (!isAdjacent(tile, center)) continue
                const key = tile.plant && tile.plant.key
                if (key && (seenCounts[key] || 0) < (neededCounts[key] || 0)) {
                    seenCounts[key] = (seenCounts[key] || 0) + 1
                    matchedTiles.push(tile)
                }
            }

            const missing = []
            for (const key of parents) {
                if (seenCounts[key] > 0) seenCounts[key]--
                else missing.push(key)
            }

            const neighbors = s.empty.filter(t => isAdjacent(t, center))
            if (neighbors.length < missing.length) continue

            const score = [
                matchedTiles.length,
                neighbors.length,
                neighbors.indexOf(s.empty[0]) !== -1 ? 1 : 0
            ]
            if (!best || compareScores(score, best.score) > 0) {
                best = { center, matchedTiles, missing, neighbors, score }
            }
        }
        return best
    }

    //* worthHarvesting
    // three reasons to pull a plant: it is a species we have never harvested and
    // doing so writes it into the seed log, it pays out cookies or a sugar lump,
    // or it is a weed crowding the plot. active mutation parents adjacent to the
    // chosen nursery stay planted once their own seed is unlocked so they can
    // mature and mutate; excess or non-viable copies are still harvested.
    function worthHarvesting(tile, s, goal = s ? nextGoal(s) : null) {
        if (!tile.plant) return null
        const key = tile.plant.key
        if (s.unlocked.indexOf(key) === -1) return 'unlocks its seed'
        if (goal && goal.recipe && goal.recipe.parents.indexOf(key) !== -1) {
            if (!Array.isArray(s.occupied) || !Array.isArray(s.empty)) return null
            const nursery = bestNursery(s, goal)
            if (nursery && nursery.matchedTiles.some(p => p.x === tile.x && p.y === tile.y)) {
                return null
            }
        }
        if (plants.VALUABLE.indexOf(key) !== -1) return 'pays out when harvested'
        if (plants.WEEDS.indexOf(key) !== -1) return 'is a weed'
        return null
    }

    function selectedSeed() {
        return document.querySelector('#gardenSeeds .gardenSeed.on')
    }

    function withSeed(seed, body) {
        const { safety } = window.Alakazam
        const ctx = safety.scope('garden')
        ctx.check()
        const lease = safety.acquire('gardenSeed', 'garden')
        if (!lease) return false
        const previous = selectedSeed()
        let after = previous
        try {
            if (previous !== seed) {
                if (previous) ctx.input('simulateClick', previous)
                if (seed) ctx.input('simulateClick', seed)
            }
            if (selectedSeed() !== seed) return false
            after = selectedSeed()
            const result = body()
            after = selectedSeed() // successful planting normally deselects the seed
            return result
        } finally {
            try {
                if (lease.valid() && selectedSeed() === after) {
                    ctx.cleanup(() => {
                        const current = selectedSeed()
                        if (current !== previous) {
                            if (current) ctx.input('simulateClick', current)
                            if (previous) ctx.input('simulateClick', previous)
                        }
                    })
                }
            } finally {
                lease.release()
            }
        }
    }

    function harvest(tile, why) {
        const el = tileEl(tile.x, tile.y)
        // the save can lag behind a harvest, death or replant. verify the current
        // visible species and stage immediately before clicking, without a hover
        // or an await during which the tile could change.
        if (!el || stageOf(tile) !== 4) return false
        if (!withSeed(null, () => simulateClick(el))) return false
        store.update('gardenHarvests', 0, n => n + 1)
        console.log(`Alakazam: harvesting ${tile.plant.name} at ${tile.x},${tile.y} (${why})`)
        return true
    }

    //* plant
    // planting is two clicks a player would also make: pick the seed, click the
    // tile. a locked seed has no button, so this fails quietly rather than
    // planting the wrong thing.
    function plantAt(plantKey, tile) {
        const plant = plants.byKey(plantKey)
        if (!plant) return false
        const seed = seedEl(plant.id)
        const el = tileEl(tile.x, tile.y)
        if (!seed || !el) return false
        if (el.style && el.style.display === 'none') return false
        if (seed.classList && seed.classList.contains('locked')) return false
        // an autosave may still call this empty after a plant has appeared here.
        // clicking an occupied tile would unearth it instead of planting.
        const icon = document.getElementById(`gardenTileIcon-${tile.x}-${tile.y}`)
        if (!icon || !el.contains(icon) || icon.style.display !== 'none') return false
        return withSeed(seed, () => simulateClick(el))
    }

    //* planPlanting
    // pair each missing recipe parent with an empty tile adjacent to the chosen
    // nursery tile while keeping that nursery tile empty for the mutation
    function planPlanting(s, goal) {
        const nursery = bestNursery(s, goal)
        if (!nursery || nursery.missing.length === 0) return []

        const pool = nursery.neighbors.slice()
        const active = nursery.matchedTiles.slice()
        const chosen = []

        while (chosen.length < nursery.missing.length && pool.length > 0) {
            let bestIdx = 0
            let bestAdj = -1
            for (let i = 0; i < pool.length; i++) {
                const adj = active.filter(p => isAdjacent(p, pool[i])).length
                if (adj > bestAdj) {
                    bestAdj = adj
                    bestIdx = i
                }
            }
            const [tile] = pool.splice(bestIdx, 1)
            chosen.push(tile)
            active.push(tile)
        }

        return chosen.map((tile, i) => ({ key: nursery.missing[i], tile }))
    }

    //* preferWoodChips
    // wood chips triple the mutation rate at the cost of how much the plants
    // themselves produce, which is the right trade while hunting for seeds and the
    // wrong one once the log is complete.
    function preferWoodChips(s) {
        if (s.complete) return
        const woodChips = plants.SOILS.find(soil => soil.key === 'woodChips')
        if (!woodChips || s.soil === woodChips.id) return
        const el = document.getElementById('gardenSoil-' + woodChips.id)
        if (!el || (el.classList && el.classList.contains('disabled'))) return
        simulateClick(el)
        console.log('Alakazam: switching the garden to wood chips to triple mutation chances')
    }

    //! Tick

    async function tick() {
        const s = state()
        if (!s) return

        const goal = nextGoal(s)
        window.__alakazam.garden = {
            unlocked: `${s.unlockedCount}/${s.total}`,
            complete: s.complete,
            soil: s.soil,
            occupied: s.occupied.length,
            empty: s.empty.length,
            goal: goal ? `${goal.plant.name} (${goal.recipe.chance}% per tick)` : 'none reachable'
        }

        if (s.frozen) return
        // planting and harvesting both take effect on the garden's own tick, so
        // acting more often than that achieves nothing
        if (Date.now() - lastActionAt < 30000) return

        preferWoodChips(s)

        // harvest anything finished and worth taking
        for (const tile of s.occupied) {
            const why = worthHarvesting(tile, s, goal)
            if (!why) continue
            if (!harvest(tile, why)) continue
            lastActionAt = Date.now()
            return
        }

        // then fill empty ground with whatever the current goal still lacks,
        // always keeping an empty nursery tile for the mutation to appear in
        for (const step of planPlanting(s, goal)) {
            if (plantAt(step.key, step.tile)) lastActionAt = Date.now()
        }
    }

    registry.register({ name: 'garden', interval: INTERVAL_MS, tick })

    window.Alakazam.garden = { state, nextGoal, worthHarvesting, withSeed, plantAt }
})()
