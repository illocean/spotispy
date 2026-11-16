# Spotispy audit findings — ranked blocker reconciliation

Written 2026-11-15, after the fix pass. Each finding from the source audit is
listed with a blocker rank, the file:line evidence that the fix is in place, and
the revert-check that proves the test would fail without it.

Ranking is by **what the defect costs a user**, not by subagent severity label:

- **P0 — data corruption or silent data loss.** The app's reason to exist is the
  historical record. A defect here destroys or fabricates history.
- **P1 — wrong facts shown to the user.** Nothing is destroyed, but the log or
  view asserts something untrue.
- **P2 — capability lost.** A feature silently never works, or works at reduced
  fidelity, without telling anyone.
- **P3 — cosmetic / hygiene.** No user-visible behaviour change.

The original subagent report used its own severity labels. That ranking is
**discarded** here: it was produced by a single subagent pass and never
reconciled. This document is the ranking of record.

---

## P0 — data corruption / silent loss

| # | Finding | Fixed at | Proven by |
|---|---------|----------|-----------|
| 5 | Pathfinder paging advanced by **track** count while `offset` indexes **items**. Any page containing an episode re-read its tail; a 10,000-item playlist needed >200 pages and hit the guard at offset 9975, leaving 25 items unread — while `capped:false` let the next scan diff that short list and report every unread track as **removed**. | `src/pwt/core/sources.js:456` (parsePage returns `items`), `src/pwt/core/playlists.js:203` (advance by items), `:210,216` (`capped: hitPageCap`) | Revert to `uris.length` → test fails; old code emitted 49 duplicate URIs and never completed. The `hitPageCap` flag is pinned by `tests/source-chain.test.js` ("reports capped when the page budget runs out") — revert to `capped: false` fails it |
| 9 | `lastDays` subtracted a fixed 86,400,000 ms per step. Across a DST boundary the series **skipped** a day at spring-forward (2026-03-08 vanished from the chart) and **repeated** one at fall-back (2026-11-01 counted twice). | `src/pwt/util/util.js:208` | Run in `America/New_York`: old produced `…03-07, 03-09` (missing 03-08); new is contiguous |
| 10 | `ago(0)` rendered **"20773d ago"**. `ts == null` does not catch `0`, and the scanners persist `lastSyncedAt: 0` when a scan fails. | `src/pwt/util/util.js:117` | Mutant returns `"20773d ago"` → test fails |
| 11 | Shrink-confirmation **double-counted additions**. The hold emitted `plan.added`, then kept the pre-shrink URI list so the guard could re-detect the shrink; the confirmation scan diffed against that same list and emitted the same addition again — on a later day, so `rowKey` could not dedupe. | `src/pwt/core/playlists.js:430-437,445` (`reportedAdds`) | Old code logged `added:77` on both scan 2 and scan 3; new logs it once |
| 4 | Embed reads always returned `capped: true`, **discarding** the correct `capped` that `sources.js` computes. On a build where client + Web API routes both fail, every playlist is read via embed and marked capped every scan → reseed forever, **zero track changes ever logged**. | `src/pwt/core/playlists.js:226` (`capped: entity.capped`) | `tests/embed-capped.test.js` — the parse returns `capped:false` for a complete read; reverting the caller to `true` fails the test |

## P1 — wrong facts shown

| # | Finding | Fixed at | Proven by |
|---|---------|----------|-----------|
| 7 | An unresolvable name logged **"name: Bob → "** — a rename to nothing that never happened. `diffScalars` ignores `null` but not `""`, and the row kept the old name, so nothing was visible while the log asserted a rename. `rowKey` includes the day, so it re-fired **once per day, forever**. | `src/pwt/core/profiles.js:180` (heal inside `diffProfile`, so every caller is safe) | `tests/profile-rename.test.js` — a nameless payload produces 0 rename events; removing the heal fails the test |
| 2 | An empty followers list was treated as `ok`, emitting one **"a follower left"** row per known follower. | `src/pwt/core/profiles.js:306-312` | Revert the `declared > 0` guard → `tests/logic-bugs.test.js` ("contradicts a declared total") fails; an empty list over a declared total of 5 returned `state: "ok"` |
| 6 | A playlist's **track count** was stored under `followers`, and because it filled the slot first it also suppressed the real like counter. | `src/pwt/core/playlists.js` (removed `found.total`), `:392,529` | `parse` + view level: `followers:42/likes:999`, and `likesOnly` for the honest degrade |
| 3 | `uris.length < totalLength` marked a **complete** playlist "capped". One podcast episode made 10 < 11 → capped forever → never diffed a single change. | `src/pwt/core/sources.js:211` (`truncated`), `src/pwt/core/playlists.js:80` | Revert to `uris<total` → test fails; 10 tracks + 1 episode now `truncated:false` |
| 1 | `apiPlaylist` folded `snapshot_id` into `coverHash`, so **any** playlist edit reported "cover changed" beside every track add/remove. Three sources also derived the hash three different ways, so a source switch logged a cover change on its own. | `src/pwt/core/sources.js:78` (`coverHashOf`), `:242,297,320` | `abc` before and after an edit; `xyz` only when artwork really changes; all three sources agree |
| 12 | Activity tick overwrote a resolved **name** with `""` in two places, dropping every change row about that friend to "Unknown listener". | `src/pwt/core/activity.js:142,183` | Revert the main-loop merge (`keepName`) → the "avatar AND name" test fails with `{"name":"",...}`; revert the avatar-pass merge → the "previously resolved name" test fails |

