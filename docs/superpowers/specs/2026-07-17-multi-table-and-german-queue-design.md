# Design: Multi-Table List + German Non-Standard Queue

**Date:** 2026-07-17
**Status:** Approved (pending spec review)
**Target release:** v2.12

## Problem

Two limitations of today's List tab, both reported by the user:

1. **Only INC tickets show.** The List tab is permanently bound to the `incident` table via a hardcoded hidden input (`panel.html:474` — `<input id="list-table" type="hidden" value="incident">`). The user's work also involves CHG (change) and PRB (problem) tickets, which are invisible in the sidebar today even though the codebase already knows about them (`TABLE_MAP` in `note-fields.js:16`, `TABLE_STATES` in `panel.js:43`).

2. **No "pull from queue" workflow for the German Non-Standard Support team.** Tickets first land in a shared queue (assignment group sys_id `9ed0c8781b4b3954ee7b1131b24bcb9d`, all unassigned). Engineers pull them out one at a time. The user wants to see this queue in the sidebar and claim tickets from it with one click.

## Goal

1. Show CHG and PRB alongside INC in the List tab — a merged, sortable multi-table view.
2. Add the German Non-Standard Support queue as a new option in the existing Filter dropdown, with a one-click Take action on each queue card.

## Non-Goals (Out of Scope)

