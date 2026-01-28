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
- Implement stronger, faster autoclicker
- Implement better strategy of buying upgrades & buildings
- Add some memory, so Alakazam won't go for already completed achievements after refreshing the window
- Add free starting achievements
    - Stifling the press
    - Cookie-dunker
    - Fading luck
- Autoclose completed achievements - they are annoying

## Debugging
For debugging, it is useful to see how exactly the macro works in different stages of the game. Paste this code to the console to accelerate your progress.
``` JavaScript 
for (let i = 0; i < 50; i++) {
    const newShimmer=new Game.shimmer("golden");
}
```

---
# Game Strategy
## Autobuy Strategy

### Core Logic
Every time Alakazam buys something:
1. Check for affordable upgrades → buy immediately (always prioritized)
2. If no upgrades available:
   - Find all buildings affordable within next 30 seconds
   - Score each by efficiency: `cps gain / cost`
   - Wait until the best one is affordable
   - Buy it and repeat

### What We Track
- CPS per building per building type
- Building counts (for upgrade unlocks)

### Current Simplifications
- Fixed 30s evaluation window (no adaptive delay yet)
- No special handling for first 15 minutes
- Upgrades bought immediately without efficiency calculation

### Future Improvements (v2+)
- Adaptive delay system:
  - Starts at some base delay
  - Increases when no purchases made (up to ~15min max)
  - Decreases when purchases made (down to ~1min min)
  - Reduced to ~5s during golden cookie effects
- Aggressive early game strategy (first 15 mins)
- Smart upgrade evaluation instead of "buy all"

### Ignored for Now
- Sugar lumps features
- Buying suboptimal buildings for:
    - Achievements
    - Upgrades