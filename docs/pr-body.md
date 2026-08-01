# Krumblor

Alakazam has never touched the cookie dragon, and it has been choosing pantheon
spirits from a single question: "is the autoclicker on". This branch builds the
dragon end to end and replaces both that question and the aura equivalent with
scoring functions over what the run has actually earned. It closes roadmap item 7.

## The thing that makes this different from the guides

The game registers about **three clicks a second**, however many are dispatched,
and Alakazam takes every golden cookie within milliseconds of it appearing. Both
facts quietly demolish most of the received wisdom about auras and spirits:

| what the guides rank highly | why it is worth less here |
|---|---|
| Dragon's Fortune, +123% CpS per golden cookie on screen | there is almost never one on screen: they are clicked at once |
| Dragonflight, ×1111 click power for ten seconds | ten seconds is thirty clicks, not the hundreds a human gets |
| Dragon Cursor, +5% clicking | 5% of a small share of income |
| Muridal in the diamond slot, +15% clicking for -3% production | only wins while click income is above about two thirds of production, which after the opening minutes it never is |
| Jeremy and Mokalsium, the idle pantheon | between them they make golden cookies about a fifth rarer, which was never priced |

So neither choice is hard-coded any more. `src/strategy/dragon.js` and
`src/strategy/pantheon.js` score every candidate in cookies per second against
measured production, click income and golden cookie income, and return the terms
behind each number. Radiant Appetite still wins, comfortably, on any ordinary save,
which is the point: it is now a result rather than an assertion.

``` JavaScript
window.Alakazam.dragon.explain()    // every aura, scored, with its inputs
window.Alakazam.pantheon.explain()  // the best layouts, scored
```

Both also log themselves when the answer changes, so a long session leaves a trail
that two runs can be compared across.

## The dragon

Trained from the egg, **every run**: `Game.Reset` zeroes `dragonLevel` and both
auras on every ascension, not only on a hard reset, so this is a recurring cost and
not a one-time setup. The ladder is fixed: five cookie rungs, then a hundred of one
building per rung walking up the store, then fifty and two hundred of everything.
Radiant Appetite is rung fourteen of the building section.

Reaching it is the awkward part. The dragon's tab is painted onto a background
canvas and hit-tested against the mouse position, so the click has to carry
coordinates, and the game only accepts it when the last thing clicked was that
canvas, which the autoclicker overwrites fifteen times a second. So a panel visit
holds the scheduler still and verifies what appeared instead of assuming.

It also pets for drops, and learns which quarter of the hour yields which drop
rather than spending pets on a window whose drop is already held.

## Supreme Intellect, which is where the two meet

The aura promotes every temple slot a tier, so the same three spirits pay more, and
the best layout is not necessarily the same one. It also makes spells a tenth
cheaper: the grimoire had been paying full price and casting late, with a comment
saying the aura was unreadable, while `dragonAura` had been in the save all along.

## Gift codes, finished

Wrapping a gift was already automated; redeeming it was left to you because it
means typing into one of the game's own text fields. That line was already untrue,
since the achievement hunt types a bakery name, so `typeInto` has moved into the
input layer next to `simulateClick` and the fair-play contract in the README now
names the exception. The game stays the judge of the code: its Redeem button is
disabled until the code parses, and a code it refuses is dropped rather than
retried.

## Permanent upgrade slots, reassigned

A permanent slot could always be reassigned at any ascension, and Alakazam only
ever filled one at the moment it was bought. A slot bought at the third ascension
was still holding a third-ascension kitten twenty runs later, and every run since
had been paying for it.

Now, once the heavenly tree is bought out and before reincarnating, the owned slots
are walked and any that can be improved are reassigned. Two things make it more
than a loop. The picker never lists a slot's own occupant, so taking the best of
what is offered would swap the strongest kitten on the save out for the second
strongest: what a slot holds is read from its own tooltip and compared by rank
first, and a slot holding something this version cannot name is left alone on the
grounds that an unknown upgrade is likelier to be newer than worse. And owned
crates are deliberately excluded from the shopping pass, because clicking one
reopens its picker and that once turned shopping into a loop that never
reincarnated, so this is a separate bounded walk that runs only after shopping
reports itself done.

## The panel

Thinned to what the game does not already show: gone are the bank, CpS, the
catalog progress, the pantheon section, the save id, the version and its note, what
ascending would pay, and the plan sentence. "Plan wants" is now "planned", and one
row was added for the dragon. The per-drain object dump is out of the console too.

The version note deserves its own line: it warned that the game was newer than the
parser had been read against, and it said that for every game newer than the last
string anybody remembered adding to a hand-maintained list. The list is gone;
`scalarsLookSane` was always the real check.

## Also fixed along the way

- **Holobore was never actually banned.** The exclusion list was exported and read
  by nothing; the only thing keeping him out was that three hand-written presets
  happened not to name him. One new preset and the first golden cookie click would
  have burned the entire swap budget.
- **Cyclius is now excluded too.** Its bonus is a sine wave over three to
  twenty-four hours and there are three worship swaps a day, so it would be slotted
  while the wave was up and paid for in full while it was down.
- Dead output cleared: `chipsShort`, `save.stats().generation`.

## Tests

224 → 283, including the pantheon module, which had none at all: the training
ladder, aura availability, the canvas coordinate maths at two zoom levels, a click
the game credits to something else, the greyed-out cost gate, aura ids read from
the crate's own handler rather than its position, the scorers at several income
mixes, Supreme Intellect promoting slots in both directions, redeeming end to end
including a code the game refuses, and the panel rows that are gone.
