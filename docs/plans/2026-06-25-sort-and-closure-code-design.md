# List Sort + Closure Code — Design

**Date:** 2026-06-25
**Target version:** 2.11
**Status:** Design validated (rev 2 — post-review), ready for implementation plan

> **Rev 2 (post-review):** Fixed two blockers — `created` key had no source data (B1), and timestamp/id/state comparators would `NaN` on display-value objects (B2). Added field-fetch change to Files-touched; restricted closure fallback to verified values (R1); flagged sys_choice query as implementation-time validation (R2); noted value-reset edge case (R3) and startup-view change (P1).

---

## Summary

Two features requested by users after 2.10:

1. **List sorting** — let the user choose how list results are sorted (Case ID, Priority, Stale days, Last updated, Created, State) with an Ascending/Descending toggle, instead of the hardcoded priority→stale order. New default: Case ID descending (new on top).
2. **Closure code** — make the alarm-close `u_status_reason` field user-selectable instead of hardcoded to `"Alarm(s) Cleared on Access"`. Options fetched dynamically from `sys_choice` (same pattern as Work Note Types in v2.2).

Both features touch only the List tab / alarm-close surfaces. No new permissions, no new files.

---

## Scope decisions (confirmed)

| Decision | Choice |
|----------|--------|
| Sort keys | Standard set: id, priority, stale, updated, created, state |
| Sort UX | Two controls: Key select + Direction select (independent) |
| Direction labels | Plain "Ascending / Descending" (not dynamic per key) |
| Default sort | Case ID + Descending (new on top) |
| Sort scope | List tab only (Query tab adopts later) |
| Closure field | `u_status_reason` (the field the chain already writes) |
| Closure options source | Dynamic from `sys_choice` + hardcoded fallback |
| Closure default | "Alarm(s) Cleared on Access" (unchanged behavior) |

---

## Feature 1 — List Sort

### UI layout

Two new selects added to the List tab toolbar in `panel.html`, in a new `.row-2` after the Filter/Limit row:

```
[Filter ▾]          [Limit 50]
[Sort: Case ID ▾]   [Order: Descending ▾]
[Search]
```

**`<select id="list-sort-key">`** options:
- `id` — Case ID
- `priority` — Priority
- `stale` — Stale days
- `updated` — Last updated
- `created` — Created
- `state` — State

**`<select id="list-sort-dir">`** options:
- `asc` — Ascending
- `desc` — Descending

Fully independent — every combination is legal. No disabled options.

### Defaults & persistence

- Default selected: **key=`id`, dir=`desc`** (new on top).
- Both selections persist in `localStorage` under `snow_list_sort_key` / `snow_list_sort_dir`. (Document-scoped localStorage, not `chrome.storage` — no permission change, consistent with MV3 sidebar.)
- Panel init restores saved selections; change handler writes them back.

### Comparator

A single `compareTickets(a, b, key, dir)` helper replaces the hardcoded sort block at `panel.js:1103-1110`. Sign multiplier `mult = dir === 'desc' ? -1 : 1` applied to every branch.

**All field access goes through `displayVal()` and existing helpers** — the List query uses `sysparm_display_value=all` (`background.js:258`), so every non-number field arrives as `{value, display_value}`. Raw `Date.parse(fieldObj)` is `NaN`; this was review blocker B2.

| Key | Compare by | Tiebreak |
|-----|-----------|----------|
| `id` | numeric suffix via `displayVal(number).match(/(\d+)$/)` | none |
| `priority` | `parsePriority()` (existing, `panel.js:275` — already `displayVal()`-safe) | stale desc |
| `stale` | `staleDays(sys_updated_on)` (existing, `panel.js:268` — uses `parseUpdatedOn`) | priority asc |
| `updated` | `parseUpdatedOn(sys_updated_on)` (existing, `panel.js:229`) | id desc |
| `created` | `parseUpdatedOn(sys_created_on)` (same helper — works on any timestamp field) | id desc |
| `state` | numeric `displayVal(state)` parsed as int | priority asc |

Timestamps: `parseUpdatedOn()` already handles the `{value, display_value}` object → ISO display string → `Date` → `null`-on-failure path. Comparators treat `null` as 0 (sorts to one end, stable). No new date parsing code.

Wired into the `btn-list` click handler (`panel.js:1100`):

```javascript
const key = document.getElementById("list-sort-key").value;
const dir = document.getElementById("list-sort-dir").value;
tickets.sort((a, b) => compareTickets(a, b, key, dir));
```

