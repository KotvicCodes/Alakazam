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

## Todo
- Add some memory, so Alakazam won't go for already completed achievements after refreshing the window
- Add free starting achievements
    - Stifling the press
    - Cookie-dunker
    - Fading luck
- Autoclose completed achievements - they are annoying
- Sugar lumps optimization strategy
- Buying suboptimal buildings for specific achievements/upgrades

## Debugging
For debugging, it is useful to see how exactly the macro works in different stages of the game. Paste this code to the console to accelerate your progress.
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
Ordered content scripts sharing one global (`window.Alakazam`):
- `src/core/savefile.js` — decodes the game's `localStorage` save into plain data:
  scalars, per-building records, the upgrade and achievement bitfields, and the
  garden / stock market / pantheon / grimoire sub-saves. Pure apart from one read.
- `src/core/identity.js` — derives a stable per-save `legacyId` and per-ascension
  `runId` by hashing the save's seed and timestamps.
- `src/parse.js` — turns any rendered number (suffix words, scientific, grouped
  digits) into a plain `Number`.
- `src/input.js` — the only place clicks happen: `simulateClick`, `hoverOn/Off`,
  and the burst autoclicker.
- `src/measure.js` — `snapshot()` reads the DOM (and tooltips) into a plain data
  object: cookies, CpS, per-building price + per-unit production, store upgrades
  with prices and classification, shimmers, buffs, lumps, wrinklers.
- `src/strategy.js` — pure payback scoring over a snapshot; returns one decision.
- `src/main.js` — a fast loop (autoclick + shimmer grab) and a slow loop
  (measure → decide → buy).

## Autobuy Strategy
Every slow cycle:
1. **Buy the cheapest affordable ordinary upgrade** (upgrades dominate ROI;
   toggles, pledges and season switchers are classified and skipped).
2. Otherwise **rank buildings by payback** (`price / per-unit CpS`). Buy the best
   one if affordable, else wait so cookies accumulate toward it instead of being
   spent on a worse building.

The latest measurement is exposed on `window.__alakazam` and logged as a compact
line each cycle, so the collected data is inspectable in the console.

## Future Improvements
- Convert upgrade tooltip effects into a real CpS delta for payback scoring
- Golden-cookie buff timing (buy during frenzies)
- Sugar lump type strategy and wrinkler farming
- Ascension / prestige planning
- Building purchases for specific achievements