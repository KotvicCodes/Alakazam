# HUD and active-tab status verification

The extension still loads plain scripts directly from `manifest.json` and
`popup.html`; there is no build step. Install/reload the unpacked extension from
this directory, then reload existing game tabs to load the updated content scripts.

The HUD starts as a compact bottom-left strip. Pause/Resume remains visible;
Configure expands grouped module controls and diagnostics. Native buttons support
Tab, Enter and Space. The Dock button cycles bottom-left, top-left and bottom-center;
dragging the header supports custom placement. Restored positions, resize and
fullscreen changes use the same viewport clamp. Settings apply to every game tab;
status and document identity are tracked separately for each tab.

Unsupported languages suspend modules that depend on English UI policy/measurement.
Unresolved save identity suspends those modules until the save watcher resolves it.
Autoclick, shimmer collection, wrinkler advice, save observation, status and HUD can
continue independently. These restrictions are enforced by the same scheduler logic
that supplies the displayed module states. Save parse warnings remain visible.

## Automated checks

```sh
npm install
npm test
npm run format:check
```

The seven status regressions cover hidden-startup recovery and stable nodes,
paused/hidden live readings, scheduler restrictions, setup errors, building totals,
identity/namespace refresh while paused, and observable storage failures/recovery.
Existing module tests now inspect the persistent DOM instead of generated HTML.

## Installed-extension browser checks

The optional acceptance runner needs full Chromium with extension support and
Playwright. It creates and removes its own temporary browser profile. It never
opens the user's profile or existing saves, and keeps automation paused except for
a master-toggle check with all action modules explicitly disabled. Game APIs in
this runner prepare disposable fixtures; extension code continues to use the DOM
and saved data.

```sh
npm install --no-save playwright
npx playwright install chromium
node tests/extension.browser.cjs
```

`ALAKAZAM_PLAYWRIGHT` can point to a separately installed Playwright package;
`ALAKAZAM_CHROMIUM` can select an existing full Chromium executable.
`ALAKAZAM_GAME_DIR` optionally supplies an unmodified Cookie Clicker source mirror
(including images and language files); requests are served under the real game/CDN
origins so manifest matching, isolated content scripts, the service worker,
`chrome.tabs`, runtime messages and `chrome.storage.local` are exercised normally.
No extension APIs are mocked. Certificate bypass is optional and limited to this
disposable test context via `ALAKAZAM_IGNORE_CERTIFICATE_ERRORS=1`.

The runner checks:

- A hidden startup publishes paused status and can be enabled from the popup
  document using the keyboard.
- HUD and popup controls preserve node identity, keyboard focus and scroll through
  multiple periodic refreshes. Enter/Space toggle controls and master pause.
- Expanded and compact HUDs leave actual store purchases accessible at 1280×800.
- Keyboard docking, 640×400 and 320×480 viewports, return to 1280×800, and a reload
  with saved coordinates at `(9000, -800)` keep the panel in view.
- Two game tabs retain separate tab/document records; selecting either displays its
  live readings even when the other tab published more recently. Reload changes
  document identity. Navigation/close clears old records.
- Unsupported-language, unresolved-identity and injected scheduler failures reach
  the popup, including the original failure message.

Validation completed with Chromium 154 and the actual Cookie Clicker 2.058 source
mirror, using the installed unpacked extension and its real popup document.
Screenshots are written to `ALAKAZAM_ARTIFACTS` or a directory in the system temp
folder. The runner opens the popup document as an extension tab and activates the
game tab through Chrome's tabs API to reproduce the toolbar popup's active-tab
context in headless Chromium; toolbar placement itself is not tested.
