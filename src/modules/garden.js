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
    // So maturity is confirmed the way a player confirms it: by hovering the tile
    // and reading what the game says. That is a handful of hovers every few
    // minutes, on the cold path, behind the same mutex as everything else.

    const { simulateClick } = window.Alakazam.input
    const { catalog, save, store, registry } = window.Alakazam
    const plants = window.Alakazam.data.plants

    const INTERVAL_MS = 20000
    const SIZE = 6

    // how long a stage reading stays good for. the garden only advances on its own
    // soil tick, three minutes at the fastest, so this is generous.
    const STAGE_TTL_MS = 60000

    const stageCache = new Map() // "x,y" -> { mature, plantId, at }

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
        for (const plant of plants.PLANTS) {
            if (plant.unplantable) continue
            if (s.unlocked.indexOf(plant.key) !== -1) continue
            for (const recipe of plants.recipesFor(plant.key)) {
                if (!plants.reachable(recipe, s.unlocked, s.plotTiles)) continue
                if (!best || recipe.chance > best.recipe.chance) best = { plant, recipe }
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
    // confirm whether a tile's plant has finished growing, by reading the tooltip
    // the game shows on hover. cached, because the garden changes slowly.
    async function stageOf(tile) {
        const key = `${tile.x},${tile.y}`
        const hit = stageCache.get(key)
        if (hit && hit.plantId === tile.plantId && Date.now() - hit.at < STAGE_TTL_MS) {
            return hit.mature
        }

        const el = tileEl(tile.x, tile.y)
        if (!el) return false
        const tip = await catalog.readTooltip(el)
        if (!tip) return false

        // the game names the stage in the tile tooltip. anything that is not
        // clearly mature is left alone, so a wording change means we harvest
        // nothing rather than harvesting early.
        const mature = /\bmature\b/i.test(tip.text)
        stageCache.set(key, { mature, plantId: tile.plantId, at: Date.now() })
        return mature
    }

    //* worthHarvesting
    // three reasons to pull a plant: it is a species we have never harvested and
    // doing so writes it into the seed log, it pays out cookies or a sugar lump,
    // or it is a weed crowding the plot.
    function worthHarvesting(tile, s) {
        if (!tile.plant) return null
        const key = tile.plant.key
        if (s.unlocked.indexOf(key) === -1) return 'unlocks its seed'
        if (plants.VALUABLE.indexOf(key) !== -1) return 'pays out when harvested'
        if (plants.WEEDS.indexOf(key) !== -1) return 'is a weed'
        return null
    }

    async function harvest(tile, why) {
        const el = tileEl(tile.x, tile.y)
        if (!el) return false
        simulateClick(el)
        stageCache.delete(`${tile.x},${tile.y}`)
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
        if (seed.classList && seed.classList.contains('locked')) return false
        simulateClick(seed)
        simulateClick(el)
        return true
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
            const why = worthHarvesting(tile, s)
            if (!why) continue
            if (!(await stageOf(tile))) continue
            lastActionAt = Date.now()
            await harvest(tile, why)
            return
        }

        // then fill empty ground with whatever the current goal needs
        if (!goal || s.empty.length === 0) return
        const needed = goal.recipe.parents
        for (let i = 0; i < Math.min(needed.length, s.empty.length); i++) {
            if (plantAt(needed[i], s.empty[i])) lastActionAt = Date.now()
        }
    }

    registry.register({ name: 'garden', interval: INTERVAL_MS, tick })

    window.Alakazam.garden = { state, nextGoal, worthHarvesting }
})()
