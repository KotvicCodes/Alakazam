# Alakazam 1.3.3 native Chrome acceptance report

Audit dates: October 25 to 27, 2026.

**Native Chrome toolbar and canonical-host acceptance: PASS for the observed lifecycle and host-permission checks. The complete acceptance suite is not approved. Four defects were reproduced, and several ownership/cancellation scenarios remain BLOCKED.**

The 74 matrix rows have primary outcomes of **69 PASS, 4 FAIL, and 1 BLOCKED**. Some PASS rows contain narrower unverified variants, which remain explicitly identified below.

This report distinguishes a verified result from an unavailable fixture. A group marked BLOCKED contains completed subcases but has outstanding requirements. No result establishes that the repository is bug-free. Unrelated gameplay backlog was outside this audit.

## Candidate and environment

| Item | Tested value |
|---|---|
| Repository | https://github.com/KotvicCodes/Alakazam |
| Candidate PR | https://github.com/KotvicCodes/Alakazam/pull/13 |
| Requested branch | `t3/review-and-merge-open-prs` |
| Exact checked-out commit | `a641d1f1b7d5d3923519405344317d9fb0cdf819` |
| Extension | Alakazam 1.3.3, unpacked, enabled and pinned |
| Extension ID | `hfmddennfdgidlciajfafdfdknbiadoh` |
| Isolated checkout | `/Users/kotvic/Desktop/GitHub/.worktrees/Alakazam/native-acceptance-a641d1f` |
| Existing test profile | Alakazam disposable test |
| Chrome | 155.0.8059.85, Official Build, arm64 |
| Chrome revision | `0e66b94549a8bd85f03fbdf189b752d6e7b63c32` |
| OS | macOS 26.6.2, build 25G83 |
| Live game | 2.058, https://orteil.dashnet.org/cookieclicker/ |
| Beta game | 2.058 beta, https://orteil.dashnet.org/cookieclicker/beta/ |
| Non-game control | `chrome://version/` |
| Additional game control | A second tab at the canonical live URL with different unsaved synthetic totals |

The shipped manifest and permissions were unchanged: `activeTab`, `storage`, host permission `https://orteil.dashnet.org/*`, and content-script match `https://orteil.dashnet.org/cookieclicker/*`. Installation used Chrome's real Load unpacked control. Popup tests used the pinned toolbar icon. `popup.html` was never used as a standalone tab to satisfy acceptance.

Before testing and again during report preparation, the checkout matched the requested commit and `git status --short` was empty. SHA-256 checks remained:

```text
manifest.json c134e595477093d6a29262c89aa13b28b9a6967e6c7ef75df70b5bf5f7379e71
package.json  0392366c8e5c89fbcdb053ee6c368ae5900f5e780eb828fbf48e69641f6f1165
```

No candidate source changes, commits, pushes, merges, or remote comments were made. No downloads were needed. The checkout stayed under Desktop/GitHub. Report files and screenshots use the separately approved output directory.

## Ranked defects

### P2: Beta ascension cannot verify even an empty live wrinkler hoard

**Impact:** Automatic ascension stays blocked on the canonical beta site. The guard fails safely: no loan or ascent was observed. This prevents progression rather than losing a hoard.

**Reproduction:**

1. In the disposable profile, load the candidate on the canonical beta URL. Pause automation and disable other gameplay modules.
2. Prepare and save a trusted synthetic run that meets the ascension target. Leave no player prompt open and remove all live wrinklers for the empty-hoard control.
3. Enable Ascension and Resume through the real HUD or toolbar popup.
4. Observe phase `ready` with `Waiting to verify the live wrinkler hoard. Clear other prompts and retry.` The same block occurs with a valuable hoard.
5. Inspect the export produced through the real Export save UI. Parse it in the isolated extension console and compare identities without mutating either identity.

**Expected:** A fresh trusted export from the beta page matches the current beta run and verifies a zero hoard, permitting the next valid step.

**Observed:** Export was trusted, hoard was zero, and no foreign prompt existed, but the exported snapshot had no `key`. Current save key was `CookieClickerGameBeta`. Current family/run were `v2-f6f939de` / `4ba6d873`; export family/run were `v2-d3410130` / `c097f687`. Adding the current beta key to a copy solely for identity calculation produced exactly the current family/run.

**Source explanation:** `src/act/ascend.js:134` parses the export and immediately calls `identity.fromSave(snapshot)`. `src/core/identity.js:42` defaults an absent key to the canonical live key. Family and run comparisons subsequently reject the beta export. This explains the observed mismatch; no fix was applied.

Evidence: [empty-hoard block](32-beta-empty-hoard-still-blocked.txt), [identity comparison](33-beta-export-identity-mismatch.txt), [initial guarded attempt](31-live-hoard-destructive-guard.txt). The canonical-live positive control correctly measured a valuable hoard in [35](35-canonical-live-hoard-guard.txt).

### P2: Reloading on the heavenly screen leaves ascension waiting for a reset that never occurred

