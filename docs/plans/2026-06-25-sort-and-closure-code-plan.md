# List Sort + Closure Code Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a user-selectable sort (key + direction, default Case ID desc) to the List tab, and make the alarm-close closure code (`u_status_reason`) user-selectable from a dynamic dropdown instead of hardcoded.

**Architecture:** Sort is a pure client-side `compareTickets()` helper replacing the hardcoded sort block, with two toolbar `<select>`s persisted in `localStorage`. Closure code clones the proven Note Types pattern (`getNoteTypes` in v2.2): a `sys_choice` fetch → `buildStatusReasonOptions()` builder → dropdown on both alarm-close surfaces, threaded through the existing `alarmClose` message with a `||` fallback so old callers are unaffected.

**Tech Stack:** Chrome Extension MV3, ServiceNow REST API, vanilla JS, standalone Node test script.

**Design doc:** `docs/plans/2026-06-25-sort-and-closure-code-design.md` (read this first — it has the rationale for every decision).

---

## Task 0: Validation gate — confirm sys_choice query returns u_status_reason rows

> This is design risk **R2**. The closure-code feature's dynamic dropdown is inert if the query is wrong, and the fallback masks the failure. Confirm before building on it. If it fails, stop and adjust the `element=` value or `name=` scope before Task 6+.

**Files:** none (manual verification)

**Step 1: Run the query against the live instance**

In a browser logged into ServiceNow, open:
```
/api/now/table/sys_choice?sysparm_query=element=u_status_reason^nameINincident,task^inactive=false&sysparm_fields=label,value,sequence&sysparm_display_value=all&sysparm_limit=200
```
(appended to the instance base URL).

**Step 2: Verify the response**

Expected: a `result` array with one or more rows whose `label.display_value` is a closure reason (e.g. "Alarm(s) Cleared on Access", "Closed - Resolved"). Confirm `"Alarm(s) Cleared on Access"` appears — it must, since the current hardcoded value writes successfully.

**Step 3: If empty/wrong, adjust the design before proceeding**

Likely adjustments if it fails:
- Try `name=incident` only (drop `task`).
- Check the real element name on the instance: query `sys_dictionary?sysparm_query=name=incident^element=u_status_reason` and read the `element` value.
- Record whatever works in the design doc (R2) and use that exact query string in Task 6.

**No commit** — this is a go/no-go check, not a code change.

---

## Task 1: B1 fix — add sys_created_on to the default list fields

> Design blocker **B1**. The `created` sort key needs this field, and it's a prerequisite for Task 4's comparator. Do it first so the field is present in all later test fixtures.

**Files:**
- Modify: `chrome-extension/background.js:259`

**Step 1: Edit the default field string**

Change line 259 from:
```javascript
params.set("sysparm_fields", fields || "number,short_description,description,state,priority,assigned_to,sys_updated_on,contact_type,cmdb_ci");
```
to:
```javascript
params.set("sysparm_fields", fields || "number,short_description,description,state,priority,assigned_to,sys_updated_on,sys_created_on,contact_type,cmdb_ci");
```

**Step 2: Commit**

```bash
git add chrome-extension/background.js
git commit -m "fix: include sys_created_on in default list fields (enables Created sort)"
```

---

## Task 2: Add sort-control HTML to the List toolbar

**Files:**
- Modify: `chrome-extension/panel.html:452` (insert after the `.row-2` closing `</div>` at line 452, before the hidden `list-query` input at line 453)

**Step 1: Insert the sort row**

Between line 452 (`</div>` closing the Filter/Limit `.row-2`) and line 453 (`<input id="list-query"...`), add:

```html
  <div class="row-2">
    <div class="form-group">
      <label>Sort</label>
      <select id="list-sort-key">
        <option value="id">Case ID</option>
        <option value="priority">Priority</option>
        <option value="stale">Stale days</option>
        <option value="updated">Last updated</option>
        <option value="created">Created</option>
        <option value="state">State</option>
      </select>
    </div>
    <div class="form-group">
      <label>Order</label>
      <select id="list-sort-dir">
        <option value="asc">Ascending</option>
        <option value="desc">Descending</option>
      </select>
    </div>
  </div>
```

**Step 2: Commit**

