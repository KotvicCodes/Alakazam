# Ascension

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
pure and unit tested in `strategy/ascend.js`. Targets come from the guide, all 23
entries in `data/heavenly.js`: 365 chips, then 2185, then 12301. The one it aims
at is the first rung above where the save already stands, so a save that has
ascended more times than it has worked through the table still gets a target it
can reach. Past the table it falls back to the guide's own rule, ascend when the
run would double the prestige already banked.

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
check actually runs, then puts the clones straight back the way it found them. It
runs once, the first time a You is owned, in a single pass, and never touches
them again; clones still on the game's default are left on a preset.

**"No time like the present"** needs a gift code redeemed. Alakazam wraps the gift
and keeps the code, and the panel shows it with what to do. **Redeeming is not
automated**: it means typing into the game's own text field, which is a different
kind of act from clicking on something, and it deserves a decision rather than
being slipped in. It is written up as roadmap item 10.

## What playing it turned up

**The save was never being read at all.** `Game.WriteSave` does not put its
base64 into localStorage: it stores `escape(base64 + '!END!')`, and `Game.LoadSave`
calls `unescape` on the way back in before it goes looking for the marker.
escape() writes '=' as `%3D` and the marker as `%21END%21`, so skipping that step
finds no marker to strip, hands a string full of percent signs to `atob`, and
reports a perfectly good save as **"save is not base64"**. On every save, in
every real browser, since the reader was written. Everything downstream of it —
the ascension planner, the lump planner, the garden, the market, the pantheon —
was working from a save that had failed to decode.

The fixtures were the reason this survived a test suite. They stored the base64
directly, which is the one place a Cookie Clicker save is never stored that way,
so the reader was only ever tested against a form it would never meet. They
escape now, and 77 tests fail without the fix.

Everything below is what was waiting behind it.

**The save was also being read two fields out.** `Game.WriteSave` puts the shiny
wrinkler count and hoard between `volume` and `lumps`, and the parser did not
know they were there. So `lumps` held the shiny wrinkler count, `lumpT` held the
lump count and `lumpCurrentType` held a millisecond timestamp. The layout checks
do their job and refuse to trust any of that, so the ascension planner would
still not have planned once decoding worked: ascending on a misread
`cookiesReset` is not undoable. The sugar lump planner would have had nothing to
spend either, thinking it had as many lumps as it had shiny wrinklers.

The version whitelist went with it. An unrecognised version used to mark a save
untrusted outright, which means every game patch silently switches off everything
that needs exact numbers until somebody adds a string. The layout invariants are
version independent, they are the real check, and they are what caught this.

**Lumps do not live 24 hours.** Stevia Caelestis, Sugar aging process and Rigidel
each take an hour off the ripening, and the game writes the moment a lump falls
as exactly an hour after it ripens, so all three reductions move the auto-harvest
too. On such a save the lump is gone by hour 21 and waiting for hour 23 never
harvests one. Which upgrades are owned is not readable from a save in any form
that survives a patch, so the lifespan is measured off the lump's own sprite,
whose frame and cross-fade encode how far through its life it is — the same trick
`measure/buffs.js` uses on the pie timer. And levelling never worked at all:
`.productLevel` is in the building's row, not in the store listing it was being
looked for in.

**"In her likeness" was being declined rather than earned.** The sequence was
three stages fifteen seconds apart, which left the game's customizer prompt open
on the player's screen for the best part of a minute; anything that opened a
prompt of its own or clicked `#promptOption0` in that window sent it back to the
start. It is one pass now, on screen for a frame. And it refused to run at all on
a save whose clones already had a look, which is declining an achievement over a
hairstyle: it earns it and puts the look straight back.

**Ascension targets were indexed by the ascension count**, which assumes a save
followed the guide from its first reset, one entry per ascension. Ascend a few
times early, or import a save, and the count runs ahead of the progress: the
table's tenth entry asks for 1.6 billion chips from a save that has not earned
the 210 million the ninth wanted, and the planner waits forever. The target is
now the first rung above where the save actually stands.

## Verification

`npm test` — 200 tests under `node --test`, green. New coverage: the prestige
formula against the guide's milestones, target selection and the doubling fallback,
buying in plan order, never touching a ghosted or off-plan crate, refusing an
unnamed prompt, the stale-save guard, loan ordering, ascending inside the loan
window, a frenzy holding the sequence back, buff naming and pie-timer decoding, the
likeness condition and the deliberate final step, every gift gate, the save in the escaped
form localStorage really holds it in, the real 55 field scalar layout against a
drifted one, measuring a shortened lump lifespan and
harvesting inside it, spending a lump on the row badge, and answering only the
prompt that names itself.

The fake Cookie Clicker grew an ascension screen, a heavenly tree with
prerequisites and refusals, a permanent slot picker, named prompts, buffs with real
pie timers, the three loan slots, the clone customizer with the game's own check,
the options menu with gift prompts, and a sugar lump drawn from its own sprite
sheet with the level badges in the building rows.

Everything above except the market's loan buttons is now checked against the
shipped `main.js` rather than assumed: the save format field by field, the lump
timing formula, the customizer's prompt, arrows, gene order and defaults, the
achievement's own condition, the heavenly crates and every prompt id. Everything
still fails soft — a missing element is a skipped step, not a throw.