**Impact:** Automatic ascension stops after a heavenly-screen reload. The current run still meets its target, but the module remains in `watching` with `waitingForSave:true` instead of recovering the interrupted sequence.

**Reproduction:**

1. In a disposable canonical-live game, prepare a trusted run with `cookiesEarned=1e24`, `cookiesReset=0`, `resets=0`, and no wrinkler hoard. Enable only Ascension and Resume through the native UI.
2. Let the actual module ascend and reach the heavenly screen. Pause there while phase is `shopping`, with persisted `ascendAwaitReset=0`.
3. Reload using the actual Chrome Reload button. Verify a fresh document and that the temporary timer instrumentation is absent. The game restores to play mode with `OnAscend=0` and `resets=0`; the unfinished run still has `cookiesEarned=1e24`.
4. Dismiss the startup language chooser with a trusted English click if present, then Resume through the native UI.
5. Observe the normal scheduler for at least 45 ticks. Inspect only the matching run's phase and awaiting-reset records.

**Expected:** Recognize that the heavenly sequence was interrupted before reincarnation and recover to an actionable safe state. A ready run should not wait indefinitely for a reset that the game did not complete.

**Observed:** Family C/run `c0b1728e` remained trusted and ready, but phase became `watching` and `waitingForSave:true`. More than 45 normal one-second ticks made no progress. Preserved storage readback showed `ascendAwaitReset:0` and `ascendPhase:'watching'`; actual game `OnAscend=0`, `resets=0`, earned `1e24`. There were no scheduler failures.

**Source explanation:** `src/modules/ascend.js:694` treats any return to play from shopping as manual reincarnation and changes phase to watching. `:747` clears the pending reset only after the saved reset count increases. The echo guard at `:748-757` then prevents both a new ready phase and further driving. Setup restores the pending zero at `:819-820`. This combination explains the observed permanent wait.

Evidence: [clean reload and retained markers](65-post-reload-verified.txt), [stalled scheduler and game state](67-heavenly-reload-stall.txt). A later read of the preserved old scope confirmed pending zero and watching. A separate fresh family completed a normal cycle, establishing a useful positive control in files 68-72. The earlier recursive test-wrapper error had been cleared before this reproduction; it is not the reported defect.

### P2: Cancelling a lump confirmation leaves a phantom pending upgrade

**Impact:** Cancellation protects the bank and player prompt, but subsequent automatic lump spending can stall until the page reloads.

**Reproduction:**

1. Use the disposable canonical beta game with the early level plan complete, Wizard tower level two as highest producer, 103 current/lifetime lumps, real lump confirmation enabled, and reserve 100. Save and reload so rendered controls match.
2. Enable only Sugar lumps. Wrap the real transactions.until to forward its implementation but temporarily hold delivery of the result once the actual SpendLump prompt exists.
3. Let the real module open its ordinary cost-three level-up confirmation. Either Pause, or natively choose No and open the player's Import save dialog, then release the real continuation.
4. Dismiss any player dialog. Resume normal scheduling, retaining the actual bank of 103 and Wizard level two. Write a fresh normal save.
5. Compare the planner before and after a real Chrome reload of that same saved state.

**Expected:** Cancelled, unconfirmed spending leaves no outstanding reservation. The next eligible ordinary tick may propose the same cost-three upgrade.

**Observed:** No lump was spent and the player Import prompt survived. After dismissal, nextSpend(103) returned null. Follow-up showed 51 completed scheduler runs and still no proposal. A fresh trusted save contained level two; after Resume, runs increased to 53 and nextSpend remained null. Reload cleared the in-memory reservation: the same save immediately proposed cost three/reserve 100, and the real module then completed level two to three with balance 100. The long elapsed wall interval includes a user interruption and native pause, so it is not represented as continuous running time.

**Source explanation:** src/modules/lumps.js:318-324 treats an invalid lease with no current SpendLump prompt as a possibly immediate spend, reduces balanceCeiling and pushes a planned level even when the real confirmation was cancelled. levels() subsequently counts that planned level. reconcile() removes a reservation only when a save reaches the assumed higher level. This explains why a save of the actual unchanged level does not clear it.

Evidence: [held confirmation](86-lump-confirmation-held.txt), [pause safety](87-lump-confirmation-pause.txt), [player prompt safety](88-lump-confirmation-foreign-prompt.txt), [retained reservation and scheduler](91-lump-cancelled-spend-followup.txt), [same-save reload recovery](92-lump-reload-positive-control.txt). File 89 remains an excluded failed earlier follow-up query.

### P3: Rounded-price refusal repeats clicks while funds remain unchanged

**Impact:** Buying repeatedly retries a purchase the game refuses. It violates the requested no-repeat behavior. No lost funds, unintended sale, bulk-count corruption, or tight click loop was observed.

**Reproduction:**