```bash
git add chrome-extension/panel.html
git commit -m "feat: add sort key + direction selects to List toolbar"
```

---

## Task 3: Default the sort selects to Case ID / Descending + persist

**Files:**
- Modify: `chrome-extension/panel.js` — add near the `PRESETS` block (around line 1081, after the `PRESETS` const closes) and at panel init (around line 1437, near `loadNoteTypes()`)

**Step 1: Add a `restoreListSort()` helper + change listeners**

After the `PRESETS = {...}` definition (line 1081), add:

```javascript
// Restore saved List sort selections; default = Case ID desc (new on top)
function restoreListSort() {
  const keySel = document.getElementById("list-sort-key");
  const dirSel = document.getElementById("list-sort-dir");
  if (!keySel || !dirSel) return;
  keySel.value = localStorage.getItem("snow_list_sort_key") || "id";
  dirSel.value = localStorage.getItem("snow_list_sort_dir") || "desc";
  keySel.addEventListener("change", () => localStorage.setItem("snow_list_sort_key", keySel.value));
  dirSel.addEventListener("change", () => localStorage.setItem("snow_list_sort_dir", dirSel.value));
}
```

**Step 2: Call it at panel init**

At line 1437, alongside `loadNoteTypes();`, add a call:

```javascript
// --- Load note types from SNOW ---
loadNoteTypes();
// --- Restore saved List sort selection (default: Case ID desc) ---
restoreListSort();
```

