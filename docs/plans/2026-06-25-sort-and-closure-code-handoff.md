# Handoff — List Sort + Closure Code (v2.11)

**Date:** 2026-06-25
**Branch:** `master` (2 commits ahead of `origin/master`: `13a8b67`, `815531f`)
**Status:** Design + implementation plan complete and reviewed. **No code implemented yet.** Ready to execute.

---

## What this is

Two user-requested features for the AlarmGuard Chrome extension (target v2.11):

1. **List sorting** — user-selectable sort (key + direction) on the List tab, replacing the hardcoded priority→stale order. New default: Case ID descending (new on top).
2. **Closure code** — make `u_status_reason` user-selectable on alarm-close (currently hardcoded to `"Alarm(s) Cleared on Access"`), via a dynamic `sys_choice` dropdown on both alarm-close surfaces.

## Where everything lives (read these first)

| Artifact | Path | Commit |
|----------|------|--------|
| **Design doc** | `docs/plans/2026-06-25-sort-and-closure-code-design.md` | `13a8b67` |
| **Implementation plan** | `docs/plans/2026-06-25-sort-and-closure-code-plan.md` | `815531f` |

**Read the design doc first** — it has the rationale for every decision and lists all risks (R1–R3, P1) that the plan's code comments reference. Then execute the plan task-by-task.

## What was decided (so you don't re-litigate)

- **Sort UX:** two controls — Key select (`id`/`priority`/`stale`/`updated`/`created`/`state`) + Direction select (`asc`/`desc`), independent. Plain "Ascending/Descending" labels.
- **Default sort:** Case ID + Descending. Persisted in `localStorage` (`snow_list_sort_key` / `snow_list_sort_dir`).
- **Sort scope:** List tab only this version (Query tab deferred).
- **Closure field:** `u_status_reason` (the field the close chain already writes), not standard `close_code`.
- **Closure options:** dynamic from `sys_choice` (clones the v2.2 `getNoteTypes` pattern), with a **single-value fallback** (`"Alarm(s) Cleared on Access"` — the only verified value).
- **Closure default:** `"Alarm(s) Cleared on Access"` (unchanged behavior unless user changes it).

## Critical things to know before executing

- **Task 0 is a go/no-go gate (design R2).** Before building the closure-code fetch, manually run the `sys_choice` query against the live instance and confirm it returns `u_status_reason` rows. The fallback masks a wrong query, so verify first. Details in the plan's Task 0.
- **B1 (field fetch) is Task 1.** The `created` sort key needs `sys_created_on`, which isn't in the default list fields (`background.js:259`). Add it before the comparator work.
- **B2 (display-value objects).** The List query uses `sysparm_display_value=all`, so every field arrives as `{value, display_value}`. The comparator routes all field access through `displayVal()` / `parseUpdatedOn()` / `parsePriority()` — raw `Date.parse` on the field object would `NaN`. Don't regress this.
- **The test file is self-contained.** `tests/sort-verify.js` redefines helpers locally and does NOT import `panel.js`. `compareTickets` + `cmpIdDesc` are duplicated **byte-identically** between the test (Task 4) and `panel.js` (Task 5) — only the `panel.js` preamble differs. If you edit one, edit both.
- **Task 4 is characterization tests, not red-green TDD** — they pass immediately because the helper lives in the test file. Their value is pinning behavior before the `panel.js` copy.

## Plan structure (13 tasks, 0–12)

| Task | What | Gate? |
|------|------|-------|
| 0 | Validate `sys_choice` query returns `u_status_reason` rows | **go/no-go (R2)** |
| 1 | B1 fix: add `sys_created_on` to default list fields | prereq for Task 4 |
| 2 | Sort-control HTML (List toolbar) | |
| 3 | Persist sort selection in `localStorage` | |
| 4 | Characterization tests for `compareTickets` | |
| 5 | `compareTickets` in panel.js + wire into `btn-list` | |
| 6 | `getStatusReasonsInPage` + message handler | |
| 7 | Thread `statusReason` through `alarmClose` (`||` fallback) | backward-compat |
| 8 | `loadStatusReasons` + `buildStatusReasonOptions` | |
| 9 | Closure Code dropdown — Action tab | |
| 10 | Closure Code dropdown — inline alarm-close form | |
| 11 | Manual smoke test | verification |
| 12 | CHANGELOG + version bump to 2.11 | |

Files touched: `panel.html`, `panel.js`, `background.js`, `manifest.json`, `CHANGELOG.md`, `tests/sort-verify.js`. No new files, no new permissions.

## How to execute

The plan ends with two execution options. **Recommended: Subagent-Driven Development** (stay in the executing session, dispatch a fresh subagent per task, review between tasks).

**REQUIRED SKILLS for execution:**
- `superpowers:executing-plans` — implements the plan task-by-task
- `superpowers:subagent-driven-development` — if choosing the subagent option
- `superpowers:using-git-worktrees` — if you want an isolated workspace (optional; the work is small enough to do on a branch)

**Suggested branch:** create `feat/sort-and-closure-code` off `master` before starting, since `master` is the working branch here.

## Verification at the end

- `node tests/sort-verify.js` — all cases PASS (existing + new `compareTickets` cases).
- Manual smoke test (plan Task 11): sort default + each key/direction + persistence; closure code on both surfaces writes the chosen `u_status_reason`; backward-compat (default value unchanged).

## Out of scope (don't accidentally include)

- Sort control on the Query tab.
- Standard `close_code` field.
- Per-preset sort persistence (one global sort setting).
