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

**Now blocking something.** The ascension planner is built, so this is no longer
only advice. Every ascension with wrinklers on the cookie throws their hoard away,
and all `modules/ascend.js` can do about it is warn before it pulls the lever. This
is the largest thing left that is purely a matter of building it.

---

## ~~2. Ascension~~ (built, v1.2.0–1.2.3)

Built as `strategy/ascend.js` (the arithmetic), `act/ascend.js` (the clicks),
`data/heavenly.js` (the plan) and `modules/ascend.js` (the phase machine). On by
default.

**Prestige.** `prestige = floor((totalCookiesBakedAllTime / 1e12) ^ (1/3))`, the
game's own formula. Heavenly chips earned are the difference between the new
prestige level and the current one. Every prestige level is +1% CpS, additive.

**When.** The targets come from the wiki's
[ascension guide](https://cookieclicker.wiki.gg/wiki/Ascension_guide), one per
ascension, 365 chips for the first and 2185 for the second. Past the end of that
table it falls back to the guide's own rule of thumb: ascend when the run would
roughly double the prestige level already banked, which because prestige is a cube
root is about eight times the cookies.

**What it clicks.** `#legacyButton`, then the confirmation, then the heavenly tree
(`.crate.upgrade.heavenly` in `#ascendUpgrades`, keyed on `data-id`, with `ghosted`
marking the ones whose prerequisites are not met), then `#ascendButton`.

Two details are worth keeping written down. Every prompt the game raises confirms
through `#promptOption0`, including "Really wipe save", so `act/ascend.js` refuses
to confirm anything unless the prompt names itself: `Game.Prompt` wraps content
beginning `<id Ascend>` in a `#promptContentAscend` div, and that is the check. And
the save lags up to a minute, so the reset count from before an ascension is
remembered and nothing starts again until the save reports a higher one; otherwise
the stale save reads as a finished run and it ascends an empty one immediately.

**Still open.** Permanent slots are filled from a fixed preference list and never
reconsidered; challenge modes are not chosen; see below.

---

## ~~3. Loans before ascending~~ (built, v1.2.3)

Built as `data/loans.js`, `act/loans.js` and the `loans` and `harvest` phases of
`modules/ascend.js`. The game's own achievement for it is "Debt evasion".

The three slots are `#bankLoan1`, `#bankLoan2` and `#bankLoan3`, revealed past bank
office levels 1, 3 and 4 and carrying `bankButtonOff` while already running.

| | boost | for | then | for | downpayment |
|---|---|---|---|---|---|
| 1 modest | ×1.5 | 120 min | ×0.25 | 240 min | 20% of bank |
| 2 pawnshop | ×2 | 40 s | ×0.1 | 40 min | 40% of bank |
| 3 retirement | ×1.2 | 48 h | ×0.8 | 5 days | 50% of bank |

They are taken 1, 3, 2 rather than in order: the pawnshop loan is the strongest and
by far the shortest, so going last makes the window the ascension has to fit inside
as wide as it can be. The downpayment is a share of a bank that is about to be
discarded, and spending does not reduce `cookiesEarned`, so it costs nothing that
counts toward prestige.

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

## ~~7. Krumblor, the cookie dragon~~ (built, v1.3.0)

Trained by sacrificing buildings, and worth doing: Radiant Appetite doubles all
production and is reachable fourteen rungs up the ladder. `Game.Reset` zeroes
`dragonLevel` and both auras on **every** ascension, not only on a hard reset, so
this is a cost paid again every run rather than a one-time investment.

`src/modules/dragon.js` climbs the ladder, keeps the best aura in the slots and
pets for drops; `src/strategy/dragon.js` scores every aura against measured income;
`src/act/dragon.js` reaches the panel, whose tab is painted on a canvas rather than
built as an element. Aura swapping mid-combo is still part of the combo sequence
above, and is the obvious next use of it.

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

Worth doing deliberately rather than by accident: it is started from a research
upgrade, the pledge holds it back, and the Elder Covenant ends it.

The research tree is bought now, so this needed a named exception rather than an
accident of what the store scanner could see. `One mind`, `Communal brainsweep`
and `Elder Pact` are classified `skip` by name in `measure/catalog.js`, alongside
the pledge and the covenant. Every other research upgrade is an ordinary
multiplier and is bought. Lifting the exception is a one-line change, and what it
needs first is a policy: when to enter, and whether the wrinkler module is doing
enough with the result to pay for the production penalty.

---

## ~~10. Redeeming gift codes~~ (built, v1.3.0)

`modules/gifts.js` now does both halves of "No time like the present": it wraps a
gift, keeps the code, and redeems it once the hour the game makes you wait is up,
or once an ascension has cleared the buff early.

**The question it was waiting on** was whether writing into one of the game's own
text fields belongs in a bot whose every other action is a pointer event. It was
already answered and nobody had noticed: the achievement hunt has been typing a
bakery name since it was written. So `typeInto` moved into `src/input.js` next to
`simulateClick`, where the exception is as countable as the rule, and the fair-play
contract in the README names it.

The Import button in the clone customizer is the last thing this would have
settled, and it is still untouched.

---

## 11. Ascension challenge modes

The ascend screen has a mode selector, `#challengeModeSelector<i>`, next to the
Reincarnate button. Picking one starts the next run as Born Again or one of the
other challenge runs, which carry their own achievements.

Cheap now that `act/ascend.js` drives that screen: it is one more click in the
`shopping` phase. What it needs is a policy for which challenge to take and when,
and the run afterwards has to know it is in one, since a challenge run mostly means
Alakazam deliberately *not* doing things.

---

## ~~12. Re-picking permanent upgrade slots~~ (built, v1.3.2)

Every ascension, once the tree is bought out, `modules/ascend.js` walks the owned
slots and reassigns any it can improve. A slot is worth revisiting because what
belongs in it moves with the save: kittens multiply production by a figure that
grows with milk, milk grows with achievements, and achievements are the one thing
an ascension never takes away, so the run that just ended nearly always owns a
stronger kitten than the run that filled the slot did.

**Two things made it more than a loop.** The picker never lists a slot's own
occupant, so taking the best of what is offered would have swapped the strongest
kitten on the save out for the second strongest; what a slot is holding is read
from its own tooltip and compared by rank first. And `act/ascend.js` drops owned
crates on purpose, because clicking one reopens its picker and that once turned the
shopping pass into a loop that never reincarnated, so the reassignment pass is a
separate, bounded walk that runs only after shopping reports itself finished.

It has to happen on the ascension screen: the game offers "all the upgrades you've
purchased last playthrough", and after the reset there is no last playthrough.

---

## 13. Smaller pieces

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
- **Buff totals.** `measure/buffs.js` reads how much of a buff has elapsed out of
  its pie timer, which is a fraction, so turning it into seconds needs the buff's
  total length from the caller. The tooltip states it in prose ("Cookie production
  x2 for 40 seconds!"); parsing `Game.sayTime` output would remove the need for a
  table.
- **Cookie-dunker.** Needs the big cookie to physically overlap the milk, which is
  a matter of window size rather than anything clickable.
- **Garden maturity thresholds.** Each species matures at its own age, and those
  thresholds are not readable. The garden currently confirms maturity from the
  tile tooltip, which works but costs hovers; a table would remove them.
- **Achievement id table.** The save's achievement bitfield is read as a count.
  Mapping indices to specific achievements would let Alakazam chase named ones,
  but ids shift between game versions, so it needs version gating to be safe.