1. Pause the disposable canonical-live game. Disable other gameplay modules and autosave.
2. Prepare Cursor ownership zero, actual next price `1000400`, displayed price `1 million`, bank exactly `1000000`, and zero passive income. Keep the ordinary game purchase and price methods. Price other buildings out of reach and vault upgrades so Cursor is the candidate. Use Buy mode and bulk one.
3. Record product click outcomes around the ordinary game handler. Enable Buying and Resume through the real HUD.
4. Keep funds and ownership unchanged for approximately 38 seconds.
5. Increase the bank to `1100000` without reloading and observe recovery.

**Expected:** After the first refusal, repeated unchanged-state purchase clicks stop. Adding enough funds permits recovery without a reload or a bulk change.

**Observed:** 35 refused product clicks over 38,353 ms, ownership zero throughout, bank `1000000`, Buy mode and bulk one intact. Approximately 1.1 seconds separated attempts. Adding funds caused one successful Cursor purchase in the same document, with bulk one retained.

The purchase action reports `purchase not observed` and requests a redraw in `src/act/store.js:276`; the observed retry path still accepts the rounded affordable price on later attempts. Evidence: [first refusals](46-abbreviated-price-refusal.txt), [35-attempt measurement](47-unchanged-bank-repeated-refusals.txt), [funded recovery](48-purchase-recovers-after-funds.txt).

## Acceptance matrix

Evidence numbers refer to the numbered files in this directory and the [evidence index](evidence-index.md). Additional chronology and setup corrections are retained in [observations](observations.md).

### 1. Native toolbar popup and canonical permissions: PASS

| Subcase and setup | Expected | Observed / result | Evidence |
|---|---|---|---|
| Actual live and beta hosts, shipped manifest | Both inject and expose native toolbar status | **PASS.** Both canonical pages loaded the content script; toolbar indicated site access; native popup showed 1.3.3. | 01, 02, observations |
| Switch live, beta, and second live | Status belongs to selected tab | **PASS.** Live tabs `876294301` and `876294303` showed distinct zero/2.222k totals; beta `876294302` had its own family/run. | 01, 02 |
| Non-game tab | Disconnected guidance without game totals | **PASS.** `Select a Cookie Clicker tab to see its status`. | 03 |
| Repeated open, outside click, reopen | Single controls and durable settings | **PASS.** Actual page-outside dismissal, Escape, and reopening retained pause/settings; no duplicate controls or stale cross-tab totals observed. | 01-04, observations |
| Reload a game with unsaved totals different from saved totals | New document's status replaces old status | **PASS.** Reloaded popup showed saved 1k, 0.1 CpS, one building, paused, instead of previous unsaved bank. Earliest loading-frame behavior was not captured, so no atomic document-race guarantee is claimed. | 10; 09 is contextual only |

### 2. Controls and Chrome storage: PASS

| Subcase and setup | Expected | Observed / result | Evidence |
|---|---|---|---|
| Pause/Resume across multiple game tabs | Popup/HUDs agree | **PASS.** Native master toggle propagated to live and beta; new popup instances agreed. | 01, 10, 59, observations |
| Pause after real autoclick activity | No new automated clicks | **PASS.** Registered click count remained 856 while paused; building count also stayed unchanged. | observations |
| Harmless HUD setting and immediate popup destruction | Setting survives reopening and game reload | **PASS.** HUD on/off retained across popup closure; pause remained after both live reloads. HUD remained enabled after later reload/restart. | 04, 10, 59, observations |
| Older asynchronous settings read versus newer native pause | New pause wins | **PASS.** Held an old real `get(null)` callback, paused through native popup, then released. `completed=true`, `enabled=false`, `ready=true`, `paused=true`. | 08 |
| Failed native popup settings write | Persistence error survives successful status polling | **PASS.** Synthetic write exception remained visible while status refreshed, including observations 12 seconds apart. | 04, observations |
| Remove write failure, native retry | Error clears only with successful persistence | **PASS.** Native Refresh status retried; durable HUD false record read back, pending zero, error empty. | observations |
| Cosmetic durability before mutation | Recovery record durable first | **PASS.** Held name write and failed initial clone write prevented cosmetic mutation. Successful retry later restored normal recovery. | 11, 53, 54, 58 |

### 3. Imports, resets, and identity quarantine: FAIL overall

Synthetic families A and B used distinct full dates and seeds. A: name `Native Beta A`, family `v2-19973791`, run `93596dd9`. B: name `Native Beta B`, family `v2-f6f939de`, run `4ba6d873`. Initial clone genes were `[0,1,0,0,0,0,0]`. Later clone tests used explicitly recorded genes. Live family C was `v2-a2c75ec9`, run `c0b1728e`. These are disposable fixture values.

