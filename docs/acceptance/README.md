# Native acceptance follow-up

[The supplied Chrome report](native-chrome-1.3.3.md) preserves the supplied results, with only the local checkout path omitted. It
tested Alakazam `a641d1f1b7d5d3923519405344317d9fb0cdf819` on Chrome 155 / macOS.
Its numbered evidence files, screenshots, evidence index, and observations were
not included in the attachment. Relative links inside that historical report
refer to the original tester's evidence directory, not files in this repository.

The report established native toolbar lifecycle and canonical live/beta host
permissions for that candidate. Its overall result was not approval: four
reproduced defects required correction. Follow-up validation must name the
revision it tests and must not rewrite the historical results as passing.

The four corrections belong to PR #14, targeting PR #13's integration branch:

| Finding | Required correction |
| --- | --- |
| Beta export identity | Derive export identity using the current storage variant without accepting a different run. |
| Heavenly-screen reload | Recover an interrupted sequence without defeating the completed-reset anti-echo guard. |
| Cancelled lump confirmation | Separate an observed spend from an unconfirmed cancellation or unreadable outcome. |
| Rounded-price refusal | Suppress unchanged-state retries and permit recovery when observable purchase state changes. |

The report's limitations remain distinct from these defects. Garden harvesting
and seed restoration are synchronous, so an intra-await garden fixture is not
applicable to that path. A legitimate prior-build journal migration and native
popup zoom/narrow-size variation were not exercised. Existing migration and
layout tests supply narrower automated evidence; they do not retroactively
establish those native variants. Background measurements also do not promise
continuous freshness or a minimum hidden-tab click rate.

See [testing instructions](../TESTING.md) for reproducible automated checks.

The subsequent integrated review also corrected store-control restoration behind
a foreign prompt, durable gift-code capture on cancellation, and cosmetic
recovery verification after same-document text and file imports. These are follow-up fixes,
not changes to the historical native results.

The final combined review also found that a second game tab could retire an
active cosmetic undo journal. Journal claims and writes now pass through the
extension worker and belong to a browser document. The added `webNavigation`
permission lets the worker check document liveness without treating a frozen
tab as expired; a reload preserves the handoff to the original game tab.
Versioned namespace announcements release that reservation once a replacement
document confirms a different save, including a stable-to-beta switch. Unknown
or initializing replacements keep the reservation; popup settings loads do not
participate in the game-document protocol.
Installed-extension regressions exercise two tabs sharing real Chrome storage,
followed by a reload or beta navigation during the temporary name or appearance change. These
checks use the pinned local game mirror, not a new native macOS acceptance run.
