# Testing and compatibility

Use Node 22.22+ on the 22.x line or Node 24.x. CI runs the unit suite on both
lines and browser tests on Node 22, Ubuntu, and Playwright's bundled Chromium.
`package-lock.json` pins development dependencies; install with `npm ci`.

```sh
npm ci
npm test
npx playwright install chromium --no-shell
npm run test:game:fetch
npm run test:browser
npm run test:extension
# Or run both browser projects:
npm run test:integration
```

On a minimal Linux host, use `npx playwright install --with-deps chromium --no-shell`
to install browser system libraries too. A display server is not needed. The
browser download and game fetch require network access; test pages block requests
outside the local fixture server. Do not point this suite at a real game/profile.

## Layers and limits

- **Unit harness:** `npm test` recursively discovers `tests/**/*.test.js` and
  passes explicit sorted filenames to `node --test` without shell glob expansion.
  `.spec.cjs` browser tests and helpers are excluded. The original 283 tests stay
  here, with two tests for clock/storage fixture isolation. `tests/harness.js`
  loads content scripts in manifest order into a VM, omitting the bootstrap unless
  `includeMain` is requested. Fake DOM/storage checks do not establish browser
  compatibility.
- **Game browser layer:** `tests/browser/game.spec.cjs` exercises save decoding,
  event-driven purchases, ascension DOM states, French game-generated tooltips,
  lump changes between saves, warehouse capacity, and live cosmetic changes. It
  loads the content scripts in manifest order except `main.js`, starts with the master
  switch disabled, and enables it only for specific manually invoked actions.
  Transaction restoration and live garden maturity with a selected seed have combined regressions. These scripts share the page's world;
  this project makes no isolated-world or native-storage claim.
- **Unpacked-extension smoke:** `tests/browser/extension.spec.cjs` copies the
  extension into a temporary directory, generates a test-only key, and replaces
  origin permissions/matches and the temporary popup/background origin guards with
  localhost. Chromium loads it through
  `--load-extension`, including `main.js`. The test proves that the page's `Game`
  and the content scripts' `Alakazam` globals are isolated, the content script reads
  the game's real localStorage save, popup settings reach content scripts through
  real `chrome.storage.onChanged`, content-script settings/status reach the actual
  popup, and settings survive closing/reopening the temporary browser profile.
  The master switch stays off. The popup document runs as an extension tab; toolbar
  opening/closing behavior, canonical-site permissions, and multiple game tabs are
  outside this smoke test.