| Subcase and setup | Expected | Observed / result | Evidence |
|---|---|---|---|
| Suspend A's rename journal, import B using Ctrl+O and native Load, open player Import prompt, release A | Old task leaves B and player prompt intact | **PASS for the suspended rename task.** B's name, genes, building total, and prompt were unchanged. A's pending record stayed under A's key. This does not establish every purchase/train/destructive action variant. | 11 |
| Unrelated families and live/beta separation | Separate identities and settings scopes | **PASS.** Native status and imported family preferences followed distinct family/run IDs; old journal stayed scoped. | 01, 11, 33, 43, 44 |
| Same-family replacement run/new ascension during held task | Cancel old continuation | **PASS for a suspended dragon task.** Native Ctrl+O/Load imported a same-family run with resets one and a new seed/start date. Identity changed from 44793ea2 to f14d7115; the old task lost ownership. Verified release under native pause left the new run at dragon level zero. This does not establish every action class. | 83 |
| Hard reset while a task awaits | Old task cannot act on reset game | **PASS for a suspended clone task.** Held the fourth real recovery write after two appearance steps. Natively closed the customizer and completed both Wipe save confirmations in the backed-up disposable game. Releasing the old continuation left zero cookies/buildings and default genes [0,1,0,0,0,0,0], with no prompt. A fresh valid save reconciled to family v2-6dfa785e/run bdfd40d9 with no inherited journal. The pre-save interval still reported the old saved identity, so no instant identity-transition guarantee is claimed. | 98, 99; 40-42 cover missing-identity variant |
| Actual native ascension to heavenly screen | Real extension transition without a direct Game API substitute | **PASS.** Live C reached OnAscend 1 through the normal Ascension module. Native pause left phase shopping and original family/run markers intact. | 61, 62 |
| Heavenly-screen reload | Recover safe phase and identity | **FAIL, P2.** Verified fresh reload restored the game to play with resets zero, but the candidate became watching/waitingForSave through more than 45 ticks. Original pending-reset zero remained. | 65, 67 |
| Normal ascension history and run-only counter reset | Preserve family history, reset run counters | **PASS.** Fresh family E completed actual automated ascension/shopping/permanent assignment/reincarnation. Family v2-c13d1296 stayed the same, run changed 67afc5ab to f2944839, resets zero to one. godComplexAttempts two and clonesStyled true survived; spellsCast seven and gardenHarvests eleven reset to zero. A normal save after observed reincarnation triggered real saveWatch reconciliation. | 68, 71, 72 |
| Quarantine during suspended name journal | No cosmetic mutation; journal stays in correct scope | **PASS.** Removed scalar slots 40/41 from a real disposable raw save, retaining plausible run metadata. Identity became unknown, save untrusted, stateful module blocked. Release did not rename or alter genes. Correct family journal survived. | 12 |
| Quarantine during awaited clone restoration write | No old restoration mutation; durable evidence retained | **PASS.** Partial appearance remained unchanged after the held restoration write was released under unresolved identity. Journal retained original and owned intermediate appearances. | 55-57 |
| Restore valid raw save after quarantine | Fresh valid recovery possible | **PASS.** Known/trusted identity returned; actual original genes restored; pending zero, error empty, recovery journal removed when resolved. | 58, observations |
| Remove only site save while page stays open, then reset without normal save | Stateful automation blocked; no old-family activity | **PASS.** Save missing, reset game ready with zero buildings/cookies, identity unknown, Ascension restricted. Old-family storage fingerprint unchanged. Independent wrinkler advice was not misclassified as stateful activity. | 40, 41 |
| Save valid new identity after missing-save/reset interval | Recover without old-family writes | **PASS.** Trusted new family `v2-d50d1b75`, run `44793ea2`; old-family scope unchanged. This covers missing-identity recovery in an already open page, not a separate first-install/no-save boot. | 42 |
| Initially missing identity at a completely fresh startup | Valid save later unblocks it | **PASS.** A new document booted with only the disposable beta site save absent. Game was ready with zero buildings; identity unknown, no save found, and Clones blocked for Save identity unresolved. Writing a normal valid save produced trusted family v2-693d7b35/run 5c7f4d1a and cleared the restriction. The backed-up synthetic fixture was then restored through native Ctrl+O/Load. | 96, 97 |

### 4. Dragon panel ownership and recovery: PASS for the tested cases

Fixture: synthetic dragon level zero, crumbly egg owned, sufficient cookies and building resources. Only Dragon enabled. No train method was called to substitute for extension actions.

