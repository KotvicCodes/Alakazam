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