- Bulk "Take All" — per-ticket only (matches the existing Infinity-queue decision).
- Configurable queue definitions or group sys_ids — the German queue is hardcoded (user's explicit choice; matches the `infinity-alarms` precedent).
- Configurable table selection in the UI — "all presets try all 3 tables" was chosen; no per-table checkboxes.
- Changes to the Note / Action / Query tabs — they already support non-incident tables via `detectTable` and `getStateConfig`.
- Auto-refresh after Take — matches existing Infinity-queue behavior; user clicks Search again.

## Design Decisions (from brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| My Tickets merge model | **Merged multi-table view** (fan-out to incident + change_request + problem in parallel, then concatenate + sort) | User wants everything at once; downstream rendering already handles all 3 tables |
| Which presets merge | **All presets try all 3 tables** | Simplest rule; incident-specific presets (alarms) just return empty for the other tables |
| Queue query encoding | **Hardcode the exact UNION query** as a single well-named, well-commented constant | User's explicit choice; only their team uses this queue; matches `infinity-alarms` precedent |
| Take action semantics | **Assign to me + set work-started state per table** | Matches today's Infinity-queue UX; each table's "work started" state differs (incident 2, problem 102, change_request -1) |
| UI structure for the switch | **Flatten into the existing Filter dropdown** (add `german-ns` as a 7th option) | User chose this; mirrors the existing `infinity-alarms` preset pattern (own table/query/mode flag) |
| Authoritative table for rendering | **Prefer `sys_class_name` from the API**, fall back to `detectTable(number)` | Number-prefix guessing is wrong for the queue (`change_task` records have varied prefixes; `detectTable` doesn't know `TASK`) |

## Architecture

The feature reuses the extension's three-layer flow: `panel.js` (UI) → `background.js` (orchestration) → injected `snowFetch()` in the ServiceNow page's MAIN world. No new files, no new message types — the changes extend existing handlers.

```
My Tickets mode:
  panel.js btn-list
    └─ Promise.allSettled over [incident, change_request, problem]
         └─ send({action:"listTickets", table, query, limit, includeCi})  ×3
              └─ background.js listTickets → listTicketsInPage → snowFetch
    └─ merge + dedup-by-CI + sort + render

Queue mode (german-ns):
  panel.js btn-list
    └─ send({action:"listTickets", table:"task", query:GERMAN_NS_QUEUE_QUERY, ...})
         └─ background.js listTickets → listTicketsInPage → snowFetch
    └─ sort + render (each card: Take link, sys_class_name-driven state badge)
```

The `task` base table accepts a UNION query (SNOW `NQ` separator) and returns mixed-`sys_class_name` records in a single response — that's why the queue is one call, while My Tickets is three (each preset is a *separate* query applied to multiple tables).

## Section 1 — Merged Multi-Table Query (My Tickets)

**Behavior.** When any non-queue preset is selected and Search is clicked, the sidebar issues 3 parallel `listTickets` calls — one each against `incident`, `change_request`, `problem` — using the same encoded query string. Results are concatenated, sorted by the user's chosen sort key/direction, and rendered as today.

**Cheap because:**
- `listTickets` already exists and is table-parameterized (`background.js:754`, `listTicketsInPage` at `background.js:290`). We just call it 3× via `Promise.allSettled` instead of once via `Promise.all`.
- CI-bulk-fetch enrichment runs once after the merge (dedup by `cmdb_ci` sys_id — already what the background code does at `background.js:757-775`). Pass the merged array through a single enrichment pass.
- Field rendering already handles all 3 tables via `getStateConfig` / `TABLE_STATES` (`panel.js:170`).

**Per-table query caveats (accepted, not special-cased):**
- Generic presets (`my-open`, `my-updated`, `my-resolved`, `awaiting`) are field-based and apply to all 3 tables.
- Incident-specific presets (`my-open-alarms`, `infinity-alarms`) return empty for CHG/PRB — accepted per the user's "all presets try all 3 tables" choice.
- `my-resolved` uses incident state numbering (`state=7^resolved_on...`); returns empty on `change_request`/`problem` (different state model). Accepted.

**Code changes:**
- `panel.js:1193` (`btn-list` handler): replace the single `send({action:"listTickets", ...})` with a parallel fan-out over `["incident", "change_request", "problem"]` when in My Tickets mode. Merge with `Promise.allSettled`; surface failures per Section 5a.
- `background.js:290` (`listTicketsInPage`): add `sys_class_name` to `sysparm_fields` (one-line change). The renderer uses it as the authoritative table source (Section 3a).
- The hidden `#list-table` input is no longer consulted in My Tickets mode (the fan-out drives the tables). It is reused for queue mode (Section 2).

## Section 2 — German Non-Standard Queue

**Behavior.** When `german-ns` is selected in the Filter dropdown, Search issues a single `listTickets` call against the `task` base table with the hardcoded UNION query.

**The hardcoded query** (group sys_id `9ed0c8781b4b3954ee7b1131b24bcb9d`, decoded from the user's `task_list.do` URL):

```
assignment_group=9ed0c8781b4b3954ee7b1131b24bcb9d^active=true^assigned_toISEMPTY^parentISEMPTY^sys_class_name!=u_ebonding_stage^sys_class_name!=u_ebonding_messages
NQassignment_group=9ed0c8781b4b3954ee7b1131b24bcb9d^active=true^sys_class_name=change_task^assigned_toISEMPTY
NQassignment_group=9ed0c8781b4b3954ee7b1131b24bcb9d^active=true^numberSTARTSWITHPRB^ORnumberSTARTSWITHTASK^assigned_toISEMPTY
```

Stored as a single constant `GERMAN_NS_QUEUE_QUERY` in `panel.js`, alongside the existing `PRESETS`. The constant's comment block decodes each clause (matching the codebase's existing pattern — see the `infinity-alarms` comment at `panel.js:1160-1172`):

```js
/**
 * German Non-Standard Support queue.
 * Source: task_list.do URL provided by user (2026-07-17).
 * UNION of 3 sub-queries on the `task` base table (group sys_id 9ed0c8781b4b3954ee7b1131b24bcb9d):
 *   1. group tasks, excluding ebonding stage/messages tables
 *   2. change_task records in the group
 *   3. PRB- or TASK-numbered records in the group
 * All sub-queries require active=true and assigned_toISEMPTY (unassigned).
 */
const GERMAN_NS_QUEUE_QUERY =
  "assignment_group=9ed0c8781b4b3954ee7b1131b24bcb9d^active=true^assigned_toISEMPTY^parentISEMPTY^sys_class_name!=u_ebonding_stage^sys_class_name!=u_ebonding_messages" +
  "NQassignment_group=9ed0c8781b4b3954ee7b1131b24bcb9d^active=true^sys_class_name=change_task^assigned_toISEMPTY" +
  "NQassignment_group=9ed0c8781b4b3954ee7b1131b24bcb9d^active=true^numberSTARTSWITHPRB^ORnumberSTARTSWITHTASK^assigned_toISEMPTY";
```

**Code path differences from My Tickets mode:**
- **Query table:** `task` (the SNOW base table — hardcoded for this preset) instead of fan-out. Note this is the *query* target only; each returned record carries its own `sys_class_name` (`task`, `change_task`, `problem`, etc.), which is what drives per-card rendering and Take semantics (Section 3a/4b). Do not confuse the query table with the per-record class.
- **Query string:** `GERMAN_NS_QUEUE_QUERY` instead of `PRESETS[preset]`.
- **Take link:** shown on every queue card via a `germanMode` flag (mirrors `infinityMode`).
- **Trailing `^EQ` not needed** — the user's URL doesn't have it, and the `^EQ` quirk is specific to the `infinity-alarms` preset's dot-walk+ISEMPTY combo on this instance. If the empty `assigned_toISEMPTY` clauses don't filter correctly in testing, `^EQ` is the first knob to try (documented inline).

**New `<option>`** added to the Filter `<select>` in `panel.html:439-446`:
```html
<option value="german-ns">German Non-Standard Queue</option>
```

**Wire-up** in the existing `list-preset` change handler (`panel.js:1186-1191`): when `german-ns` is selected, set the hidden query/table inputs to the queue values and set `germanMode = true` (analogous to today's `infinityMode`). When any other preset is selected, clear `germanMode` and restore the normal My Tickets flow.

## Section 3 — Rendering Queue Cards (Mixed Record Types)

The queue returns a mix of `task`, `change_task`, and `problem` records. Three rendering fixes:

**3a. Use `sys_class_name` as the authoritative table.**

Today `panel.js:1217` calls `detectTable(displayVal(t.number))` — a prefix guesser. Wrong for the queue: a `TASK`-prefixed record could be `task` or `change_task`, and `detectTable` maps `TAS`→`task` but doesn't know `TASK` at all (defaults to `incident` — silently wrong). Change:

```js
// panel.js:1217 (and anywhere else lTable is derived for a card)
const lTable = (t.sys_class_name && t.sys_class_name.value) || detectTable(displayVal(t.number));
```

`sys_class_name` is added to `sysparm_fields` in Section 1's change.

**3b. Add `change_task` to `TABLE_STATES`.**

`TABLE_STATES` (`panel.js:43-168`) has `task` (lines 138-152) but **not** `change_task`. Without it, `getStateConfig("change_task")` falls back to `incident` (`panel.js:171`) — wrong labels and wrong alarm-close behavior. Add `change_task` mirroring `task`'s structure (change tasks use the task-style state model on this instance). If observed data during implementation shows `change_task` uses different state values, refine from that data; the `task` copy is a safe default.

**3c. Card chrome.**

Each queue card shows: number (deep link), state badge (per-table via `getStateConfig(lTable)`), description, priority, assigned to (empty — unassigned queue), updated. The Take link appears on every queue card (Section 4). No alarm-close (these aren't alarms). No Remote Access CI block unless the record has a `cmdb_ci` (most change tasks won't). Existing render code already handles missing `_ci` gracefully (`panel.js:1239-1241`).

## Section 4 — Take Action (Per-Table State)

**4a. Per-table "work started" state via `TABLE_STATES`.**

Add a `workStartState` field to each `TABLE_STATES` entry:

| Table | workStartState | Label |
|---|---|---|
| `incident` | `"2"` | In Progress |
| `change_request` | `"-1"` | Implement |
| `problem` | `"102"` | Assess |
| `task` | `"2"` | Work in Progress |
| `change_task` | `"2"` (same as task, verified at impl) | Work in Progress |
| `sc_req_item` | `"2"` | Work in Progress |
| `sc_request` | (no work-started state — not reachable from Take) | — |

`takeTicket` reads `TABLE_STATES[table].workStartState` instead of the hardcoded `"2"`. Falls back to `"2"` if a table is somehow missing the field.

**4b. `takeTicket` needs the table.**

Today `takeTicket` receives `{ticketNumber}` and the background derives the table via `detectTable` (`background.js:737` area). For the queue we need the authoritative table (Section 3a's concern). Pass `table` from the panel — the panel already knows `lTable` for each card (it computed it during render):

```js
send({ action: "takeTicket", ticketNumber: ticket, table: lTable })
```

Background uses `msg.table` if provided, else falls back to `detectTable(msg.ticketNumber)` for back-compat.

**4c. `takeTicket` background change (`background.js:730-748`).**

Minimal edit:
```js
const table = msg.table || detectTable(msg.ticketNumber);
// ... existing ticket + userId fetch ...
const workState = (TABLE_STATES[table] && TABLE_STATES[table].workStartState) || "2";
const result = await injectAndExec(tab.id, updateBySysIdInPage, [
  table, sysId, { assigned_to: userId, state: workState }
]);
```

**4d. Panel-side post-Take UI update.**

Today's post-Take code (`panel.js:526-552`) hardcodes the "In Progress" state-badge update for incidents (with a comment acknowledging this is incident-specific). Generalize: read `TABLE_STATES[lTable]` for the correct label and badge class. To support this, **every** Take link (Infinity and German queue alike) gets a `data-table` attribute set at render time, so the click handler has the authoritative table without re-deriving it. For Infinity cards `data-table="incident"` (no behavior change); for German queue cards `data-table` is the record's `sys_class_name`.

**4e. Scope of change.**

Net improvement to the existing Take action — today it only works correctly for incidents (Infinity queue). After this change it works for any table. The Infinity queue is unaffected (its cards are all incidents; `workStartState: "2"` matches the current hardcoded value).

## Section 5 — Edge Cases & Error Handling

**5a. API failure on one table in the merge.**

If `incident` succeeds but `change_request` 401s, the user shouldn't lose the whole list. Use `Promise.allSettled` instead of `Promise.all` — render the successful tables' tickets, and if any table failed, show a small inline warning at the top of the result list ("Some tables failed to load: change_request"). The user still sees their incidents.

**5b. 3× API calls vs. SNOW rate limits.**

My Tickets mode now does 3 parallel `listTickets` calls (was 1). At limit=50 each, worst case is 150 records returned + CI bulk fetch. Well within SNOW's per-tab rate limits (the existing Infinity queue already does multi-call patterns). No throttling logic needed. Documented as "if you see sporadic 429s, lower the Limit" — same advice that applies today.

**5c. Duplicates across tables.**

A ticket lives in exactly one table (INC in `incident`, CHG in `change_request`), so the merged list has no duplicates by construction. No dedup logic needed.

**5d. Queue returns 0 results.**

Same "No tickets found" message as today (`panel.js:1212`). Most likely cause during testing: the trailing `^EQ` quirk (Section 2). First debugging knob.

**5e. Queue Take fails.**

Existing pattern: inline error next to the Take link, link reverts to "Take", auto-clears after 4s (`panel.js:555-563`). No change needed. Common failure: user lacks assignment rights on that record class — the SNOW error message propagates as-is.

**5f. Stale data after taking a ticket.**

No auto-refresh (matches existing Infinity-queue behavior). The card shows "✓ Taken"; the taken ticket no longer matches `assigned_toISEMPTY` so it would disappear on next Search. User clicks Search again to see the updated queue.

**5g. State semantics edge case for `change_task`.**

If `change_task`'s actual state model on this instance differs from `task`'s (we're assuming they match — Section 3b), the Take action might set a state value that SNOW rejects or misinterprets. Mitigation: if the PATCH returns an error, the user sees the inline error (5e) and can use the existing Update Status action to set state manually. Verified empirically during implementation.

**5h. `my-resolved` returns empty for CHG/PRB.**

Already covered in Section 1 — accepted as part of the "all presets try all 3 tables" choice. No special handling.

## Files Changed

| File | Change |
|------|--------|
| `chrome-extension/panel.js` | Fan-out `btn-list` for My Tickets; add `GERMAN_NS_QUEUE_QUERY` + `germanMode` flag; add `german-ns` preset wiring; use `sys_class_name` for `lTable`; attach `data-table` to Take links; generalize post-Take badge update |
| `chrome-extension/panel.html` | Add `<option value="german-ns">German Non-Standard Queue</option>` to `#list-preset` |
| `chrome-extension/background.js` | Add `sys_class_name` to `sysparm_fields` in `listTicketsInPage`; accept `msg.table` in `takeTicket` and use per-table `workStartState` |
| `chrome-extension/note-fields.js` (via `TABLE_STATES` in `panel.js`) | Add `change_task` entry; add `workStartState` field to each table's config |

Note: `TABLE_STATES` lives in `panel.js` (loaded into both panel and service-worker contexts via `importScripts`), so all state-config changes are in `panel.js` — `note-fields.js` is untouched.

## Testing Plan

Manual (no automated tests in this codebase — confirmed by exploration):

1. **My Tickets — `my-open`**: confirm INC + CHG + PRB all appear in one merged, sorted list. State badges render correctly per table.
2. **My Tickets — `my-open-alarms`**: confirm INC alarms appear; CHG/PRB contribute nothing (empty, not error).
3. **My Tickets — partial failure**: simulate by revoking one table's read access; confirm other tables still render with the inline warning.
4. **Queue — `german-ns`**: confirm mixed `task`/`change_task`/`problem` records appear; state badges correct; Take link on every card.
5. **Queue — Take**: click Take on a `problem` record; confirm it's assigned to the current user and state moves to `102` (Assess). Repeat for `change_task` and `task`.
6. **Queue — 0 results**: if the queue query returns empty, try appending `^EQ` (Section 2/5d) and confirm results appear.
7. **Infinity queue regression**: confirm `infinity-alarms` still works (Take → incident In Progress); the per-table `workStartState` change must not regress incident behavior.
8. **State badge after Take**: for each table, confirm the post-Take badge label/class matches `TABLE_STATES[table]` (not hardcoded "In Progress").