| Subcase | Expected | Observed / result | Evidence |
|---|---|---|---|
| Normal opening/training/closing | Complete real automation | **PASS.** Actual scheduler opened panel, trained 0 to 20 and later 26, and closed it. | 13 |
| Three-second game refresh during opening wait | Refresh does not invalidate own panel | **PASS.** Held real isolated-world 150 ms continuation for more than 10 seconds. Portrait changed through routine refresh; release trained to 26 and closed panel. Later visit also worked. | 14 |
| Trusted player close during opening wait | Old task stops | **PASS for close alone.** Trusted close left level zero after release. | observations |
| Trusted close and reopen replacement | Old task neither trains nor closes replacement | **PASS.** Native close X and real canvas egg click produced a replacement picture/panel. After release, level zero and player panel open, owner false. | 73 |
| Same trusted replacement after pausing | Old task leaves replacement intact | **PASS on October 27.** Real 150 ms opening continuation held, native Pause, verified native X closure, native egg reopening, then release. Replacement panel remained open at level zero. File 74 remains an excluded earlier invalid fixture. | 81, 82; 74 invalid fixture |
| Ctrl+O during opening wait, then native dismissal | Foreign prompt survives; later visit recovers | **PASS.** Release left Import save intact, level zero. Dismissing Import save allowed later automatic training to level 10 and panel closure. | 15, 16 |
| Repeat foreign prompt with pause/resume and replacement run | Same ownership protection on new run | **PASS for the replacement run with native Pause/Resume.** On run f14d7115, a fresh opening continuation was held. Player opened Import save, paused and resumed, then the verified isolated-world release preserved the Import prompt and dragon level zero. Settled ownership was false. | 84 |
| Replace aura prompt with player prompt | No confirmation/closure of replacement | **PASS.** Held actual 150 ms aura-picker continuation, natively cancelled the picker and opened Import save, then released. Both auras stayed zero, buildings stayed 5000, and the player Import prompt remained open. | 85 |

### 5. Garden ownership and harvesting: BLOCKED overall

Fixture: Farm level nine, 6x6 plot, active soil zero, selected seed zero, immature bakeberry `[9,49]`, mature bakeberry `[9,50]`, mature juicy queenbeet `[22,85]`. Real scheduler supplied all harvest input.

| Subcase | Expected | Observed / result | Evidence |
|---|---|---|---|
| Immature and mature plants together | Immature survives; mature plants harvested | **PASS.** Immature tile remained `[9,49]`; mature tiles became empty; actual harvest count increased by two. | 06, observations |
| Reward and no duplicate harvest | Real reward once | **PASS for JQB lump and harvest counts.** Lumps increased zero to one; emptied tiles were not harvested twice. The October 27 retry also measured the exact bakeberry reward: ordinary handler received [0,0,80], bank 11428722184995516000 and CpS 297622947525933400. Expected min(3% of bank, 1800 seconds CpS) was 342861665549865500; its single Game.Earn call matched exactly. Young bakeberry [9,1] survived. The observer forwarded the original handler unchanged. | 06, 78, observations |
| No player takeover of selection | Retain original seed/soil | **PASS.** Selected seed and soil remained zero. This is a limited restoration check. | 06, observations |
| Player replaces a plant before the next harvest tick | Do not use stale coordinates | **PASS for stale-save versus live plant.** Saved tile still described mature bakeberry plantId eight/age80. Player natively harvested that tile and planted young wheat [1,0]. After 13 real Garden ticks, wheat remained [1,18], while the other mature bakeberry was harvested once. A distinct intra-await harvest variant cannot be established because this harvest path is synchronous. | 75 |
| Player seed/soil choices before later automation | Player choices win | **PASS for trusted pre-tick changes.** Player selected seed zero and soil one through actual UI after the save snapshot; both remained after 13 Garden ticks and the real mature harvest. The requested intra-await takeover variant remains BLOCKED because the garden action path has no awaited continuation to suspend. | 75 |
| Replacement prompt and hide/reopen during awaited work | Keep foreign UI; protections survive | **PASS for hide/reopen.** Trusted Close Garden, 27.158 seconds of resumed automation with visible=false, mature bakeberry unchanged and harvest count one. Native View Garden then permitted exactly one harvest, count two, while the young plant survived. Foreign-prompt/intra-await variants remain **BLOCKED**; the harvest path has no awaited continuation. | 79, 80 |

### 6. Purchases, market, and sugar lumps: FAIL overall

| Subcase and setup | Expected | Observed / result | Evidence |
|---|---|---|---|
| Ordinary purchase handlers, synthetic low base price | Repeated single buys even when price stays the same | **PASS.** Cursor successive 0 to 1 through 4 to 5 purchases had before/after price one and bulk one. | 45 |
| Rounded displayed price appears affordable but game refuses | Avoid unchanged-state repeat clicks | **FAIL, P3.** 35 refusals over 38.353 seconds with unchanged bank/ownership. | 46, 47 |
| Add funds after refusal | Recover without reload or bulk corruption | **PASS.** One successful Cursor buy in same document, Buy mode and bulk one retained. | 48 |
| Market cheapest strong-buy full, next available | Trade available good | **PASS.** Cheapest was 91/91; next was 0/10 and actual trading filled it to 10. | 17, 18, observations |
| Early lump plan complete; 102 lumps, eligible level-one Wizard tower | Buy cost-two upgrade, retain 100 | **PASS.** Rendered and actual levels verified after reload. `nextSpend` cost two/reserve 100. Actual module raised Wizard tower to level two, balance 100. | 19, 20 |
| Another tick before autosave | No double spend below reserve | **PASS.** Subsequent normal ticks retained 100; raw save still contained 102; autosave zero. | 21 |
| Pause or replace lump confirmation prompt | No confirmation of replacement | **PASS for cancellation safety.** Held the actual transactions.until result after the real SpendLump prompt appeared. Native Pause and release left 103 lumps, Wizard level two, and the owned prompt closed. In a fresh document, native No followed by Ctrl+O replaced the spending prompt with Import save; verified release retained the player prompt, 103 lumps, and level two. A separate recovery defect is confirmed below and ranked above: the cancelled upgrade remains reserved until reload. | 86-88 |
| Resume after cancelling an unconfirmed lump upgrade | Clear cancelled reservation and allow the same eligible spend | **FAIL, P2.** Actual bank 103/level two stayed unchanged, but planner returned null through 53 scheduler runs and a fresh trusted save. Reload of the same save restored cost-three planning and actual spending to level three/balance 100. | 91, 92 |

