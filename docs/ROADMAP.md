# Roadmap

Systems Alakazam does not play yet, with enough design worked out that each one is
a piece of work rather than a research project. Ordered roughly by how much they
are worth.

Everything here assumes the perception model in the README: rendered DOM for
anything live, tooltips for exact figures, the `localStorage` save for slow
structural state, and dispatched pointer events for every action.

---

## 1. Wrinkler popping

**Why it is not done.** Wrinklers are drawn onto `#backgroundLeftCanvas`. There is
no element for them and the game's stylesheet has no `.wrinkler` rule at all, so
there is nothing to select or click. The selector the pre-1.1 measurement layer
used matched zero every single time.

**What it needs.** Hit-testing the canvas. A wrinkler's position is deterministic
from its index and the game's own layout maths, so the options are to derive the
positions and click those points, or to sample the canvas pixels and find the
sprites. Either produces a coordinate to dispatch a click at, which the input
layer already supports.

**Rules once it works.** Let them accumulate, since a popped wrinkler returns more
than it took. Pop the full set at the cap. Never pop a shiny one. Always pop
everything before ascending, because the hoard is otherwise lost.

`modules/wrinklers.js` already reads the count and hoard from the save and tells
you when it is worth doing by hand.

---

## 2. Ascension

**Prestige.** `prestige = (totalCookiesBakedAllTime / 1e12) ^ (1/3)`. Heavenly
chips earned are the difference between the new prestige level and the current
one. Every prestige level is +1% CpS, additive.

**When.** The rule of thumb is to ascend when you can roughly double your current
prestige level. Because prestige is a cube root, that means about eight times the
cookies. Two commonly cited milestones: the first ascension at 365 chips, and a
second around 2185.

**What Alakazam already has.** `cookiesEarned`, `cookiesReset`, `prestige`,
`heavenlyChips` and `resets` are all parsed out of the save, so the "should I
ascend" calculation is arithmetic on data already in hand. `runId` changes on
ascension, which is the signal to reset per-run state.

**What it needs.** A decision on when, the click path through the ascension screen
(legacy button, the confirmation, then the heavenly upgrade tree), and a purchase
order for heavenly upgrades. A sensible first-ascension order: Legacy, How to Bake
Your Dragon, Heavenly cookies, the four cookie boxes, Heralds, Heavenly luck, then
a permanent upgrade slot holding the best kitten.

**Risk.** Ascending is irreversible and throws away the run. This should be
off by default and confirmed, not silent.

---

## 3. Loans before ascending

Bank office levels unlock loan slots. A loan is a large immediate production
multiplier paid for with a worse penalty afterwards.

The trick is that the penalty is tied to the run, and ascending ends the run. So
taking every available loan immediately before ascending buys a large final burst
of production and the debt is simply never paid. Combined with a combo, this is
where a lot of the cookies in a fast ascension come from.

**What it needs.** Ascension first, since the whole point is the ordering. Then
`#bankLoan1`, `#bankLoan2` and `#bankLoan3`, taken in sequence as the last thing
before the combo that precedes the ascension.

---

## 4. Golden cookie combos

The largest single source of cookies in the game. A combo is several multipliers
stacked at once and then clicked into.

The stack, roughly in the order it is assembled:
1. Wait for a natural production buff (Frenzy, or better, a Building Special).
2. Turn on the Golden Switch, then take the loans.
3. Cast Force the Hand of Fate, hoping for Click Frenzy. A conjured golden cookie
   rolls Click Frenzy far more often than a natural one does.
4. Switch the dragon's auras to production ones.
5. Sell every building contributing under a couple of percent of total output, for
   Godzamok's click bonus, which scales with buildings sold.
6. Click for the duration.

**What Alakazam already has.** Buff detection by name in `measure/live.js`, spell
casting and cost modelling in `modules/grimoire.js`, bulk selling and a guaranteed
mode restore in `act/store.js`, and the Godzamok preset in `data/gods.js`.

**What it needs.** An orchestrator that sequences those, and a way to decide which
buildings are worth sacrificing. Buying everything back afterwards is a matter of
letting the drain loop run.

---

## 5. Stock market tick oracle

The market advances one tick a minute, driven by the game loop, and the tick state
is written into the save. The game autosaves on roughly the same cadence.

