# Ascension, pre-ascension loans, and two achievements (v1.2.6)

Alakazam played a run competently and had never finished one. This branch builds
the ascension loop end to end, following the wiki's
[ascension guide](https://cookieclicker.wiki.gg/wiki/Ascension_guide), and closes
roadmap items 2 and 3.

## The rule that shapes it

**Never leave in the middle of a boost.** A frenzy is minutes of multiplied
production, and those cookies count toward prestige, so ascending mid-frenzy
throws them away. A met target waits.

**Loans invert that, which is the whole trick.** A bank loan is a big multiplier
now paid for with a worse one later, and the penalty belongs to the run. Ending
the run before it lands is how the trade is won rather than lost, and it is the
game's own "Debt evasion" achievement. So the sequence is: wait out whatever is
running, take every loan, earn under the stack, and ascend in the last seconds
before the shortest window closes.

| | boost | for | then | for | downpayment |
|---|---|---|---|---|---|
| 1 modest | ×1.5 | 120 min | ×0.25 | 240 min | 20% of bank |
| 2 pawnshop | ×2 | **40 s** | ×0.1 | 40 min | 40% of bank |
| 3 retirement | ×1.2 | 48 h | ×0.8 | 5 days | 50% of bank |

They are taken **1, 3, 2**, not in order: the pawnshop loan is the strongest and
much the shortest, so going last leaves the widest window to ascend inside. The
downpayment is a share of a bank about to be discarded, and spending never reduces
`cookiesEarned`, so it costs nothing that counts.

## When, and what it buys

`prestige = floor((lifetime cookies / 1e12) ^ (1/3))`, the game's own formula, kept
pure and unit tested in `strategy/ascend.js`. Targets come from the guide, one per
ascension: 365 chips for the first, 2185 for the second, all 23 entries in
`data/heavenly.js`. Past the table it falls back to the guide's own rule, ascend
when the run would double the prestige already banked.

The shopping list is the guide's, flattened into one order. Anything not on it is
never bought, because chips spent off-plan are chips the next tier's centrepiece
does not get. Permanent slots are filled from a preference list, kittens first,
and cancelled out of rather than filled blindly.

## Two things that had to be got right

**Confirming the wrong prompt.** Every confirmation in Cookie Clicker is
`#promptOption0`. So is "Really wipe save". `Game.Prompt` also stamps the prompt's
name into the DOM (`<id Ascend>` becomes `#promptContentAscend`), so `act/ascend.js`
refuses to confirm anything unless the prompt on screen names itself. There is a
test that puts a wipe prompt up mid-sequence and checks it is not clicked.

**The save is stale.** It lags up to a minute. The instant a run ends, the last
save still describes the run that just finished, still holding a lifetime of
cookies and still saying the target is met. Acting on that ascends a brand new
empty run immediately and loops. The reset count from before the ascension is
remembered and nothing starts again until the save reports a higher one.

## A bug this turned up

`live.readBuffs()` was reading `innerText` off buff elements and matching it
against a list of names. **A buff has no text.** The game builds it as an icon
crate containing a pie timer, nothing else, so the match was always against the
empty string and `hasProductionBuff()` has always returned false. Every decision
resting on it was running blind: the grimoire never actually timed a Force the Hand
of Fate against a frenzy, and the shimmer module's "do not click a wrath cookie
mid-buff" guard never fired.

`measure/buffs.js` reads them the way they are really rendered. The name comes from
the tooltip and is cached per element, because "Loan 1" and "Loan 1 (interest)"
share an icon and mean opposite things. The time left is decoded from the pie
timer's sprite offset, which encodes elapsed fraction in 144 steps: under three
tenths of a second of resolution on a forty second loan.

## Two achievements

**"In her likeness"** dresses the clones as a grandma. The catch is that the game
checks for it inside `offsetGene`, the arrow handler, and only on a non-zero step,
so importing the right appearance wins nothing. `modules/clones.js` walks the
arrows, then deliberately steps a gene the achievement does not care about so the
check actually runs, then leaves the clones on a preset. It runs once, the first
time a You is owned, and never touches them again; a look you chose yourself is
left alone entirely.

**"No time like the present"** needs a gift code redeemed. Alakazam wraps the gift
and keeps the code, and the panel shows it with what to do. **Redeeming is not
automated**: it means typing into the game's own text field, which is a different
kind of act from clicking on something, and it deserves a decision rather than
being slipped in. It is written up as roadmap item 10.

## Verification

`npm test` — 182 tests under `node --test`, green. New coverage: the prestige
formula against the guide's milestones, target selection and the doubling fallback,
buying in plan order, never touching a ghosted or off-plan crate, refusing an
unnamed prompt, the stale-save guard, loan ordering, ascending inside the loan
window, a frenzy holding the sequence back, buff naming and pie-timer decoding, the
likeness condition and the deliberate final step, and every gift gate.

The fake Cookie Clicker grew an ascension screen, a heavenly tree with
prerequisites and refusals, a permanent slot picker, named prompts, buffs with real
pie timers, the three loan slots, the clone customizer with the game's own check,
and the options menu with gift prompts.

Not verified in a real browser: the selectors are read from the shipped `main.js`
and `minigameMarket.js` rather than confirmed live. Everything fails soft — a
missing element is a skipped step, not a throw.