### Field fetch change (review blocker B1)

The `created` key sorts on `sys_created_on`, but `listTicketsInPage`'s default field set (`background.js:259`) omits it, and `btn-list` passes no `fields` override. Without this change, `created` arrives `undefined` and sorts no-op.

**Fix:** append `sys_created_on` to the default field string in `background.js:259`:

```javascript
params.set("sysparm_fields", fields || "number,short_description,description,state,priority,assigned_to,sys_updated_on,sys_created_on,contact_type,cmdb_ci");
```

One extra field on an already-returned record — no extra round-trip, negligible payload cost. Every existing reader ignores unknown fields, so nothing else changes.

### Test impact

`tests/sort-verify.js` is **self-contained** — it redefines `displayVal`, `parsePriority`, `sblSeverityRank`, `staleDays` locally (lines 2-25) and inlines the priority-first sort (lines 69-73) rather than importing from `panel.js`. Current size: 7 `parsePriority` cases + 8 `sblSeverityRank` cases + 2 integration sorts ≈ 17 checks.

Implications for this feature:
- To test `compareTickets`, add a **local copy** of it to the test file (mirroring the existing local-helper pattern) — the harness can't reach `panel.js` directly.
- **Leave the priority-first integration sort (lines 69-73) untouched.** It uses its own inline sort and is independent of `panel.js`; refactoring it to call `compareTickets` would risk a passing test for no benefit. The new `compareTickets` cases (including a `priority asc` case) cover the same behavior separately.
- Add new cases: each of the 6 keys × 2 directions, with crafted ticket objects (use `{value, display_value}` shapes to exercise the B2 fix).
- Existing assertions stay green — they don't touch the code being changed.

---

## Feature 2 — Closure Code

### Data fetch (background.js)

Clone of the `getNoteTypes` pattern (`background.js:235` / `panel.js:178`):

```javascript
function getStatusReasonsInPage() {
  return snowFetch("GET", "/api/now/table/sys_choice?sysparm_query=element=u_status_reason^nameINincident,task^inactive=false&sysparm_fields=label,value,sequence&sysparm_display_value=all&sysparm_limit=200")
    // ...same flatten transform as getNoteTypesInPage → [{label, value}]
}
```

New message handler `if (msg.action === "getStatusReasons")` returns the list.

`nameINincident,task` scope matches the note-types query — `u_status_reason` choices are defined at task level and inherited by incident.

### Storage + builder (panel.js)

Parallel to `NOTE_TYPE_VALUES`:

```javascript
var STATUS_REASON_VALUES = null;

function loadStatusReasons() {
  send({ action: "getStatusReasons" }).then(function(reasons) {
    if (reasons && reasons.length > 0) {
      STATUS_REASON_VALUES = reasons;
      // Repopulate every closure-code select (inline forms already open + Action tab)
      document.querySelectorAll(".alarm-reason-select, #alarm-reason").forEach(function(sel) {
        var cur = sel.value;
        sel.innerHTML = buildStatusReasonOptions(cur || "Alarm(s) Cleared on Access");
      });
    }
  }).catch(function() { /* keep fallback */ });
}

function buildStatusReasonOptions(selectedValue) {
  // R1: only the one verified value is in the fallback. Other reasons come from
  // the dynamic sys_choice fetch; we don't invent close-reason strings that SNOW
  // might reject. If the fetch is degraded, the user gets the single safe value —
  // custom/other reasons are only available once the dynamic list loads.
  var FALLBACK = [ "Alarm(s) Cleared on Access" ];
  // Same shape as buildNoteTypeOptions: STATUS_REASON_VALUES if loaded, else FALLBACK
  // ...
```

Fallback list is **minimal** — just the one verified value (`"Alarm(s) Cleared on Access"`) — so a degraded fetch never offers a string SNOW might reject on write. See R1. Default selected = `"Alarm(s) Cleared on Access"`.

Fires at panel init alongside `loadNoteTypes()` (`panel.js:1437`).

### Race handling

`buildStatusReasonOptions()` returns the **fallback list immediately**, so a select is never empty. When `loadStatusReasons()` resolves it repopulates every `select` with class `.alarm-reason-select` + the Action-tab `#alarm-reason`, preserving each select's current value. Same pattern `loadNoteTypes()` already uses (`panel.js:184-188`). No observable race.

### Close chain change (background.js:789-796)