So: observe prices, reload the page, and the game reverts to the last autosave
while you keep the knowledge of where prices went. That is a minute of genuine
foresight, repeatable.

**What it needs.** Persistence across reloads, which exists: `core/store.js` is
namespaced by `legacyId` and survives a refresh. Record each good's price and mode
before reloading, then compare after. Also needs a scheduler for the reloads and
some care about the fact that reloading also discards a minute of production.

**Deliberately not built.** Automatically reloading the player's tab is invasive,
and the payoff is small compared to knowing the trend mode outright, which
`modules/market.js` already reads from the save. If it is ever built it should be
off by default with a visible countdown before each reload.

---

## 6. Golden cookie prediction

The save's run metadata includes `seed`, a five-letter string that seeds the
game's random number generator. It is already parsed and exposed by
`core/identity.js`, unused.

With the seed and the number of spells cast, the outcome of the next Force the
Hand of Fate is deterministic and can be computed ahead of casting. That turns
combo setup from hoping for Click Frenzy into waiting for the cast that will give
it. This is the single largest optimization left in the game.

**What it needs.** A reimplementation of the game's seeded PRNG and the specific
call sequence that produces a golden cookie's outcome. Substantial, self-contained
and very testable, since the answer is checkable against what actually happens.

---

## 7. Krumblor, the cookie dragon

Levelled by sacrificing buildings; grants two aura slots at full growth. Auras
cover production, golden cookie frequency, click power, and reduced spell costs.

`dragonLevel`, `dragonAura` and `dragonAura2` are parsed from the save already.
The work is the training click path and an aura policy: production auras for idle,
click auras during a combo, Supreme Intellect when the grimoire matters. Aura
swapping mid-combo is part of the combo sequence above.

---

## 8. Seasons

Christmas, Halloween, Easter, Valentine's and Business Day each unlock their own
upgrade set and their own achievements. Switching costs cookies and the cost rises
with each switch, so the order matters: take the cheap seasonal upgrade sets
early, and stay in whichever season is most useful for the current goal.

`season`, `seasonT` and `seasonUses` are all in the save. Season switchers are
currently classified as `skip` by the upgrade classifier, deliberately, because
switching blind would be worse than not switching.

---

## 9. Grandmapocalypse and wrinkler farming

Progressing through the Grandmapocalypse stages unlocks wrinklers, wrath cookies
and a set of achievements, at the cost of a production penalty and hostile golden
cookies. `elderWrath` and `pledges` are in the save.

Worth doing deliberately rather than by accident: research is started from an
upgrade, the pledge holds it back, and the Elder Covenant ends it. All three are
currently classified as `skip`, which is the safe default and the right one until
there is a policy.

---

## 10. Smaller pieces

- **Cookie chains.** A chain of golden cookies paying out increasing amounts,
  needing rapid successive clicks. The shimmer module already clicks fast enough;
  what is missing is not clicking one too early, since chain payouts scale with
  how long the chain has run.
- **Sugar Frenzy.** Spending 100 banked sugar lumps for triple production for an
  hour. The lump planner banks to 100 already, so the decision is when spending
  them beats holding them.
- **Golden Switch and Shimmering Veil.** Late-game toggles trading golden cookies
  or clicks for flat production. Correct for idle play, wrong during a combo, so
  they belong to the combo orchestrator.
- **Milk and kittens.** Kitten upgrades scale with milk, which scales with
  achievements. Currently handled by a fixed estimate in the upgrade scorer; a
  real model would read the milk level and compute the actual delta.
- **Permanent upgrade slots.** Chosen at ascension; the save carries five slots in
  its scalar list, already parsed.
- **Challenge runs.** Born again, Neverclick, Trigger finger, Hardcore and the
  rest need Alakazam to deliberately *not* do things, which the module toggles
  already make possible but nothing coordinates.
- **Cookie-dunker.** Needs the big cookie to physically overlap the milk, which is
  a matter of window size rather than anything clickable.
- **Garden maturity thresholds.** Each species matures at its own age, and those
  thresholds are not readable. The garden currently confirms maturity from the
  tile tooltip, which works but costs hovers; a table would remove them.
- **Achievement id table.** The save's achievement bitfield is read as a count.
  Mapping indices to specific achievements would let Alakazam chase named ones,
  but ids shift between game versions, so it needs version gating to be safe.