The earlier manually assigned lump fixture had stale rendered Farm levels. Spending in that invalid setup is excluded from defect evidence. The corrected, saved-and-reloaded fixture passed.

### 7. Cosmetic durability and recovery: BLOCKED overall

| Subcase and setup | Expected | Observed / result | Evidence |
|---|---|---|---|
| Name action and journal ordering | Durable undo before rename; original restored | **PASS.** Held first durable write prevented name mutation. Subsequent normal action earned God complex and restored Native Beta B. | 11, 12, observations |
| Clone action, partial change, Pause | Exact original restoration | **PASS.** Original `[1,2,3,1,2,4,5]`; partial `[3,2,3,1,2,4,5]`. Pause and release restored original, closed owned prompt, journal null, pending zero. | 22-24 |
| Normal one-time clone completion | Earn likeness and restore original | **PASS.** In her likeness won; original genes restored, styled flag true, journal null. | 58, observations |
| Trusted player Random during held clone action | Player edit and customizer survive | **PASS.** Native Random produced `[15,8,9,2,8,7,17]`; release retained exactly those genes and player-owned customizer. | 25, 26 |
| Initial clone journal write throws | No mutation | **PASS.** Original/current equal; durable journal absent; pending data and explicit synthetic error retained. | 53, 54 |
| Failure after partial mutation | Recovery evidence survives | **PASS.** First three writes durable; fourth threw; fifth restoration callback held. Durable record included original and all owned intermediate appearances. | 55, 56 |
| Valid-save retry after quarantine | Recover safely and remove resolved journal | **PASS.** Restored original; journal null only after valid identity/recovery; pending zero/error empty. | 57, 58 |
| Reload after partial cosmetic mutation | Same safe recovery after document destruction | **PASS.** Held fourth actual journal write. Durable original [1,2,3,1,2,4,5], expected [3,2,3,1,2,4,5], and owned history were read from actual Chrome storage. Saved live partial [3,2,3,1,2,4,5], then used real Chrome Reload. The fresh document initially loaded the partial look; actual startup recovery restored exact original and closed its customizer. Journal remained until that restoration was normally saved, then an ordinary tick removed it with pending zero/error empty. | 93-95 |
| Malformed name journal missing original | Do not rename to undefined or accept malformed journal | **PASS.** Getter rejected record; native startup remained ready; name unchanged. Malformed synthetic storage preserved in evidence. | 27, 28, 30 |
| Malformed clone history / invalid genes | Reject; no mutation/setup crash | **PASS.** String history and out-of-range/negative arrays rejected; failed module list empty; current genes retained. | 27-30 |
| Legitimate prior namespace record produced with older build | Migration keeps valid journal accessible | **BLOCKED.** Older build was not installed to produce a legitimate prior record. Seeded current malformed records do not establish migration. | No completed evidence |

### 8. Destructive-action gates and cancellation: FAIL overall

| Subcase and setup | Expected | Observed / result | Evidence |
|---|---|---|---|
| Canonical live, saved hoard zero, live normal 1e25 and shiny 2e25 | Fresh export guards loans/ascent | **PASS.** Actual live export detected approximately 3e25; phase ready blocked; loans empty. | 35 |
| Canonical beta, empty live hoard | Fresh valid empty export permits progression | **FAIL, P2.** Wrong variant identity blocks verification. | 31-33 |
| Discard one decision, native Pause, Resume | Consent does not carry to later decision | **PASS.** New decision `c0b1728e:2` guarded same hoard again with no loans. | 36 |
| Player Ascend confirmation while guard active | No stale automatic confirmation | **PASS for unowned prompt protection.** Player prompt stayed open; Game.OnAscend zero, automation ownership false. | 37, observations |
| Pause/prompt replacement during an actual awaited ascension/reincarnation | Cancel old continuation and replacement run actions | **PASS for an actual awaited shopping action.** On independent live family v2-76e11ca4/run 4e239d30, held the real 250 ms permanent-picker continuation during phase shopping. Player natively cancelled that picker and clicked Reincarnate, creating a foreign Reincarnate confirmation. Verified old release left that prompt open and unowned, Game.OnAscend one, resets zero, all permanent slots minus one. No reincarnation or stale confirmation occurred. Direct Ascend/Reincarnate confirmation paths themselves have no awaited action continuation to suspend; this is the completed asynchronous transition case. | 100, 102 |
| Permanent-upgrade picker cancellation | Restore usable state/controls | **PASS for pause cancellation.** On fresh family E, held the real 250 ms picker continuation. Native Pause and release left all slots minus one, no confirmation, then owned prompt closed. Resume completed assignment and reincarnation. The October 27 native Cancel then Reincarnate sequence additionally established foreign-prompt protection during the actual awaited picker; the earlier Ctrl+O attempt had not created a prompt. | 69-72, 100, 102 |
| Pantheon drag cancellation | Clear held drag; preserve usable controls and slots/swaps | **PASS.** Held the real first 60 ms drag continuation. After a verified native toolbar pause, released it. Game dragging false, slots [-1,-1,-1], swaps three, spirit control present. No direct drag/slot API substituted for extension input. | 60 |