Replace the hardcoded string with a passed-through value plus fallback:

```javascript
if (targetState === "6" || targetState === "7") {
  fields.u_status_reason = msg.statusReason || "Alarm(s) Cleared on Access";
}
```

The `||` fallback keeps old callers (and any future code omitting `statusReason`) working identically.

### UI — Inline form (panel.js:858-895)

Insert a Closure Code block after Note Template, before Close Note:

```javascript
+ '<div style="margin-bottom:4px"><label>Closure Code</label>'
+ '<select class="alarm-reason-select" data-form="' + formId + '">'
+   buildStatusReasonOptions("Alarm(s) Cleared on Access")
+ '</select></div>'
```

Read at submit time in the `alarm-close-exec` handler (`panel.js:897`):

```javascript
const reasonSel = form.querySelector(".alarm-reason-select");
const statusReason = reasonSel ? reasonSel.value : "";
send({ action: "alarmClose", ticketNumber: ticket, note, effortMinutes, statusReason })
```

### UI — Action tab (panel.html:506-538)

New `<div class="form-group">` between Note Template (line 519) and Close Note (line 520):

```html
<div class="form-group">
  <label>Closure Code</label>
  <select id="alarm-reason"></select>
</div>
```

Populated at panel init. Read in the `btn-alarm-close` handler (`panel.js:1292`) and passed in the `alarmClose` message.

---

## Files touched

| File | Change |
|------|--------|
| `chrome-extension/panel.html` | +Sort key/dir selects (List toolbar); +Closure Code select (Action tab alarm-close-group) |
| `chrome-extension/panel.js` | `compareTickets()` helper + wire-in; sort persistence; `loadStatusReasons()` + `buildStatusReasonOptions()` + init call; read closure code in both alarm-close submit paths |
| `chrome-extension/background.js` | `getStatusReasonsInPage()` + handler; `u_status_reason` from `msg.statusReason` with fallback; **append `sys_created_on` to default list fields** (B1) |
| `tests/sort-verify.js` | New cases for 6 keys × 2 directions, added alongside the existing priority-first integration test (which stays as-is). |

No new files. No new permissions. No manifest change.

---

## Risks & open items (from review)

**R1 — Closure fallback values are speculative.** Only `"Alarm(s) Cleared on Access"` is a verified `u_status_reason` value (today's hardcoded one). The other fallback entries are invented; if the dynamic fetch fails and a user picks one, the chain writes an arbitrary string to `u_status_reason` and SNOW may reject the close step or store junk. **Mitigation:** keep the fallback list minimal — the single verified value only. Custom/other reasons are available solely via the dynamic list once it loads (a `<select>` can't accept typed input, so there is no manual-entry fallback without adding a companion text field, which is out of scope). The dynamic list is authoritative; fallback is best-effort.

**R2 — `element=u_status_reason` and `nameINincident,task` are unverified.** The note-types query is confirmed for `u_wn_type`; the status-reason equivalent is inferred. If the element name or inheritance scope is wrong, the dropdown silently degrades to fallback (R1's masking makes the failure invisible). **Implementation-time validation:** before relying on it, run the `sys_choice` query manually against the instance and confirm it returns `u_status_reason` rows. If it doesn't, adjust the `element=` value or the `name=` scope. This is a go/no-go gate for the dynamic fetch; the fallback keeps the feature working either way.

**R3 — Value not preserved across fallback→dynamic swap.** `loadStatusReasons()` reads `sel.value`, rebuilds options, restores. If the user picked a fallback-only value before dynamic load resolved, that value is absent from the new list and the select silently resets to the first dynamic option. Benign in practice (the window is one startup fetch; default is the verified value which exists in both lists), but worth a one-line code comment so it isn't "fixed" by accident later.

**P1 — Startup triage view changes (intended, not a defect).** List auto-loads `my-open` on startup (`panel.js:1443`). Today that surfaces P1/stalest first; with the new default (Case ID desc) it surfaces newest-by-ID. This is the requested behavior, but it removes the at-a-glance triage signal on first paint. Persistence means it only affects users until they pick once. **Action:** call this out explicitly in the v2.11 changelog under a "Changed" heading so existing users aren't surprised.

---

## Out of scope

- Sort control on Query tab (separate render path; adopt later).
- `close_code` (standard SNOW field) — not currently written by the chain; out of scope.
- Sort persistence per-preset (one global sort setting, not per-filter).