The disposable game is **Cookie Clicker 2.058**, from
[ozh/cookieclicker at c77f00c51854a667da35a3135120797a579c2d72](https://github.com/ozh/cookieclicker/tree/c77f00c51854a667da35a3135120797a579c2d72).
`tests/browser/game-pin.json` is the source of that pin. The fetch script checks out
that exact commit into ignored `.cache/cookieclicker`; the server refuses another
commit or tracked/untracked modifications. Port 4173 must be free; set
`ALAKAZAM_TEST_PORT` to use another local port for a concurrent audit. Remove the
disposable checkout and fetch again if it has been modified. Game assets are not
vendored or published. The server binds only to 127.0.0.1 and stops with Playwright.

The audit reports/diagnostics under `docs/audit` describe historical review of this
mirror at Alakazam `db59cd3`. They did **not** verify a canonical-site session or an
installed extension's isolated worlds/storage bridge. The new local smoke covers
the latter in its stated test configuration; it does not retroactively expand the
audit's evidence or certify the canonical site.

A browser failure saves a trace under ignored `test-results/`; CI uploads failures
for seven days. Inspect a trace with `npx playwright show-trace <trace.zip>`.

## Broader installed-extension acceptance

`tests/extension.browser.cjs` also exercises keyboard controls, focus and scroll
preservation, dragging across refreshes, viewport clamping, two game tabs, active-tab
selection, restrictions, module failures, and navigation/close cleanup. It uses a
fresh Chromium profile and canonical game URLs. Route those requests to the pinned
local mirror to run without a live-site dependency:

```sh
ALAKAZAM_GAME_DIR="$PWD/.cache/cookieclicker" node tests/extension.browser.cjs
```

The runner reports its screenshot directory and removes its disposable profile.
`ALAKAZAM_ARTIFACTS` selects a screenshot directory; `ALAKAZAM_CHROMIUM` selects an
executable. This verifies the installed extension with a local game mirror, not
live-site availability, toolbar popup lifecycle, or a real player profile.

## Reusable fixtures

`tests/clock.js` exports `clock(start)`. Pass it as `boot({ clock })` to control the
VM's Date, timeouts, and intervals without modifying the test process's globals.
`clock.advance(ms)` synchronously drains due timers in order; await promises as
needed after advancing to allow their continuations to run. The existing explicit
`h.frame()` remains the animation-frame driver. A fresh clock per harness prevents
one test from changing another test's time.

`tests/fixtures.js` exports browser-shaped `storage(initial)` and
`autosaves(initial, { key, now })`. `change(patch)` changes the live fixture state;
`publish()` writes a new encoded save. Before publish, readers still see the old
save. `now` can be `clock.now`, and `save({ now })` also accepts an explicit timestamp.
Use storage's `setItem`/`removeItem` to simulate imports, alternate keys, late save
creation, or reset transitions.

```js
const { test } = require('node:test')
const { clock } = require('./clock')
const { autosaves } = require('./fixtures')
const { boot } = require('./harness')

test('observe a published save', async () => {
    const time = clock()
    const scene = autosaves({ cookieClicks: 1000, handmadeCookies: 1e6 }, { now: time.now })
    const h = boot({ clock: time, localStorage: scene.localStorage })
    scene.change({ cookieClicks: 1600, handmadeCookies: 1.6e6 })
    time.advance(60000)
    scene.publish()
    await h.A.registry.get('saveWatch').tick()
    await h.A.registry.get('clicks').tick()
    // Assert the owning feature's correct outcome here.
})
```

`tests/browser/fixtures.cjs` exports:

- `openGame(page, 'EN' | 'FR')`, `localOnly(context)`, `loadAlakazam(page)`:
  disposable language-specific sessions, request isolation, and manual module setup.
  `openGame` writes the game's own initial save and reloads before returning, so
  fresh-start save recovery cannot overwrite later unsaved fixture state. A browser
  regression holds the pinned game's recovery timer and verifies this isolation.
- `transition(page, stage)`: actual game prompts and ascend/reincarnate transitions.
  Stages are `ascend-prompt`, `intro`, `ascending`, `reincarnate-prompt`,
  `reincarnating`, `playing`, in that order. Only animation tails are shortened.
- `researchTooltip(page, name)` and `buffTooltip(page, name)`: game-generated
  tooltip markup; use a French `openGame` session for localized text.
- `publish(page)`: the game's own save writer followed by the extension save watcher.
- `lumpReserve(page)`: 102 saved lumps with the early level plan satisfied and an
  eligible two-lump upgrade. No implicit save follows the next live level-up.
- `stockCapacity(page)`: real market state with a preferred $1 good at 91/91 and
  another $5 good at 0/10. Both have strong-buy signals; other goods are hold.
  It renders the actual controls, publishes the save, and returns the capacities.
- `cosmeticChange(page, saved, live)`: a saved appearance followed by a different
  unsaved live appearance. Returns both snapshots and the unchanged raw save.

Game APIs are used **only to prepare fixtures** or advance game animations.
Extension actions under test must use the production event dispatchers. No real
player save or browser profile is read. Each browser test gets a new context; the
extension smoke removes its temporary copy/profile in `finally`.

## Regression ownership

A fix must add assertions for the intended behavior in the same PR. Keep the
historical diagnostics as evidence; do not copy their broken-behavior assertions
into a passing suite, add permanent skips, or postpone regressions to a later
infrastructure PR. This PR supplies fixture contracts and smoke coverage; it does
not fix gameplay or claim the known defects are covered by passing regressions.

- Save/persistence fixes own alternate-key refresh, delayed discovery, identity
  transitions, reset handling, and namespace reconciliation regressions.
- Click/income fixes own event detail, registered click cadence, counter resets,
  fresh inactive-save samples, and clock-driven measurement regressions.
- Automation-safety fixes own pause cancellation, transition guards, French
  blocked research/buff protection, Dragonflight, and wrinkler/ascension safeguards.
- Garden fixes own real tooltip maturity stages and localized/unknown-stage safety.
- Purchase/lump/market fixes own bulk-price interpretation, a 100-lump reserve
  across two ticks before autosave, and selecting an executable good when the
  preferred warehouse is full.
- HUD/popup/cosmetic fixes own visibility restoration, status ownership/labels,
  safe text rendering, and restoration of the exact unsaved live appearance.

Update the game pin deliberately when testing a new game version, then review
save layouts, translated markup, and event semantics. Invariant-based parsing is
a sanity check, not proof that every plausible positional value is correct.
