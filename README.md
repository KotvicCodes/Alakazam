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
Alakazam plays the way a human physically could:
- **Perceive**: it reads only what is rendered on screen. Exact per-building
  production and upgrade prices are pulled from the game's own hover tooltips,
  the same numbers a player sees. It never reads the page's `Game` object.
- **Act**: every action is a real dispatched pointer/mouse event (see
  `src/input.js`). It never calls `element.click()` or any Cookie Clicker JS API.
- **Compute**: all optimization runs locally in the extension. There is no backend.

## Architecture
Five ordered content scripts sharing one global (`window.Alakazam`):
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