**Step 3: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: persist List sort selection in localStorage (default Case ID desc)"
```

---

## Task 4: Add characterization tests for compareTickets

> These are **characterization / reference tests**, not red-green TDD. The test file is **self-contained** — it redefines helpers locally and does not import from panel.js (see existing pattern at `tests/sort-verify.js:2-25`). So the test defines its own local `compareTickets`, which passes immediately. The value is pinning the *expected behavior* before you copy that same function into `panel.js` in Task 5 — the test copy is the reference implementation that `panel.js`'s copy must match.

**Files:**
- Modify: `tests/sort-verify.js` (add before the final `console.log("\n=== Results...` summary at line 106)

**Step 1: Add local helper copies + compareTickets tests**

Insert this block before line 106 (`console.log("\n=== Results: " + pass + " failed...`):

```javascript
// --- Local copies of helpers used by compareTickets (test is self-contained) ---
// displayVal/parsePriority/staleDays already defined above (lines 2-25).
function parseUpdatedOn(value) {
  const dv = displayVal(value);
  if (!dv) return null;
  const d = new Date(dv);
  return isNaN(d.getTime()) ? null : d;
}
function compareTickets(a, b, key, dir) {
  const mult = dir === "desc" ? -1 : 1;
  if (key === "id") {
    const ma = (displayVal(a.number) || "").match(/(\d+)$/);
    const mb = (displayVal(b.number) || "").match(/(\d+)$/);
    const na = ma ? parseInt(ma[1], 10) : 0;
    const nb = mb ? parseInt(mb[1], 10) : 0;
    return (na - nb) * mult;
  }
  if (key === "priority") {
    const pa = parsePriority(a.priority), pb = parsePriority(b.priority);
    if (pa !== pb) return (pa - pb) * mult;
    return staleDays(b.sys_updated_on) - staleDays(a.sys_updated_on); // tiebreak: stale desc
  }
  if (key === "stale") {
    const sa = staleDays(a.sys_updated_on), sb = staleDays(b.sys_updated_on);
    if (sa !== sb) return (sa - sb) * mult;
    return parsePriority(a.priority) - parsePriority(b.priority); // tiebreak: priority asc
  }
  if (key === "updated") {
    const ta = parseUpdatedOn(a.sys_updated_on), tb = parseUpdatedOn(b.sys_updated_on);
    const va = ta ? ta.getTime() : 0, vb = tb ? tb.getTime() : 0;
    if (va !== vb) return (va - vb) * mult;
    return cmpIdDesc(a, b); // tiebreak: id desc
  }
  if (key === "created") {
    const ta = parseUpdatedOn(a.sys_created_on), tb = parseUpdatedOn(b.sys_created_on);
    const va = ta ? ta.getTime() : 0, vb = tb ? tb.getTime() : 0;
    if (va !== vb) return (va - vb) * mult;
    return cmpIdDesc(a, b); // tiebreak: id desc
  }
  if (key === "state") {
    const sa = parseInt(displayVal(a.state), 10) || 0;
    const sb = parseInt(displayVal(b.state), 10) || 0;
    if (sa !== sb) return (sa - sb) * mult;
    return parsePriority(a.priority) - parsePriority(b.priority); // tiebreak: priority asc
  }
  return 0;
}
// id-desc tiebreak helper (used by updated/created) — byte-identical to panel.js copy
function cmpIdDesc(a, b) {
  const ma = (displayVal(a.number) || "").match(/(\d+)$/);
  const mb = (displayVal(b.number) || "").match(/(\d+)$/);
  const na = ma ? parseInt(ma[1], 10) : 0;
  const nb = mb ? parseInt(mb[1], 10) : 0;
  return nb - na;
}

// --- compareTickets tests ---
console.log("\n=== compareTickets ===");
const ctTickets = [
  { number: "INC0010", priority: "3 - Moderate", sys_updated_on: "2026-05-10", sys_created_on: "2026-04-01", state: { value: "1", display_value: "New" } },
  { number: "INC0002", priority: "1 - Critical", sys_updated_on: "2026-05-27", sys_created_on: "2026-05-20", state: { value: "2", display_value: "In Progress" } },
  { number: "INC0007", priority: "1 - Critical", sys_updated_on: "2026-05-15", sys_created_on: "2026-05-01", state: { value: "7", display_value: "Closed" } },
];
function sortedNums(key, dir) {
  return ctTickets.slice().sort((a, b) => compareTickets(a, b, key, dir)).map(t => displayVal(t.number));
}
const ctCases = [
  ["id asc",      ["INC0002", "INC0007", "INC0010"], sortedNums("id", "asc")],
  ["id desc",     ["INC0010", "INC0007", "INC0002"], sortedNums("id", "desc")],
  ["priority asc (P1s first, INC0002 newer-stale than INC0007)", ["INC0007", "INC0002", "INC0010"], sortedNums("priority", "asc")],
  ["priority desc", ["INC0010", "INC0007", "INC0002"], sortedNums("priority", "desc")],
  ["stale asc (INC0010 stalest)", ["INC0010", "INC0007", "INC0002"], sortedNums("stale", "asc")],
  ["stale desc (INC0002 least stale)", ["INC0002", "INC0007", "INC0010"], sortedNums("stale", "desc")],
  ["updated asc (oldest first)", ["INC0010", "INC0007", "INC0002"], sortedNums("updated", "asc")],
  ["updated desc (newest first)", ["INC0002", "INC0007", "INC0010"], sortedNums("updated", "desc")],
  ["created asc (oldest first)", ["INC0010", "INC0007", "INC0002"], sortedNums("created", "asc")],
  ["created desc (newest first)", ["INC0002", "INC0007", "INC0010"], sortedNums("created", "desc")],
  ["state asc (1 before 2 before 7)", ["INC0010", "INC0002", "INC0007"], sortedNums("state", "asc")],
  ["state desc", ["INC0007", "INC0002", "INC0010"], sortedNums("state", "desc")],
];
for (const [label, expected, got] of ctCases) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) pass++; else fail++;
  console.log(ok ? "PASS" : "FAIL", label, "=>", got.join(", "), ok ? "" : "(expected " + expected.join(", ") + ")");
}
```

**Step 2: Run the tests to verify they pass**

Run:
```bash
node tests/sort-verify.js
```
Expected: all `=== compareTickets ===` cases PASS (because `compareTickets` is defined locally in the same file). The existing cases above should also still PASS.

> Note: these tests pass immediately because the helper is in the test file. The real value is that they pin the behavior before you copy the same `compareTickets` into `panel.js` in Task 5. If a later edit to `panel.js`'s copy diverges, re-diff against this reference.

**Step 3: Commit**

```bash
git add tests/sort-verify.js
git commit -m "test: add compareTickets cases (6 keys x 2 directions)"
```

---

## Task 5: Implement compareTickets in panel.js and wire into btn-list

**Files:**
- Modify: `chrome-extension/panel.js` — add helper near `parsePriority` (~line 279), and replace the sort block at lines 1103-1110

**Step 1: Add the compareTickets helper**

After `parsePriority()` (line 279), add:

```javascript
// Compare two tickets for the List sort. `key` ∈ id/priority/stale/updated/created/state;
// `dir` ∈ asc/desc. All field access via displayVal/parseUpdatedOn (query uses
// sysparm_display_value=all, so fields arrive as {value, display_value} objects —
// raw Date.parse would NaN). Tiebreaks are fixed-direction per the design.
function compareTickets(a, b, key, dir) {
  const mult = dir === "desc" ? -1 : 1;
  if (key === "id") {
    const ma = (displayVal(a.number) || "").match(/(\d+)$/);
    const mb = (displayVal(b.number) || "").match(/(\d+)$/);
    const na = ma ? parseInt(ma[1], 10) : 0;
    const nb = mb ? parseInt(mb[1], 10) : 0;
    return (na - nb) * mult;
  }
  if (key === "priority") {
    const pa = parsePriority(a.priority), pb = parsePriority(b.priority);
    if (pa !== pb) return (pa - pb) * mult;
    return staleDays(b.sys_updated_on) - staleDays(a.sys_updated_on); // tiebreak: stale desc
  }
  if (key === "stale") {
    const sa = staleDays(a.sys_updated_on), sb = staleDays(b.sys_updated_on);
    if (sa !== sb) return (sa - sb) * mult;
    return parsePriority(a.priority) - parsePriority(b.priority); // tiebreak: priority asc
  }
  if (key === "updated") {
    const ta = parseUpdatedOn(a.sys_updated_on), tb = parseUpdatedOn(b.sys_updated_on);
    const va = ta ? ta.getTime() : 0, vb = tb ? tb.getTime() : 0;
    if (va !== vb) return (va - vb) * mult;
    return cmpIdDesc(a, b); // tiebreak: id desc
  }
  if (key === "created") {
    const ta = parseUpdatedOn(a.sys_created_on), tb = parseUpdatedOn(b.sys_created_on);
    const va = ta ? ta.getTime() : 0, vb = tb ? tb.getTime() : 0;
    if (va !== vb) return (va - vb) * mult;
    return cmpIdDesc(a, b); // tiebreak: id desc
  }
  if (key === "state") {
    const sa = parseInt(displayVal(a.state), 10) || 0;
    const sb = parseInt(displayVal(b.state), 10) || 0;
    if (sa !== sb) return (sa - sb) * mult;
    return parsePriority(a.priority) - parsePriority(b.priority); // tiebreak: priority asc
  }
  return 0;
}
// id-desc tiebreak helper (used by updated/created)
function cmpIdDesc(a, b) {
  const ma = (displayVal(a.number) || "").match(/(\d+)$/);
  const mb = (displayVal(b.number) || "").match(/(\d+)$/);
  const na = ma ? parseInt(ma[1], 10) : 0;
  const nb = mb ? parseInt(mb[1], 10) : 0;
  return nb - na;
}
```

**Step 2: Replace the hardcoded sort block**

At lines 1103-1110, replace:
```javascript
    tickets.sort((a, b) => {
      const pa = parsePriority(a.priority);
      const pb = parsePriority(b.priority);
      if (pa !== pb) return pa - pb;
      const sa = staleDays(a.sys_updated_on);
      const sb = staleDays(b.sys_updated_on);
      return sb - sa;
    });
```
with:
```javascript
    const sortKey = document.getElementById("list-sort-key").value;
    const sortDir = document.getElementById("list-sort-dir").value;
    tickets.sort((a, b) => compareTickets(a, b, sortKey, sortDir));
```

**Step 3: Run the test suite to confirm no regression**

Run:
```bash
node tests/sort-verify.js
```
Expected: all PASS (the priority-first integration test at lines 60-79 is unchanged and still asserts `["INC003","INC002","INC005","INC004","INC001"]`; it uses its own inline sort, independent of panel.js).

**Step 4: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: compareTickets helper + wire into List sort (6 keys, asc/desc)"
```

---

## Task 6: Add getStatusReasons page function + message handler

> This is the dynamic fetch half of the closure-code feature (design R2 was validated in Task 0). Clones the `getNoteTypes` pattern at `background.js:235` / `:706`.

**Files:**
- Modify: `chrome-extension/background.js` — add function near `getNoteTypesInPage` (line 235), handler near `getNoteTypes` (line 706)

**Step 1: Add the page function**

After `getNoteTypesInPage()` (line 235-…), add. **This mirrors `getNoteTypesInPage` exactly** — including the `sequence` sort (so options appear in SNOW's defined order) and the object-or-scalar field extraction (`sysparm_display_value=all` returns `{value, display_value}` objects):

```javascript
function getStatusReasonsInPage() {
  return snowFetch("GET", "/api/now/table/sys_choice?sysparm_query=element=u_status_reason^nameINincident,task^inactive=false&sysparm_fields=label,value,sequence&sysparm_display_value=all&sysparm_limit=200")
    .then(function(d) {
      var items = d.result || [];
      items.sort(function(a, b) {
        var sa = parseInt(typeof a.sequence === "object" ? a.sequence.value : a.sequence) || 0;
        var sb = parseInt(typeof b.sequence === "object" ? b.sequence.value : b.sequence) || 0;
        return sa - sb;
      });
      return items.map(function(r) {
        var lbl = (typeof r.label === "object" ? r.label.display_value || r.label.value : r.label) || "";
        var val = (typeof r.value === "object" ? r.value.value : r.value) || "";
        return { label: lbl, value: val };
      });
    });
}
```

> If Task 0 found a different query string works, use that exact string here. The transform (sequence sort + object-aware extraction) stays the same.

**Step 2: Add the message handler**

Near the `getNoteTypes` handler (line 706-707), add:

```javascript
  if (msg.action === "getStatusReasons") {
    return injectAndExec(tab.id, getStatusReasonsInPage, []);
  }
```

**Step 3: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat: getStatusReasons message handler (sys_choice fetch for u_status_reason)"
```

---

## Task 7: Thread statusReason through the alarmClose chain

> Design B2-fallback: `u_status_reason = msg.statusReason || "Alarm(s) Cleared on Access"` so old callers are unaffected.

**Files:**
- Modify: `chrome-extension/background.js:789-790` (inside the alarm-close chain)

**Step 1: Replace the hardcoded u_status_reason**

At lines 789-790, change:
```javascript
      if (targetState === "6" || targetState === "7") {
        fields.u_status_reason = "Alarm(s) Cleared on Access";
      }
```
to:
```javascript
      if (targetState === "6" || targetState === "7") {
        fields.u_status_reason = msg.statusReason || "Alarm(s) Cleared on Access";
      }
```

**Step 2: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat: alarmClose accepts statusReason (u_status_reason), falls back to Alarm(s) Cleared on Access"
```

---

## Task 8: Add loadStatusReasons + buildStatusReasonOptions to panel.js

> Clones `loadNoteTypes`/`buildNoteTypeOptions` at `panel.js:178-209`. Fallback is the single verified value (design R1).

**Files:**
- Modify: `chrome-extension/panel.js` — add near `NOTE_TYPE_VALUES` (line 176), call at init (line 1437)

**Step 1: Add the storage var + loader + builder**

After the `buildNoteTypeOptions` function (line 209), add:

```javascript
var STATUS_REASON_VALUES = null; // [{label, value}] from SNOW sys_choice

// R1: fallback is the single verified value only — we don't invent close-reason
// strings SNOW might reject on write. Custom/other reasons come from the dynamic
// fetch once it loads (a <select> can't accept typed input).
function buildStatusReasonOptions(selectedValue) {
  var FALLBACK = ["Alarm(s) Cleared on Access"];
  var html = '';
  var src = STATUS_REASON_VALUES
    ? STATUS_REASON_VALUES.map(function(r) { return { val: r.value || r.label, lbl: r.label || r.value }; })
    : FALLBACK.map(function(v) { return { val: v, lbl: v }; });
  for (var i = 0; i < src.length; i++) {
    var o = src[i];
    var isSel = (o.val === selectedValue || o.lbl === selectedValue);
    html += '<option value="' + esc(o.val) + '"' + (isSel ? ' selected' : '') + '>' + esc(o.lbl) + '</option>';
  }
  return html;
}

function loadStatusReasons() {
  send({ action: "getStatusReasons" }).then(function(reasons) {
    if (reasons && reasons.length > 0) {
      STATUS_REASON_VALUES = reasons;
      // Repopulate every closure-code select (inline forms already open + Action tab).
      // R3: preserves sel.value; if the user picked a fallback-only value not in the
      // dynamic list, the select resets to the first option — benign (default is the
      // verified value, which exists in both lists).
      document.querySelectorAll(".alarm-reason-select, #alarm-reason").forEach(function(sel) {
        var cur = sel.value;
        sel.innerHTML = buildStatusReasonOptions(cur || "Alarm(s) Cleared on Access");
      });
    }
  }).catch(function() { /* keep fallback */ });
}
```

**Step 2: Call at panel init**

At line 1437, after `loadNoteTypes();` and the `restoreListSort();` added in Task 3, add:

```javascript
// --- Load closure-code options from SNOW (fallback: single verified value) ---
loadStatusReasons();
```

**Step 3: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: loadStatusReasons + buildStatusReasonOptions (dynamic u_status_reason dropdown)"
```

---

## Task 9: Add Closure Code dropdown to the Action tab alarm-close form

**Files:**
- Modify: `chrome-extension/panel.html:519-520` (insert between Note Template group and Close Note group)

**Step 1: Insert the Closure Code form-group**

Between the Note Template `</div>` (line 519) and the Close Note `<div class="form-group">` (line 520), add:

```html
    <div class="form-group">
      <label>Closure Code</label>
      <select id="alarm-reason"></select>
    </div>
```

**Step 2: Populate it at init**

In `panel.js`, inside `loadStatusReasons()` is already covered by the `querySelectorAll(".alarm-reason-select, #alarm-reason")` repopulate loop (Task 8). But the initial render needs the fallback immediately. Add to `panel.js` init (line 1437 area), right after `loadStatusReasons();`:

```javascript
// Render closure-code fallback immediately (dynamic load refreshes it async)
var ar = document.getElementById("alarm-reason");
if (ar) ar.innerHTML = buildStatusReasonOptions("Alarm(s) Cleared on Access");
```

**Step 3: Read the selected value in the btn-alarm-close handler**

At `panel.js:1314`, change:
```javascript
    const data = await send({ action: "alarmClose", ticketNumber: number, note, effortMinutes });
```
to:
```javascript
    const statusReason = document.getElementById("alarm-reason").value;
    const data = await send({ action: "alarmClose", ticketNumber: number, note, effortMinutes, statusReason });
```

**Step 4: Commit**

```bash
git add chrome-extension/panel.html chrome-extension/panel.js
git commit -m "feat: Closure Code dropdown in Action tab alarm-close"
```

---

## Task 10: Add Closure Code dropdown to the inline alarm-close form

**Files:**
- Modify: `chrome-extension/panel.js:887-888` (insert in formHtml) and `:906-909` (read at submit)

**Step 1: Insert the Closure Code select in the inline formHtml**

At lines 887-888, the formHtml currently has:
```javascript
      + '<div style="margin-bottom:4px"><label>Close Note</label>'
      + '<textarea class="alarm-note-input" data-form="' + formId + '" rows="6">' + esc(defaultTmpl) + '</textarea></div>'
```
Insert **before** that block:
```javascript
      + '<div style="margin-bottom:4px"><label>Closure Code</label>'
      + '<select class="alarm-reason-select" data-form="' + formId + '">'
      +   buildStatusReasonOptions("Alarm(s) Cleared on Access")
      + '</select></div>'
```

**Step 2: Read the selected value at submit**

At line 906 (the `alarm-close-exec` handler), alongside the other form reads, add after the `effortUnitEl` line (908):
```javascript
    const reasonSel = form ? form.querySelector(".alarm-reason-select") : null;
```
Then at line 925, change:
```javascript
    send({ action: "alarmClose", ticketNumber: ticket, note, effortMinutes })
```
to:
```javascript
    const statusReason = reasonSel ? reasonSel.value : "";
    send({ action: "alarmClose", ticketNumber: ticket, note, effortMinutes, statusReason })
```

**Step 3: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: Closure Code dropdown in inline alarm-close form"
```

---

## Task 11: Manual smoke test

> No automated test for the UI wiring; verify by hand. This catches the race handling (R3), the sort persistence, and the end-to-end closure-code write.

**Steps:**

1. Load the unpacked extension in Chrome (`chrome://extensions` → Load unpacked → `chrome-extension/` folder).
2. Open ServiceNow, log in. Open the sidebar.
3. **Sort — default:** List auto-loads. Confirm results are ordered by Case ID **descending** (highest INC number on top).
4. **Sort — change:** Pick `Priority` + `Ascending`. Re-search. Confirm P1 tickets first. Refresh the panel — confirm the selection persisted (Priority/Ascending).
5. **Sort — each key:** Cycle through id/priority/stale/updated/created/state with both directions; confirm a sensible, non-NaN order each time (no "all equal" no-op — that would indicate B2 not fixed).
6. **Closure code — Action tab:** Enter an alarm INC number in the Action tab. Confirm the "Closure Code" dropdown appears with the dynamic list (or the single fallback value if the fetch is slow/blocked). Change it to a non-default value, add a close note, click Close Alarm. Confirm the chain completes and (in SNOW) `u_status_reason` reflects the chosen value, not "Alarm(s) Cleared on Access".
7. **Closure code — inline:** In the List tab, find an alarm card, click Close Alarm. Confirm the inline form has the Closure Code dropdown. Close with a chosen value; verify `u_status_reason` in SNOW.
8. **Backward compat:** Close an alarm without changing the closure code (default "Alarm(s) Cleared on Access"). Confirm it still writes that value — unchanged behavior.

**No commit** — this is verification.

---

## Task 12: Update CHANGELOG and bump version

**Files:**
- Modify: `chrome-extension/manifest.json` (version bump)
- Modify: `CHANGELOG.md` (new 2.11 entry)

**Step 1: Bump version in manifest.json**

Change `"version"` to `"2.11"`.

**Step 2: Add CHANGELOG entry**

At the top of `CHANGELOG.md`, before `## [2.10]`, add:

```markdown
## [2.11] - 2026-06-25

### Added
- **List sort control** — New "Sort" + "Order" dropdowns in the List tab toolbar. Sort by Case ID, Priority, Stale days, Last updated, Created, or State; Ascending or Descending. Selection persists across sessions. `compareTickets()` helper replaces the old hardcoded priority→stale order.
- **Closure Code on alarm close** — The `u_status_reason` field is now a user-selectable dropdown on both alarm-close surfaces (Action tab and inline List form), fetched dynamically from `sys_choice` (same pattern as Work Note Types). Default remains "Alarm(s) Cleared on Access" for unchanged behavior.

### Changed
- **Default List sort is now Case ID descending (new on top).** Previously the List auto-loaded with priority-first/stalest-first ordering. Existing users who relied on the P1-first startup view should switch the Sort dropdown to "Priority" — the choice then persists. (Design P1.)
- `listTicketsInPage` default fields now include `sys_created_on` (enables the Created sort; one extra field on an already-returned record, no extra request).
```

**Step 3: Commit**

```bash
git add chrome-extension/manifest.json CHANGELOG.md
git commit -m "chore: bump to v2.11, add sort + closure code changelog"
```

---

## Notes for the executor

- **Read the design doc first** (`docs/plans/2026-06-25-sort-and-closure-code-design.md`) — it explains *why* each decision was made and lists the risks (R1-R3, P1) that the code comments reference.
- **Task 0 is a gate.** If the `sys_choice` query returns nothing, fix the query before Task 6 — don't proceed on the fallback alone.
- **The test file is self-contained.** `compareTickets` + `cmpIdDesc` are duplicated **byte-identically** between `tests/sort-verify.js` (Task 4) and `panel.js` (Task 5) — same parse style, same tiebreak structure, same inline comments. The *only* intended difference is that the `panel.js` copy carries a 4-line preamble comment (production context) that the test copy omits. This matches the existing pattern (the test redefines `displayVal`/`parsePriority`/`staleDays` locally). The test copy is the reference: to re-diff for divergence, ignore the preamble and compare the function bodies — they should match exactly.
- **No new permissions, no new files.** All changes are edits to `panel.html`, `panel.js`, `background.js`, `manifest.json`, `CHANGELOG.md`, and `tests/sort-verify.js`.