### 9. Accessibility, HUD families, and background tabs: BLOCKED overall

| Subcase and setup | Expected | Observed / result | Evidence |
|---|---|---|---|
| Native popup Tab/Space/Enter | Named usable controls reflecting state | **PASS.** Tab reached master Resume, Space resumed and paused, Tab/Enter opened Configure. Accessible names and states exposed. | 50, observations |
| Popup periodic status updates | Stable focus | **PASS.** Same master button remained focused across updates from 06:38:29 to 06:38:47. | 50, observations |
| HUD keyboard | Operable named controls | **PASS.** Tab reached Autoclicker, Space toggled it, Shift+Tab/Enter folded Configure; focus stayed on control. | 38 |
| Actual Chrome 200% zoom, narrow viewport | Fits and all controls reachable | **PASS for HUD.** 322x352 CSS viewport, HUD 306.5x320.5; scrolling reached final In-page HUD control after 15 native Tabs, visibly in view. Zoom restored to 100%. Separate native popup zoom/narrow-size variation remains **BLOCKED**. Zoom shortcut attempts opened Chrome Help rather than establishing popup zoom, and the incidental tab was closed. Native View showed Actual Size disabled on the game page, confirming normal page zoom. | 51, 52, 104 |
| Distinct C/D dock/fold preferences; native imports without reload | Selected family position/label/expanded state | **PASS.** C top-left/folded/aria-expanded false at 8px,40px. D bottom-center/expanded with its own clamped position. | 39, 43, 44 |
| Trusted HUD drag crosses controlled family import | Old drag cannot write new family | **PASS with instrumentation qualification.** Native drag was trusted. Fixture imported through page-world API after pointerdown and notified real saveWatch reconciliation. After release, C's position remained null and dock/fold preferences intact. Listeners were removed. Earlier family imports separately used native Ctrl+O/Load. | 49 |
| At least two background minutes | Measure actual throughput and clocks | **PASS, measurement completed.** 124.910 seconds wall, 124.9078 seconds performance clock; zero registered clicks; earned 6.503333 cookies at displayed 0.1 CpS. | 07 |
| Background status freshness | Quantify age while hidden | **PASS for measurement.** Beta was hidden for 215.503 seconds wall / 215.5001 seconds performance time. A local read-only sampler observed the candidate’s normally published latest status without requesting refresh. Thirty-two hidden samples had ages 1-1000 ms, but the visibility-end endpoint was 41285 ms old. Largest sampling gap was 59996 ms. One page ID and 32 distinct publication times were observed. This quantifies intermittent staleness; it is not a continuous-freshness guarantee or a separately diagnosed application defect. | 101 |
| Pause around background testing | No new automated activity while paused | **PASS for observed pause count.** Registered clicks remained 856 after native pause. No minimum background click rate is asserted. | observations |

The measured background passive rate was approximately 0.05206 cookies/s, about 52.1% of the displayed nominal 0.1 CpS. Visibility-event endpoints captured the hidden interval before foreground automation could contaminate it. File 05 is a coarse earlier measurement and is superseded by file 07 for quantitative conclusions.

## Injection methods and scope

All console entry used real Chrome DevTools. The page console's `Game` object prepared disposable fixtures. The Alakazam execution context was separately selected for extension instrumentation; `Game` was undefined there. The page context did not expose `Alakazam`.

**Old settings read:** In the isolated world, temporarily wrap `chrome.storage.local.get`. For the next `keys === null` read, let the original backend capture its data but hold invocation of the caller's callback. Start the candidate's real storage reconciliation, make a newer pause through the actual popup, then invoke the held callback. Restore the original get function. This tests a real older snapshot without substituting a fabricated settings response.

**Popup write failure:** Inspect the actual open toolbar popup and wrap its `chrome.storage.local.set` with a switch that throws `Error('synthetic persistence failure')` before calling the bound original. Toggle In-page HUD through the native popup. Keep the popup open while successful status polls occur. Turn off injection and use the native Refresh status control. Read durable storage to confirm retry. Destroying and reopening the popup also removes its temporary wrapper.