## P2 — capability lost

| # | Finding | Fixed at | Proven by |
|---|---------|----------|-----------|
| 13 | `durationsFor` claimed `seen[uri]` **before** the watch gate, so an unwatched friend listed first consumed the only record for a track. The watched friend playing the same track got `durationMs 0`, which **disables the skip heuristic** entirely. | `src/pwt/core/activity.js:333-334` (gate before claim) | Pre-fix `priorSkipped: undefined`; post-fix `true` |
| 8 | Buddylist hardcoded `isPlaying: true`. `session.apply` treats every record as a resume, so a **pause was never detected**. | `src/pwt/core/sources.js:601` | Revert to `true` → test fails |
| 14 | `popup.js` guarded Enter on `ev.target.dataset.pwtEnter`, but nothing ever wrote that attribute — so **Enter in a textarea submitted the form** instead of adding a line. | `src/pwt/util/popup.js:118` | Old guard prevents a textarea Enter; new does not |

## P3 — hygiene

| # | Finding | Fixed at | Proven by |
|---|---------|----------|-----------|
| 15 | `activityLastTick` written every tick, read nowhere. `activityHealth.at` carries the same value and is what the controller shows. | `src/pwt/core/activity.js:268-270` (removed) | Test asserts no row is written; old code writes `1794815236950` |

---

## Test-runner isolation (fixed separately)

`npm test` had no per-file isolation or timeout, so a single test file that never
settles blocked every file after it with **no output at all** — no summary, no
failure, no exit. Reproduced and fixed.

`package.json` now runs:

```
node --test --test-isolation=process --test-timeout=60000 --test-force-exit "tests/*.test.js"
```

- `--test-isolation=process` gives each file its own process, so a leaked global
  or a `setInterval` in one file cannot affect another.
- `--test-timeout=60000` bounds each individual test; a hung test is reported as
  `cancelled` and the run exits non-zero.
- `--test-force-exit` stops a file that has finished its tests but left a handle
  open from blocking the runner.

Demonstrated by re-introducing a hanging test file:

| | Old script | New script |
|---|---|---|
| Hang, file ordered first | **zero output, hangs forever** | cancelled at the timeout |
| Other files | **never ran** | all ran and passed |
| Exit code | never | `1`, with the hang named under "failing tests" |

The full suite with the leaking file present: `tests 209, pass 209, cancelled 1,
fail 0`, exit `1`, duration 76.7s (60s of it the deliberate timeout).

---

## Summary

**15 of 15 findings fixed.** Counts by rank: P0 = 5, P1 = 6, P2 = 3, P3 = 1.

Every fix now has a revert-check that makes its test fail. **Three did not when this
document was first written**, and the claim above was false until they were added:
the P0 page-cap `capped` flag, the P1 empty-followers guard, and the P1 main-loop
name merge. All three fixes were correct in source; what was missing was a test that
noticed if someone removed them. Independent verification (revert each fix, run the
suite, confirm a failure) is what caught it — reading the source was not enough.

The two corrections below were found the same way, by the reconciliation this
document required rather than by trusting the prior summaries.

## Two corrections to earlier rounds

1. **#4 (embed capped) was reported fixed in round 3 but was not.** The parse
   layer in `sources.js` was fixed; the caller at `playlists.js:226` still
   hardcoded `capped: true` and discarded the result. Found by reading the caller
   rather than trusting the earlier summary. This is the P0 defect that silently
   disables all change logging on an embed-served build.

2. **#7 (false rename) was never fixed at all.** It appeared in the original
   subagent list but was dropped from every subsequent summary, so the "15 of 15"
   claim in rounds 3 and 4 was wrong. Found by re-reading each finding against
   the current code rather than trusting the summaries.

Both were caught by the reconciliation this document required. The earlier
"15 of 15" claims rested on an unverified mapping and should not have been made.