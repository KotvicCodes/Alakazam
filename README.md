# Alakazam
A neat browser extension which optimizes your [Cookie Clicker](https://orteil.dashnet.org/cookieclicker/) run, so even you can beat [Dragoon](https://youtube.com/@dragoon45?si=-WajyeQE3sHwMHe7) in 100% completion of the game at home

## Installation Guide
### Disclaimer
This extension will eventually be included on [Chrome Web Store](https://chromewebstore.google.com/), but as long as the extension is still in its beta version, it is harder to run it on your Cookie Clicker instance.

Also please do not sue me if your computer explodes, implodes or does something unexpected after loading this. However, as long as I've committed something recently, you can be sure my computer survived all my quality code

### Guide
1. Clone or download this repository to your computer
2. Navigate to "chrome://extensions/", "brave://extensions/" or the equivalent extensions page of your Chromium based browser. You may also find it under a puzzle icon on your browser's toolbar, to the right of the search bar, or in the "more options menu" (three dots icon) of your browser
3. Turn on Developer mode
4. Click "Load unpacked" and select the folder containing this repository
5. Open Cookie Clicker and profit!

There is no build step. The repository *is* the extension.

## Using it
A panel appears in the top right of the game. It shows what Alakazam is currently
doing and why, and every part of it can be switched off independently: the
autoclicker, buying, the garden, the pantheon, and so on. Drag it by its header,
collapse it with the button, or turn it off entirely. The toolbar popup mirrors
the same switches.

Everything Alakazam knows is also on `window.__alakazam` in the console.

## Development
```bash
npm test              # unit tests, no browser needed
npm run format:check  # prettier
```

Tests run under `node --test` against a small fake document and a fake Cookie
Clicker, so the content scripts are loaded exactly as the manifest lists them and
exercised without a browser.

## Todo
- Pop wrinklers automatically (they are drawn on a canvas, so this needs hit-testing).
  This is the one that now costs something: every ascension throws the hoard away
- Golden cookie combos, which are the largest single source of cookies in the game
- Cookie-dunker, which needs the cookie to physically reach the milk

Everything else that used to be here is done, and the larger plans have moved to
[docs/ROADMAP.md](docs/ROADMAP.md).

## Debugging
Everything Alakazam thinks is on `window.__alakazam`, and the two choices that are
worth arguing with will print their whole comparison table on request:

``` JavaScript
window.Alakazam.dragon.explain()    // every aura the dragon knows, scored
window.Alakazam.pantheon.explain()  // the best spirit layouts, scored
```

Both print the measured inputs alongside the table, and flag any term that is an
assumption rather than a measurement, so a ranking can be checked against what the
run actually did rather than taken on trust. They also log themselves whenever the
answer changes, so a long session leaves a trail.

It is also useful to see how exactly the macro works in different stages of the game. Paste this code to the console to accelerate your progress.
``` JavaScript 
for (let i = 0; i < 50; i++) {
    const newShimmer=new Game.shimmer("golden");
}
```

---
# Game Strategy

## Fair-Play Contract
Alakazam plays the way a human physically could, and it is honest about where it
looks:
- **Act**: every action is a real dispatched pointer/mouse event (see
  `src/input.js`). It never calls `element.click()` or any Cookie Clicker JS API.
  This half of the contract is absolute.
  - *One exception, and it is in the same file.* Two of the game's own text fields
    are written to rather than clicked: the bakery name, for an achievement that
    asks for a particular one, and the gift code box, because a code cannot be
    clicked into existence. Both values are ours, the game validates what it is
    handed, and `typeInto` lives next to `simulateClick` so the exception is as
    countable as the rule.
- **Perceive**: three sources, in order of preference.
  - *Rendered DOM* for anything live: the bank, CpS, on-store prices, shimmers on
    screen, active buffs.
  - *The game's own hover tooltips* for exact per-building production and upgrade
    effects, the same numbers a player reads by hovering.
  - *The save file* that the game itself writes to `localStorage` on this origin.
    It never reads the page's `Game` object and never injects into the page.
- **Compute**: all optimization runs locally in the extension. There is no backend.

### Why the save file
Some state is simply never rendered. The garden's plot contents and seed log, the
hidden trend mode behind every stock, pantheon swap timers, grimoire magic, and
which achievements you already hold are all in the save and nowhere on screen.
Reading it also replaces most of the tooltip hovering that used to make a single
measurement pass take seconds, so Alakazam can act continuously instead of once
every couple of seconds.

The save lags: the game writes it on autosave, up to 60 seconds behind. So it is
used only for slow, structural state. Anything Alakazam spends cookies on is read
live from the DOM.

**Your data stays yours.** The raw save string is never logged, never stored
verbatim, and never leaves your machine. Your bakery name is treated as user data.
The per-save identifier Alakazam remembers you by is a hash, not the values.

## Architecture
Content scripts sharing one global (`window.Alakazam`), loaded in the order
`manifest.json` lists them. Only `src/core` has to be ordered; every module
registers itself, so adding one is a file and a manifest line.

**Core**
- `src/core/savefile.js` — decodes the `localStorage` save into plain data:
  scalars, per-building records, the upgrade and achievement bitfields, and the
  garden / stock market / pantheon / grimoire sub-saves. Version gated.
- `src/core/identity.js` — a stable per-save `legacyId` and per-ascension `runId`,
  hashed from the save's seed and timestamps.
- `src/core/store.js` — `chrome.storage.local`, namespaced per save. Also the
  bridge to the popup, so there is no background worker.
- `src/core/registry.js` / `scheduler.js` — modules self-register with their own
  cadence. One frame loop and one millisecond driver run all of them, isolating
  failures and budgeting clicks.

**Perception**
- `src/parse.js` — any rendered number (suffix words, scientific, grouped digits)
  into a plain `Number`.
- `src/measure/live.js` — the hot path. Bank, CpS, prices, shimmers, buffs. Reads
  rendered text only and hovers nothing, so a full pass is sub-millisecond.
- `src/measure/catalog.js` — the cold path. Tooltip reads behind a mutex, one
  building and two upgrades per tick, and never while your real mouse is moving.
- `src/measure/buffs.js` — what is currently boosting production, by name and by
  how much of it is left. A buff renders as an icon and nothing else, so the name
  comes from its tooltip and the time left is decoded out of the pie timer's
  sprite offset.
- `src/measure/save.js` — reparses the save only when its fingerprint changes.
- `src/measure/income.js` — where the cookies come from. Samples production,
  clicking and golden cookies once a second, and recovers the lump sums that never
  pass through CpS by comparing the save's own earned total against what was on
  screen while it was earned. Both the dragon and the pantheon are chosen off this.

**Action**
- `src/input.js` — the only place clicks happen: `simulateClick`, `hoverOn/Off`.
- `src/act/store.js` — owns the store's shared buy/sell mode and 1/10/100 amount,
  and always puts it back.
- `src/act/drag.js` — the mousedown/move/up sequence the pantheon needs.
- `src/act/dragon.js` — Krumblor's panel. Its tab is painted onto a background
  canvas and hit-tested against the mouse position, so opening it means clicking
  the canvas at the tab's coordinates and then checking what appeared.
- `src/act/ascend.js` — the ascension screen. Confirms a prompt only when the
  prompt names itself in the DOM, because every confirmation in the game, up to
  and including "Really wipe save", is the same `#promptOption0`.
- `src/act/loans.js` — the bank's three loan slots, which nothing outside the
  pre-ascension sequence may touch.

**Decisions** — `src/strategy/score.js` for purchases, `src/strategy/ascend.js` for
prestige, `src/strategy/dragon.js` for auras and `src/strategy/pantheon.js` for
spirits. All pure functions over measured data, and the last two return the terms
behind every score so the reasoning can be printed rather than trusted.

**Modules** — `src/modules/*`: autoclick, shimmers, wrinklers, purchase, lumps,
grimoire, pantheon, dragon, garden, market, achievements, ascend, clones, gifts. Plus
`src/hud.js`.

## Autobuy Strategy
Buying used to be one purchase every couple of seconds, because measuring the
store meant hovering every building and every upgrade first. Now prices come from
the store faces, which are already on screen, so a decision costs nothing and
purchases run in a drain loop: buy, re-evaluate, buy again, until nothing is worth
buying or the tick's click budget runs out.

1. **Upgrades are bought as soon as they are affordable**, cheapest first. In
   Cookie Clicker they are cheap relative to their effect and mostly permanent
   multipliers, so buying them all is very close to optimal and far more
   predictable than trying to price them. Toggles, pledges and season switchers
   are classified and skipped. Their effects are still parsed out of the tooltip
   where possible, and reported, but nothing hinges on whether that worked.
2. **Buildings** are scored by payback, price over per-unit production, with a
   discount for a purchase that crosses 10, 25, 50, 100 and so on, because those
   unlock the next tiered upgrade.
3. If the best building is not affordable, **wait** rather than settling for a
   worse one.

**How many to buy** is its own decision, and the largest of three rules wins:
buying one at a time is always the most efficient, so the batch size is however
many a one-at-a-time loop would have bought before something else became the
better target; a batch that reaches a tier boundary is worth slightly worse
payback; and once a batch costs under a twentieth of the bank, take it, because
the elapsed time of clicking singles costs more than the ordering efficiency it
protects.

It will hold cookies back for something better, but only for about a minute.
Saving longer than that is a loss: cookies in the bank earn nothing, while a
building bought now starts paying immediately and brings the expensive one
closer. Past that limit it buys the best thing it can actually afford.

## What else it plays
- **Sugar lumps** — harvests on ripe, where the game guarantees the lump, rather
  than on mature, where it fails half the time. How long that takes is measured
  off the lump's own sprite rather than assumed: several upgrades and Rigidel
  shorten the ripening, and the lump falls an hour after it ripens either way, so
  a save with all of them has lost the lump by hour 21. Spends them on the four
  minigame unlocks first, then the garden's full plot, then click levels, and
  banks a hundred for the production bonus.
- **After an ascension** — for the first five minutes of a new run the store is
  swept with the game's own "Buy all upgrades" button rather than picked through
  one upgrade at a time. A returning run buys back a whole run's worth of
  upgrades faster than anything can read them, and while everything on offer is
  trivially cheap the order hardly matters. It needs the heavenly upgrade
  "Inspired checklist", and it cannot buy the research that starts the
  grandmapocalypse: the game's own button skips the tech pool.
- **Garden** — reads the plot and seed log from the save, hunts the next reachable
  mutation, harvests anything that unlocks a seed or pays out, and switches to
  wood chips to triple mutation chances while hunting.
- **Grimoire** — models magic capacity and regeneration from the game's own
  formulas, and casts Force the Hand of Fate only while a production buff is up.
- **Pantheon** — sets up the temple and then mostly leaves it alone, because swaps
  regenerate over hours. Which three spirits is priced rather than preset: every
  layout is scored against measured production, clicking and golden cookie income,
  including the golden cookie frequency two of the most recommended spirits quietly
  cost you. Never slots Holobore, which unslots itself the moment a golden cookie is
  clicked, and Alakazam clicks every golden cookie it sees; never chases Cyclius,
  whose bonus is a sine wave and whose cycle is longer than the swap budget. If the
  dragon is wearing Supreme Intellect the whole table changes, because it promotes
  every slot a tier, and that is the one place the two minigames meet.
- **Golden cookies** — clicked immediately. Wrath cookies are held off while a
  buff is running, so a Clot or a Ruin cannot end a combo.
- **Stock market** — the save records each good's hidden trend outright, so
  Alakazam trades on that. Switch trading off and it keeps reporting the signals
  without touching your money.
- **Ascension** — follows the wiki's ascension guide: the next prestige target
  above where the save already stands, then a fixed shopping order through the
  heavenly tree. It never
  leaves in the middle of a boost, because the cookies a running frenzy would have
  made count toward prestige and pulling the lever early throws them away.
- **Permanent upgrade slots** — reassigned at every ascension rather than filled
  once and forgotten. A slot is worth revisiting because the best thing to put in
  one moves with the save: kittens scale with milk, milk scales with achievements,
  and achievements are the one thing an ascension never takes away. It reads what
  each slot is already holding before it opens the picker, because the game never
  offers a slot its own occupant, and taking the best of what is left would quietly
  swap the strongest kitten out for the second strongest.
- **Loans** — the bank's three loans are a bad deal in an ordinary run and close
  to free immediately before an ascension, because the penalty belongs to the run
  and the run is about to end. All three are taken, the forty second one last, and
  the ascension happens inside its window. That is the "Debt evasion" achievement.
- **Clones** — the first time a You is bought, the customizer is walked to the
  look that earns "In her likeness" and then straight back to whatever the clones
  were wearing, or to a preset if they were still on the game's default. It runs
  once, in a single pass; after that the clones are yours to dress.
- **Krumblor** — trains the dragon from the egg up, every run, because the game
  resets it on every ascension. Radiant Appetite doubles all production and is
  fourteen building sacrifices up the ladder, which is a bargain even mid-run. The
  aura is not picked from a guide: every aura the dragon knows is scored against
  what this save actually earns, and the whole table goes to the console. Three of
  the auras the guides rank highest are near worthless here, all for the same
  reason: they pay for clicking or for golden cookies left sitting on screen, and
  Alakazam clicks three times a second and takes every golden cookie the instant it
  appears. It also pets the dragon for its drops, and learns which quarter of the
  hour produces which one rather than wasting the attempt.
- **Gift codes** — wraps a gift, keeps the code, and redeems it once the hour the
  game makes you wait is up, or once an ascension has cleared it. That is the
  "No time like the present" achievement, start to finish.

## Future Improvements
See [docs/ROADMAP.md](docs/ROADMAP.md) for the full list, including wrinkler
popping, golden cookie combos, the dragon, seasons, the stock market tick oracle,
and redeeming gift codes.