**Cosmetic write holds/failures:** In the isolated content-script context, wrap the bound native storage set. Match recovery keys ending in `:bakeryNameRecovery` or `:cloneRecovery`. Hold the entire original backend call/callback at a selected write, or throw the named synthetic error before forwarding. Forward other keys normally. First clone writes one through three succeeded; write four failed or was held depending on the test. The partial-failure variant held write five, the restoration write. Releases forwarded the real original write, preserving actual Chrome storage events and candidate flush handling. No direct cosmetic action method replaced the scheduler.

**Untrusted raw layout:** Keep the valid synthetic raw save only in a page variable. Decode its own serialized sections, remove scalar slots 40 and 41, re-encode, and replace only that disposable site's raw save. The tested current game had 56 scalar slots, reduced to 54. Leave family/run metadata plausible. Let normal saveWatch reconcile before releasing the held task. Restore the valid raw save to test fresh recovery. Raw export strings are not included in this report.

**Dragon opening hold:** Temporarily wrap isolated-world `setTimeout`; hold the first 150 ms callback used by the actual dragon opening action. Observe the live panel and native player takeover before releasing the original callback. Restore the original timer. This does not call a train method.

**Hard-reset interval:** Temporarily hold ordinary page-world save writes, allowing export reads. Remove only the disposable beta save. Complete actual game Wipe save confirmation after action-time approval. Observe unresolved identity and old-scope fingerprint, then restore the original save method and write a valid new disposable save. No reset method was used to bypass UI confirmation.

**HUD drag/import crossing:** A test-only page listener imported a prepared synthetic save following real trusted pointerdown; a corresponding event let the actual isolated saveWatch reconcile while the pointer was still held. Native release then exercised the old drag. Both fixture listeners were removed. This specifically controlled drag/import timing; it is not represented as a manually completed Import dialog during the held pointer.

Temporary wrappers were local instrumentation in real Chrome console contexts. Reload destroyed the partial-clone storage hold. Dragon/permanent timers and lump transaction wrappers were restored after their controlled releases. The hidden-status interval and visibility listener were removed. No candidate source file was changed. A timer-wrapper recursion from an earlier retry and console queries sent to the wrong execution world are test-instrumentation errors, excluded from application findings. File 83 proves same-family cancellation after the later verified release; file 84 independently establishes the foreign-prompt repeat. File 89 failed to establish a prolonged stall; files 91-92 subsequently confirmed the lump defect with reliable observations.

## Evidence, limitations, and final state

Expected synthetic storage exceptions and persistence messages are retained in files 04 and 53-56. Page observations also included advertising/Cloudflare DNS failures, report-only Content Security Policy messages, and a Canvas2D performance warning. These were not attributed to an Alakazam defect. Malformed-journal testing reported no failed modules. This is not a claim that every console line in every session was exhaustively captured.

Screenshots are original Chrome captures. Early files 01-03 were renamed from .png to .jpg to match their JPEG bytes. No recordings were made. Text evidence consists of native accessibility-tree console captures and sometimes includes older incidental messages. File 09 is contextual only, file 34 is an intermediate reset confirmation, and file 63 is provisional pre-reload evidence. The valid clean reload failure is established by 65/67. File 74 is an invalid player-click fixture. File 76 did not establish an exact reward; file 78 now does.

Native control repeatedly failed with noWindowsAvailable, timeoutReached, ScreenCaptureKit stream errors, or lost focus. Rebinding Chrome, reopening the console, and selecting the window sometimes restored input. An attempted command was never treated as execution without an observable result. The existing disposable profile was used throughout. On October 27, native input recovered long enough to complete the dragon repeats, reward measurement, garden hide/reopen, lump confirmations, cosmetic reload, missing-save startup, held-task hard reset, hidden-status series, and shopping prompt replacement described above.

Remaining limitations are explicit in the matrix:

- The optional legitimate prior-build namespace migration was not executed. An older build was not installed to generate a real old journal; manually seeded current records do not establish that migration.
- Native popup zoom/narrow-size variation was not established. The actual HUD at 200% zoom passed. Popup shortcut attempts opened Help, which was closed, and normal game page zoom was verified in the native View menu.
- Garden harvest and seed restoration are synchronous, so no intra-await garden takeover fixture exists in this candidate. Native pre-tick plant/seed/soil takeover and hide/reopen passed; an intra-await foreign-prompt result is not claimed.
- Held-task replacement and destructive checks cover the action classes and boundaries explicitly identified in each row, not every theoretical interleaving of every module.

The final native toolbar checkpoint in file 105 shows Paused, Resume automation, version 1.3.3, selected live family v2-76e11ca4/run 4e239d30, with fresh status. This supersedes earlier checkpoints 64, 77, 90, and 103. The player Reincarnate confirmation was dismissed with native No after its protection was verified. The live test game remains on the heavenly screen and the beta tab contains the reset synthetic game. All automation is paused. Candidate checkout and test profile remain intact; the user's deletion clarification referred only to removing the location reference from this report.

The complete suite is not approved because four defects were reproduced and the stated variants remain unverified. No source changes, commits, pushes, merges, remote comments, downloads, or profile deletion were made.
