# Click input and guard verification

This correction owns input semantics, canonical effect/upgrade guards, and click
measurements. Save persistence and identity reconciliation belong to the concurrent
save-lifecycle PR.

## Save contract

The sampler consumes `save.stats().revision`, `savedAt`, `runId`, and `trusted`.
The lifecycle watcher also exposes `changedAt` (observation time), which is useful
for diagnostics but is not the denominator of a saved-counter rate. Revisions
advance for accepted changed saves, including saves whose click totals do not
change; ordinary polling does not advance them.

Until that API lands, the parsed save object's identity acts as a revision and
`run.lastDate` supplies the saved time. The fallback run key includes selected
storage key, family creation time, seed, run start time, and reset count. This
keeps this PR independently mergeable. A run switch, decreased counters, or a
non-increasing save time discards all prior income, rate, per-click, sample, and
dispatch state. Untrusted/invalid or more than 150-second-old saves invalidate
measurements. Two fresh saves are needed again after invalidation.

A newly saved zero-click interval records a measured zero and clears the old
per-click value. It never selects the startup estimate. Cached polling alone does
not prove zero activity. The initial estimate follows the configured pacing and
is explicitly separate from `registeredPerSecond`, which is null until measured.

## Pinned browser checks

Target: disposable local Cookie Clicker 2.058 from `ozh/cookieclicker`, commit
`c77f00c51854a667da35a3135120797a579c2d72`. Tested 2026-10-19 using the T3 preview.
Game APIs prepared fixtures and read registration counters; extension actions used
the input dispatcher. This is content-script logic testing in the page context,
not a native extension/isolated-world certification of the canonical HTTPS site.

At 70ms spacing (about 14 clicks/second), in a visible page:

- Keyboard-style activation (`detail: 0`): 28 dispatched, 6 registered, 1983ms.
- Corrected pointer activation (`detail: 1`): 28 dispatched, 28 registered, 1992ms.
- Reduced rendering (`fancy=0`, `particles=0`): 28 dispatched, 28 registered, 1993ms.

Opening a second preview tab left the game reporting `visibility: "visible"`;
that repeat also registered 28/28, but does not establish hidden-tab throughput.
Background registration remains unverified in this browser environment.

The result explains the historical three-click observation; it does not establish
a universal registration limit. The default dispatch budget remains 15/second,
configurable through `store.setSetting('clicksPerSecond', value)` (0–60). Rate
estimates and aura/spirit scores must follow the current save's measurements.

French game fixtures rendered `Esprit unique` with `data-id="69"`: classification
was `skip`. A real Frenzy rendered `Frénésie`, resolved to canonical `frenzy`,
protected ascension, and enabled the production combo trigger. A real Dragonflight
rendered `Vol de dragon`, resolved to canonical `dragonflight`, protected ascension,
and suppressed the spell-combo trigger even alongside Frenzy.

## Effect policy

The checked-in identity table audits all buff types and twenty building specials
in the pinned source. Exact English/French headings resolve to canonical keys.
Descriptive text and sprite offsets do not establish identity: loan/interest and
luck/misery share sprites. Unknown headings block ascension and spell actions and
show an explanation. Missing canonical upgrade IDs block those upgrade actions
and the Buy all shortcut; safe building actions can continue.

Ascension protection includes production/click multipliers, Cursed finger,
Cookie storm, short purchase discounts, and Magic adept. All twenty positive
building specials are included, including You's **Deduplication**. Negative
effects and Gifted out do not protect ascension. Sugar blessing is a 24-hour
frequency bonus, so it does not hold ascension for a day. Loans use the planner's
separate loan/interest lifecycle. English/French loan and gift headings resolve
to canonical names for existing cooldown and remaining-time readers.

Spell strategy is separate: positive production multipliers can trigger Force the
Hand of Fate. Dragonflight protects ascension but suppresses that combo trigger,
even alongside Frenzy: the pinned Grimoire removes Click Frenzy from its outcome
pool while Dragonflight is active. Click-only effects are not production triggers.

## Automated regressions

`tests/click-guards.test.js` converts the historical round-two diagnostic's
broken-behavior assertions into correct-behavior tests, including the exact
600-click/600,000-cookie minute followed by reset and ten-minute inactivity.
Coverage includes event order/count/button state and coordinates; keyboard and
mouse-only input; configurable frame-independent pacing; canonical French upgrade
and buff fixtures; unknown identities; reused buff IDs; delayed observations;
run/import/counter/time resets; inactive revisions; stale/untrusted measurements;
and the actual watcher compatibility path.

`tests/ascend.test.js` additionally verifies that named Dragonflight/French effects
hold the pre-ascension sequence before loans and that a new Dragonflight during
loan harvesting defers the final ascent. Strategy regressions exercise zero,
15/second, and larger measured rates. A controlled 3-to-15/second comparison
feeds saved measurements into the purchase view, increases Dragonflight/Dragon
Cursor gains fivefold, and moves Muridal from ruby to diamond for the same passive
production. The focused suite also passes against the concurrent save-lifecycle
watcher/identity/registry implementation in a disposable combined-source copy.

Run with `node --test --test-timeout=120000 tests/*.test.js`. The separate lifecycle
PR fixes the existing Node 22 `npm test` discovery problem.
