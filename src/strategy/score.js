// wrapped in an IIFE so its top-level names stay private: all content scripts
// share one scope, so bare top-level declarations across files would collide
;(function () {
    //! Local Strategy Engine
    // Pure functions over a view of the store: given what we measured, decide the
    // single best next purchase and how many of it to buy. Nothing here touches
    // the DOM; it returns a decision and the purchase module executes it through
    // the fair-play input layer. Keeping this pure and separate is what lets
    // smarter scorers (buff timing, ascension) slot in later.
    //
    // Everything is scored on one scale: payback in seconds, price divided by the
    // cookies per second it adds. Buildings and upgrades compete directly, which
    // is what stops the extension buying a worthless upgrade purely because it
    // happened to be the cheapest thing on screen.

    const { PRICE_GROWTH, COUNT_THRESHOLDS } = window.Alakazam.data.buildings
    const { formatDuration } = window.Alakazam.parse

    //! Why upgrades are not scored against buildings
    // They used to be. An upgrade whose tooltip could not be parsed was given an
    // assumed gain of a few percent of current production, and then had to beat
    // the best building on payback like anything else.
    //
    // That was wrong in a way that got worse the longer you played. The assumed
    // gain scaled with CpS, so the very same hundred-cookie upgrade scored a 2000
    // second payback at 1 CpS and a 2 second payback at 1000 CpS. Early on, when
    // upgrades matter most, none of them were ever bought. Later, every one of
    // them looked irresistible. The behaviour flipped purely because production
    // had grown, which is not a reason to change your mind about an upgrade.
    //
    // Cookie Clicker upgrades are almost always worth buying the moment you can
    // afford them: they are cheap relative to their effect and most are permanent
    // multipliers. So they are simply bought, cheapest first, ahead of buildings.
    // Buying the cheapest first means the drain loop works through them in order
    // and an expensive one waits until it is comfortably affordable.
    //
    // Parsed effects are still computed, because they are worth reporting and
    // they break ties, but nothing hinges on whether a tooltip could be read.

    // crossing a count threshold unlocks that building's next tiered upgrade, so
    // the purchase is worth more than the buildings alone. rather than invent a
    // CpS figure for an upgrade that does not exist yet, credit it as a discount
    // on payback: a threshold-crossing batch is treated as a third better.
    const THRESHOLD_DISCOUNT = 0.67

    // buying a batch that costs no more than this share of the bank is treated as
    // spending pocket change: see the second rule in chooseAmount
    const SURPLUS_SHARE = 0.05

    //* paybackSeconds
    // how long the thing takes to pay for itself: price divided by the cookies per
    // second it adds. lower is better. returns Infinity when it cannot be scored.
    function paybackSeconds(price, deltaCps) {
        if (!Number.isFinite(price) || !Number.isFinite(deltaCps) || deltaCps <= 0) {
            return Infinity
        }
        return price / deltaCps
    }

    //* sumPrice
    // total cost of buying `count` units, as a geometric series over the 15% per
    // unit price growth. kept here as well as in act/store so this file stays pure
    // and independently testable.
    function sumPrice(nextUnitPrice, count) {
        if (!Number.isFinite(nextUnitPrice) || count <= 0) return Infinity
        if (count === 1) return nextUnitPrice
        return (nextUnitPrice * (Math.pow(PRICE_GROWTH, count) - 1)) / (PRICE_GROWTH - 1)
    }

    //! Upgrade effects
    // Upgrade tooltips describe their effect in prose. These patterns cover the
    // shapes that carry almost all of the value in a run; anything unrecognised
    // falls back to the pessimistic prior above rather than being guessed at.

    //* normaliseName
    // tooltips say "Cursors" and "Wizard towers"; the store says "Cursor" and
    // "Wizard tower". compare on a lowercase, de-pluralised form.
    function normaliseName(name) {
        const n = (name || '').trim().toLowerCase()
        return n.endsWith('s') ? n.slice(0, -1) : n
    }

    function findBuilding(buildings, name) {
        const wanted = normaliseName(name)
        return buildings.find(b => normaliseName(b.name) === wanted) || null
    }

    //* buildingContribution
    // how much of current production one building line is responsible for
    function buildingContribution(building) {
        const cps = Number.isFinite(building.perUnitCps) ? building.perUnitCps : building.baseCps
        if (!Number.isFinite(cps) || !Number.isFinite(building.owned)) return NaN
        return cps * building.owned
    }

    //* upgradeDeltaCps
    // estimated cookies per second an upgrade would add. NaN when the description
    // is missing entirely; the prior is applied by the caller so that the reason
    // for a guess stays visible.
    function upgradeDeltaCps(upgrade, view) {
        const text = (upgrade.description || '').replace(/\s+/g, ' ')
        if (!text) return NaN

        // "Cursors are twice as efficient." / "... are 4 times as efficient."
        let m = /([\w' ]+?) are (twice|thrice|[\d.]+ times) as efficient/i.exec(text)
        if (m) {
            const building = findBuilding(view.buildings, m[1])
            const factor =
                m[2].toLowerCase() === 'twice'
                    ? 2
                    : m[2].toLowerCase() === 'thrice'
                      ? 3
                      : parseFloat(m[2])
            const contribution = building ? buildingContribution(building) : NaN
            if (Number.isFinite(contribution) && Number.isFinite(factor)) {
                return contribution * (factor - 1)
            }
        }

        // "Grandmas gain +1% ..." / "Farms are 5% more efficient"
        m = /([\w' ]+?) (?:gain|are)\s*\+?([\d.]+)% (?:more )?(?:efficient|productive|cookies)/i.exec(
            text
        )
        if (m) {
            const building = findBuilding(view.buildings, m[1])
            const contribution = building ? buildingContribution(building) : NaN
            const pct = parseFloat(m[2])
            if (Number.isFinite(contribution) && Number.isFinite(pct)) {
                return contribution * (pct / 100)
            }
        }

        // "Cookie production multiplier +5%" and its phrasings
        m = /(?:cookie production(?: multiplier)?|cookies? per second)\s*\+?([\d.]+)%/i.exec(text)
        if (!m) m = /\+([\d.]+)% (?:cookie production|cookies? per second)/i.exec(text)
        if (m) {
            const pct = parseFloat(m[1])
            if (Number.isFinite(pct) && Number.isFinite(view.cps)) return view.cps * (pct / 100)
        }

        // kitten upgrades scale with milk rather than stating a number. they are
        // reliably strong, so treat them as a solid multiplier rather than unknown.
        if (/you gain more cps the more milk you have/i.test(text)) {
            return Number.isFinite(view.cps) ? view.cps * 0.1 : NaN
        }

        //! Clicking upgrades
        // These were the worst blind spot. Their entire effect lands on click
        // income, which nothing was measuring, so every one of them parsed to
        // "unknown" no matter how strong it was. With a measured click rate they
        // convert to cookies per second like anything else.
        const rate = Number.isFinite(view.clicksPerSecond) ? view.clicksPerSecond : 0
        if (rate > 0) {
            // "Clicking gains +1% of your CpS."
            m = /clicking gains \+?([\d.]+)% of your (?:cps|cookies per second)/i.exec(text)
            if (m && Number.isFinite(view.cps)) {
                return rate * view.cps * (parseFloat(m[1]) / 100)
            }

            // "The mouse and cursors gain +0.1 cookies for each non-cursor object owned."
            m = /gain \+?([\d.]+) cookies? for each non-cursor/i.exec(text)
            if (m) {
                const nonCursor = view.buildings
                    .filter(b => normaliseName(b.name) !== 'cursor')
                    .reduce((n, b) => n + (Number.isFinite(b.owned) ? b.owned : 0), 0)
                return rate * parseFloat(m[1]) * nonCursor
            }

            // "The mouse and cursors are twice as efficient." applies to clicking,
            // not to the cursor building line
            if (/mouse and cursors are twice as efficient/i.test(text)) {
                return Number.isFinite(view.clickCps) ? view.clickCps : NaN
            }
        }

        return NaN
    }

    //* scoreUpgrades
    // every buyable upgrade with a payback attached. `estimated` records whether
    // the figure came from the tooltip or from the fallback prior, so the log can
    // say which, and so a future version can prefer measured effects.
    function scoreUpgrades(view) {
        return view.upgrades
            .filter(u => u.kind === 'buy')
            .map(u => {
                const parsed = upgradeDeltaCps(u, view)
                const measured = Number.isFinite(parsed) && parsed > 0
                return {
                    ...u,
                    deltaCps: measured ? parsed : NaN,
                    measured,
                    // reported, not used to decide whether to buy
                    payback: measured ? paybackSeconds(u.price, parsed) : Infinity
                }
            })
            .sort((a, b) => a.price - b.price)
    }

    //! Buildings

    //* crossesThreshold
    // whether buying `count` more takes this building past a tier boundary
    function crossesThreshold(owned, count) {
        if (!Number.isFinite(owned)) return false
        return COUNT_THRESHOLDS.some(t => owned < t && owned + count >= t)
    }

    //* rankBuildings
    // scores every building we could eventually buy by payback, best first. a
    // building with no readable per-unit CpS (Infinity payback) sorts to the back.
    function rankBuildings(buildings) {
        return buildings
            .map(b => {
                // prefer the exact tooltip figure; before a building is owned that
                // is NaN, so fall back to its published base production
                const cps = Number.isFinite(b.perUnitCps) && b.perUnitCps > 0 ? b.perUnitCps : b.baseCps
                let payback = paybackSeconds(b.price, cps)
                const nextUnitCrosses = crossesThreshold(b.owned, 1)
                if (nextUnitCrosses && Number.isFinite(payback)) payback *= THRESHOLD_DISCOUNT
                return { ...b, scoredCps: cps, payback, crossesThreshold: nextUnitCrosses }
            })
            .sort((a, b) => a.payback - b.payback)
    }

    //! chooseAmount
    // How many to buy in one go. Three rules, and the largest wins.
    //
    // Rule one, efficiency. Buying one at a time always has the best payback,
    // because each unit costs 15% more than the last. So the question is not "is
    // bulk cheaper" (it never is) but "how many would a one-at-a-time loop have
    // bought before something else became the better target". Buying exactly that
    // many in one click gives an identical outcome far quicker. That count is
    // where this building's payback would overtake the runner-up:
    //
    //   price * 1.15^n / cps <= runnerUpPayback
    //   n <= log(runnerUpPayback * cps / price) / log(1.15)
    //
    // Rule two, thresholds. If a batch would take the building past 10, 25, 50 and
    // so on, it unlocks that building's next tiered upgrade, which is usually
    // worth more than the buildings in the batch. Reaching the boundary is worth
    // paying slightly worse payback for.
    //
    // Rule three, surplus. In practice buildings stay tightly ranked, so rule one
    // almost always says one and the extension spends the whole game clicking
    // singles. That is the wrong trade once the bank dwarfs the purchase: every
    // single costs a click and a redraw wait, so converting a big bank into
    // buildings one at a time wastes far more in elapsed time than the few percent
    // of ordering efficiency it protects. When a batch costs under a twentieth of
    // the bank, take the batch.
    //
    // All three are capped by what is affordable and snapped to a size the store
    // offers.
    function chooseAmount(best, runnerUpPayback, bank) {
        const offered = [100, 10, 1]
        if (!Number.isFinite(best.scoredCps) || best.scoredCps <= 0) return 1

        let efficient = Infinity
        if (Number.isFinite(runnerUpPayback) && runnerUpPayback > 0) {
            const ratio = (runnerUpPayback * best.scoredCps) / best.price
            // ratio <= 1 means the runner-up is already at least as good: buy one
            // and re-evaluate rather than committing to a batch
            efficient = ratio <= 1 ? 1 : Math.floor(Math.log(ratio) / Math.log(PRICE_GROWTH))
        }

        for (const n of offered) {
            const cost = sumPrice(best.price, n)
            if (cost > bank) continue
            if (n <= efficient) return n
            if (crossesThreshold(best.owned, n)) return n
            if (cost <= bank * SURPLUS_SHARE) return n
        }
        return 1
    }

    //! decide
    // Everything competes on payback. Upgrades no longer jump the queue simply for
    // being cheap: an upgrade is bought when it genuinely pays back faster than the
    // best building does, and otherwise cookies go into buildings. When nothing
    // affordable is worth it, wait rather than settle for a worse purchase.
    // Returns { action, target, amount, reason } where target carries the element.
    function decide(view) {
        const upgrades = scoreUpgrades(view)
        const buildings = rankBuildings(view.buildings).filter(b => Number.isFinite(b.payback))

        // upgrades first, cheapest first, always: see the note at the top of the file
        const nextUpgrade = upgrades.find(u => u.affordable) || null
        const bestBuilding = buildings.length > 0 ? buildings[0] : null

        if (nextUpgrade) {
            const how = nextUpgrade.measured
                ? `${formatDuration(nextUpgrade.payback)} payback`
                : 'effect not readable'
            return {
                action: 'buyUpgrade',
                target: nextUpgrade,
                amount: 1,
                reason: `upgrade ${nextUpgrade.name} (${how})`
            }
        }

        if (!bestBuilding) {
            return { action: 'none', target: null, amount: 0, reason: 'nothing scorable yet' }
        }

        if (bestBuilding.affordable) {
            const runnerUp = buildings.length > 1 ? buildings[1].payback : Infinity
            const amount = chooseAmount(bestBuilding, runnerUp, view.cookies)
            const tier = crossesThreshold(bestBuilding.owned, amount) ? ', crosses tier' : ''
            return {
                action: 'buyBuilding',
                target: bestBuilding,
                amount,
                reason: `${bestBuilding.name} x${amount} (${formatDuration(bestBuilding.payback)}${tier})`
            }
        }

        // save up for the best building instead of buying a worse affordable one
        return {
            action: 'wait',
            target: bestBuilding,
            amount: 0,
            reason: `saving for ${bestBuilding.name}, pays back in ${formatDuration(bestBuilding.payback)}`
        }
    }

    window.Alakazam = window.Alakazam || {}
    window.Alakazam.strategy = {
        decide,
        rankBuildings,
        scoreUpgrades,
        upgradeDeltaCps,
        paybackSeconds,
        chooseAmount,
        crossesThreshold,
        sumPrice
    }
})()
