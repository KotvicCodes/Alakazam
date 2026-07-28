# Save-aware autoplayer (v1.1.0)

Alakazam used to make **one purchase every few seconds**, because measuring the
store meant hovering every building and every upgrade with a 90ms wait each. It
also had no memory, no settings, and no way to see what it was doing.

This branch fixes the cadence, adds bulk buying and selling, and teaches it to
play the sugar lump, garden, grimoire, pantheon and stock market systems.

## The headline change

Building prices are already on screen. Only per-unit production and upgrade
effects need a tooltip, and those change slowly. Splitting those apart means a
purchase decision now costs under a millisecond, so buying runs in a **drain
loop**: buy, re-evaluate, buy again, bounded by a click budget, a time slice and a
locally tracked balance.

Measured against a simulated store: ~5 purchases per 250ms tick, where the old
loop managed roughly one per 5–8 seconds.

## Buying

- **Buy 1 / 10 / 100 and sell**, through a `withBulk()` primitive that always
  restores the store's shared mode in a `finally`, even when the body throws.
  Leaving the store in Sell would be a genuinely destructive bug.
- Bulk totals are derived as a geometric series over the 15% price growth, then
  **confirmed against the game's own rendered bulk price** before committing.
- Batch size is the largest of three rules: payback overtake, reaching a tier
  boundary (10/25/50/100…, which unlock tiered upgrades), or the batch costing
  under a twentieth of the bank.
- Upgrades are scored by a CpS delta parsed from their tooltip instead of "buy
  the cheapest", with a pessimistic prior when the effect cannot be read.

## Reading the save

`localStorage` carries what the page never renders: garden plots and seed log,
each stock's hidden trend mode, pantheon swap timers, grimoire magic, the
achievement and upgrade bitfields, sugar lump timers, and a per-save `seed`.

The Fair-Play Contract in the README has been **rewritten to disclose this
honestly** rather than quietly widened. Acting is unchanged: still only dispatched
pointer events, still never the `Game` object. The raw save is never logged,
stored verbatim, or sent anywhere.

## New systems

Sugar lumps (harvest on ripe, minigame unlocks first), garden (seed hunting from
the save, 34 plants and 36 recipes), grimoire (magic modelled from the game's own
formulas), pantheon (drag slotting, respects the swap budget), stock market
(trend-based signals, **trading off by default**), plus an in-page HUD and a
working popup.

## Bugs found and fixed along the way

- `.wrinkler` **never matched anything** — wrinklers are canvas-drawn and the
  game's stylesheet has no such rule. Replaced with save-based reporting.
- Golden cookies use `.goldenCookie`, not `.golden`, so shimmer typing was wrong.
- Wrath cookies were clicked during buffs, where a Clot or Ruin ends a combo.
- `godComplex` renamed your bakery to "Alakazam" and **never put it back**.
- Achievement routines re-ran on every page load. Now recorded per save.
- The unused `scripting` permission is dropped; `storage` is added.

## Verification

`npm test` — 59 tests under `node --test`, no browser, run green three times in a
row. Covers save decoding and all four minigame sub-saves, stale detection,
payback and bulk pricing, upgrade parsing, tier thresholds, store mode restore
under a throw, the missing-controls fallback, grimoire formulas, lump ripeness,
garden goals, market signals, module failure isolation, and that the master switch
cannot freeze the HUD that unpauses it.

Not yet verified in a real browser: the `#storeBulk*` selectors and `.productLevel`
are inferred from the game's stylesheet rather than confirmed live. Both fail soft
— missing bulk controls warn once and fall back to buying one at a time.
