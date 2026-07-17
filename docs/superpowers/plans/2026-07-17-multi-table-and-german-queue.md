# Multi-Table List + German Non-Standard Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show CHG and PRB tickets alongside INC in the List tab (merged multi-table view), and add the German Non-Standard Support queue as a 7th Filter dropdown option with a one-click per-table Take action.

**Architecture:** No new files or message types. Extends three existing handlers: `listTicketsInPage` (background, +1 field), `takeTicket` (background, per-table work state), and the `btn-list` handler (panel, fan-out + queue branch). All changes reuse the three-layer flow `panel.js → background.js → injected snowFetch`. See `docs/superpowers/specs/2026-07-17-multi-table-and-german-queue-design.md` for the full design.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JS (no build step), ServiceNow Table REST API. Tests use Node's built-in `node:test` runner (`node --test tests/`).

**Spec reference:** `docs/superpowers/specs/2026-07-17-multi-table-and-german-queue-design.md` (commit `0da06a8`).

**Conventions in this codebase:**
- Comments document *why* (especially non-obvious SNOW quirks) — match the density of surrounding code.
- Line-number references in comments (e.g. the `compareTickets` preamble at `panel.js:304-318`) must be kept in sync when those functions move. The plan notes where this is required.
- Tests live in `tests/` at repo root, using `node:test` + `node:assert/strict`. Run with `node --test tests/<file>`.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `chrome-extension/note-fields.js` | Shared UMD: `TABLE_MAP`, `detectTable`, `displayVal`, `buildCommentFields` | **Untouched** (TABLE_STATES lives in panel.js, not here) |
| `chrome-extension/panel.js` | Sidebar UI: presets, sort, render, take-link handler | Add `workStartState` to `TABLE_STATES`; add `change_task` entry; add `GERMAN_NS_QUEUE_QUERY` + `germanMode`; fan-out `btn-list`; bucket-sort by state; render `sys_class_name`-first; wire `data-table` on Take links; generalize post-Take badge |
| `chrome-extension/panel.html` | Sidebar markup | Add `<option value="german-ns">` to `#list-preset` |
| `chrome-extension/background.js` | Service worker orchestration | Add `sys_class_name` to `listTicketsInPage` fields; `takeTicket` uses `localTable` + per-table `workStartState` |
| `tests/multi-table.test.js` | NEW — unit tests for the pure helpers added/changed in panel.js (bucket-rank, sys_class_name resolution, workStartState lookup) | CREATE |

**Why a separate test file:** the existing `tests/sort-verify.js` is a standalone characterization script (no `node:test`), and `tests/note-fields.test.js` covers `note-fields.js`. The new tests cover panel.js helpers that we'll factor out as pure functions so they're testable without a DOM.

**Note on `tests/note-fields.test.js:14-18`:** this pre-existing test asserts `fields.comments === undefined`, but `buildCommentFields` never sets `comments` (it sets `work_notes`). The test currently passes only because `comments` is indeed never set — but the assertion's *intent* is unclear and may be stale. Do not modify this file; it's out of scope.

---

## Task 1: Add `workStartState` to `TABLE_STATES` (TDD)

**Why first:** this is the data foundation for Task 4 (per-table Take). Pure data, no DOM, easy to test in isolation. Spec §4a.

**Files:**
- Modify: `chrome-extension/panel.js:43-168` (`TABLE_STATES` object)
- Create: `tests/multi-table.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/multi-table.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

// panel.js is a browser script — it references document/window at top level.
// To unit-test the pure helpers (TABLE_STATES, getStateConfig, resolveTable,
// stateBucketRank), we load the file in a sandbox that stubs the globals.
// We expose the helpers via a test-only hook: panel.js checks for
// module.exports at the bottom (added in Step 3 below) and exports them.

function loadPanelHelpers() {
  // Minimal DOM stub sufficient for panel.js top-level code to parse.
  const stubElement = {
    value: "", addEventListener: () => {}, innerHTML: "", textContent: "",
    appendChild: () => {}, querySelector: () => null, querySelectorAll: () => [],
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    style: {}, dataset: {},
  };
  const document = {
    getElementById: () => stubElement,
    querySelector: () => stubElement,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => stubElement,
  };
  const window = { addEventListener: () => {}, localStorage: { getItem: () => null, setItem: () => {} } };
  const chrome = { runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } } };
  const sandbox = { document, window, chrome, localStorage: document.body?.localStorage || { getItem: () => null, setItem: () => {} } };

  const fs = require("fs");
  const path = require("path");
  let src = fs.readFileSync(path.join(__dirname, "..", "chrome-extension", "panel.js"), "utf8");
  // Strip the browser-only bootstrap at the bottom (the last addEventListener
  // calls and any IIFE). The helpers we test are defined above; the export
  // hook we add in Step 3 sits just before the bootstrap.
  // For test purposes, replace the top-level `document`/`window`/`chrome`
  // references by running in a Function with our stubs as args.
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  const fn = new Function("document", "window", "chrome", "localStorage", "module", src);
  fn(document, window, chrome, sandbox.localStorage, module);
  return module.exports;
}

const helpers = loadPanelHelpers();

test("TABLE_STATES.incident.workStartState is '2'", () => {
  assert.equal(helpers.TABLE_STATES.incident.workStartState, "2");
});

test("TABLE_STATES.problem.workStartState is '102'", () => {
  assert.equal(helpers.TABLE_STATES.problem.workStartState, "102");
});

test("TABLE_STATES.change_request.workStartState is '-1'", () => {
  assert.equal(helpers.TABLE_STATES.change_request.workStartState, "-1");
});

test("TABLE_STATES.task.workStartState is '2'", () => {
  assert.equal(helpers.TABLE_STATES.task.workStartState, "2");
});

test("TABLE_STATES.change_task exists and has workStartState", () => {
  assert.ok(helpers.TABLE_STATES.change_task, "change_task entry must exist");
  assert.equal(helpers.TABLE_STATES.change_task.workStartState, "2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multi-table.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'incident')` because (a) `module.exports` is not populated by panel.js yet, and (b) `workStartState` doesn't exist. Both will be fixed in Step 3.

- [ ] **Step 3: Add `workStartState` to each TABLE_STATES entry + add `change_task` + add export hook**

In `chrome-extension/panel.js`, add a `workStartState` field to each entry of `TABLE_STATES` (lines 43-168). The field goes right after `resolveState` in each entry, before `pendingState`. Exact additions:

For `incident` (after line 72 `resolveState: "6",`):
```js
    workStartState: "2",
```

For `change_request` (after line 90 `resolveState: "3",`):
```js
    workStartState: "-1",
```

For `problem` (after line 107 `resolveState: "105",`):
```js
    workStartState: "102",
```

For `sc_req_item` (after line 121 `resolveState: "3",`):
```js
    workStartState: "2",
```

For `task` (after line 149 `resolveState: "3",`):
```js
    workStartState: "2",
```

For `sc_task` (after line 164 `resolveState: "3",`):
```js
    workStartState: "2",
```

Then add a new `change_task` entry. Insert it **immediately after** the `task` entry's closing `},` (which is at line 152, right before `sc_task:`). Copy the `task` block verbatim and change the key:

```js
  change_task: {
    labels: { "-5": "Pending", "1": "Open", "2": "Work in Progress", "3": "Closed Complete", "4": "Closed Incomplete", "7": "Closed Skipped" },
    classes: { "-5": "state-active", "1": "state-new", "2": "state-active", "3": "state-closed", "4": "state-closed", "7": "state-closed" },
    selectableStates: ["2", "3", "4", "7"],
    transitions: {
      "-5": ["1", "3", "4", "7"],
      "1": ["2", "3", "4", "7"],
      "2": ["3", "4", "7"],
    },
    reasons: {},
    supportsAlarmClose: false,
    resolveState: "3",
    workStartState: "2",
    pendingState: "-5",
    hasFollowUp: false,
  },
```

> **Verify before this step (spec §3b):** run the `sys_choice` probe to confirm `change_task`'s state model matches `task`. Open the ServiceNow tab and in the browser console run:
> ```js
> fetch("/api/now/table/sys_choice?sysparm_query=name=change_task^element=state&sysparm_fields=value,label&sysparm_display_value=false&sysparm_limit=50", {headers: {"X-UserToken": g_ck}}).then(r=>r.json()).then(d=>console.table(d.result))
> ```
> If the values/labels differ from `task`'s, use the probed values in the `change_task` entry above. If ACL-blocked (403/empty), proceed with the `task` copy as documented fallback.

Finally, add the test export hook at the **very end** of `panel.js` (after all existing code, as the last statement in the file):

```js
// Test export hook: exposes pure helpers for node:test. In the browser this
// is a no-op (module is undefined). Keep this at the END of the file so the
// browser-only bootstrap (addEventListener calls etc.) still runs above.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { TABLE_STATES, getStateConfig };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multi-table.test.js`
Expected: PASS — all 5 tests green.

If the sandbox load fails (panel.js references an unstubbed global at parse time), extend the `stubElement`/`document` stubs in the test file to cover it. The goal is a minimal stub, not a full DOM.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/panel.js tests/multi-table.test.js
git commit -m "feat(panel): add workStartState per table + change_task TABLE_STATES entry

Data foundation for per-table Take action (spec §4a). change_task mirrors
task's state model (verified via sys_choice probe). Adds test export hook
at end of panel.js — no-op in browser, enables node:test unit tests."
```

---

## Task 2: Add `sys_class_name` to `listTicketsInPage` fields

**Why:** the renderer and Take handler need the authoritative record class, not a number-prefix guess. Spec §1, §3a. One-line change, but unlocks everything downstream.

**Files:**
- Modify: `chrome-extension/background.js:292` (the `sysparm_fields` default string)

- [ ] **Step 1: Add `sys_class_name` to the field list**

In `chrome-extension/background.js`, find line 292 (inside `listTicketsInPage`):

```js
params.set("sysparm_fields", fields || "number,short_description,description,state,priority,assigned_to,sys_updated_on,sys_created_on,contact_type,cmdb_ci");
```

Change to:

```js
params.set("sysparm_fields", fields || "number,short_description,description,state,priority,assigned_to,sys_updated_on,sys_created_on,contact_type,cmdb_ci,sys_class_name");
```

That's the entire change. `sysparm_display_value=all` (already set on line 291) means the response will include `sys_class_name: { value: "change_task", display_value: "Change Task" }` — exactly what `resolveTable` (Task 3) consumes.

- [ ] **Step 2: Manual verification (no automated test — this is a network call)**

Load the unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked → select `chrome-extension/`). Open the ServiceNow tab (must be logged in to `avaya.service-now.com`). Open the sidebar, select **My Open Tickets**, click Search. Pick any result card and in the DevTools console run:

```js
chrome.runtime.sendMessage({action:"listTickets", table:"incident", query:"active=true^assigned_to=javascript:gs.getUserID()", limit:1}, (r) => console.log(r[0].sys_class_name))
```

Expected: `{ value: "incident", display_value: "Incident" }` (not undefined).

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat(background): include sys_class_name in listTickets fields

Authoritative record class for rendering and Take semantics. Number-prefix
guessing (detectTable) is wrong for queue records — TASK prefix can be either
task or change_task, and detectTable defaults unknown prefixes to incident."
```

---

## Task 3: Add `resolveTable` helper + generalize card rendering to use it

**Why:** the card render loop currently calls `detectTable(displayVal(t.number))` (prefix guess). We need `sys_class_name`-first with `detectTable` fallback. Spec §3a. Pure helper, testable.

**Files:**
- Modify: `chrome-extension/panel.js` (add `resolveTable` near `getStateConfig` at line 170; use it in the render loop at line 1217)
- Modify: `tests/multi-table.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/multi-table.test.js` (after the existing tests, before any final newline):

```js
test("resolveTable prefers sys_class_name.value when present", () => {
  const t = { number: "TASK0010001", sys_class_name: { value: "change_task", display_value: "Change Task" } };
  assert.equal(helpers.resolveTable(t), "change_task");
});

test("resolveTable falls back to detectTable(number) when sys_class_name absent", () => {
  const t = { number: "INC0010001" };
  assert.equal(helpers.resolveTable(t), "incident");
});

test("resolveTable falls back to detectTable when sys_class_name.value is empty", () => {
  const t = { number: "PRB0010001", sys_class_name: { value: "", display_value: "" } };
  assert.equal(helpers.resolveTable(t), "problem");
});

test("resolveTable handles null ticket gracefully", () => {
  assert.equal(helpers.resolveTable(null), "incident");
});
```

Also update the test export hook (added in Task 1 Step 3) to include `resolveTable`:

```js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { TABLE_STATES, getStateConfig, resolveTable };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multi-table.test.js`
Expected: FAIL — `helpers.resolveTable is not a function` (not yet defined or exported).

- [ ] **Step 3: Add `resolveTable` helper**

In `chrome-extension/panel.js`, immediately after `getStateConfig` (line 170-172), add:

```js
// resolveTable: authoritative record-class resolution for rendering and Take.
// Prefers sys_class_name from the API (correct for every record, including the
// queue's mixed task/change_task/problem results); falls back to detectTable's
// number-prefix guess when sys_class_name is absent (back-compat for cached
// data or single-ticket lookups that didn't request the field).
function resolveTable(t) {
  if (t && t.sys_class_name) {
    const cls = typeof t.sys_class_name === "object" ? t.sys_class_name.value : t.sys_class_name;
    if (cls) return cls;
  }
  return detectTable(t ? displayVal(t.number) : "");
}
```

Update the export hook to include `resolveTable` (as shown in Step 1).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multi-table.test.js`
Expected: PASS — all 9 tests green.

- [ ] **Step 5: Use `resolveTable` in the render loop**

In `chrome-extension/panel.js`, find line 1217 (inside the `btn-list` click handler's render loop):

```js
      const lTable = detectTable(displayVal(t.number));
```

Change to:

```js
      const lTable = resolveTable(t);
```

This is the only call site that needs changing for rendering — the `lTable` variable flows into `staleClass`, `getStateConfig`, `stateBadge`, and the alarm-close gating, all of which already accept a table name.

- [ ] **Step 6: Commit**

```bash
git add chrome-extension/panel.js tests/multi-table.test.js
git commit -m "feat(panel): resolveTable uses sys_class_name first, detectTable fallback

Fixes silent mis-rendering of queue records: detectTable maps TAS->task but
doesn't know TASK (defaults to incident), and a TASK-prefixed record can be
either task or change_task. sys_class_name from the API is authoritative."
```

---

## Task 4: Generalize `takeTicket` to per-table work-started state

**Why:** the background `takeTicket` hardcodes `state: "2"` (incident In Progress). Problem records need `102`, change_request needs `-1`. Spec §4b, §4c.

**Files:**
- Modify: `chrome-extension/background.js:730-748`

- [ ] **Step 1: Apply the `localTable` shadow + per-table workStartState**

In `chrome-extension/background.js`, replace the entire `if (msg.action === "takeTicket") { ... }` block (lines 730-748). The current block:

```js
  if (msg.action === "takeTicket") {
    // getUserId doesn't depend on the ticket, so fetch both in parallel. Pre-warm
    // the injection cache first so the two parallel injectAndExec calls don't both
    // inject content-snow.js on a cold tab (harmless if they did — idempotent —
    // but this avoids the redundant inject).
    await ensureSnowInjected(tab.id);
    const [ticket, userId] = await Promise.all([
      injectAndExec(tab.id, getTicketInPage, [table, msg.ticketNumber]),
      injectAndExec(tab.id, getUserIdInPage, []),
    ]);
    if (!ticket) throw new Error("Ticket " + msg.ticketNumber + " not found");
    const sysId = typeof ticket.sys_id === "object" ? ticket.sys_id.value : ticket.sys_id;
    if (!userId) throw new Error("Could not determine current user");
    const result = await injectAndExec(tab.id, updateBySysIdInPage, [
      table, sysId, { assigned_to: userId, state: "2" }
    ]);
    if (result && result._error) throw new Error(result._error);
    return { success: true, assignedTo: userId };
  }
```

Replace with:

```js
  if (msg.action === "takeTicket") {
    // getUserId doesn't depend on the ticket, so fetch both in parallel. Pre-warm
    // the injection cache first so the two parallel injectAndExec calls don't both
    // inject content-snow.js on a cold tab (harmless if they did — idempotent —
    // but this avoids the redundant inject).
    //
    // localTable: prefer the caller-supplied table (the panel knows the
    // authoritative sys_class_name — see resolveTable in panel.js). Falls back
    // to the outer-scope `table` (detectTable prefix guess) for back-compat
    // with any caller that doesn't send `table`. Cannot redeclare `table` —
    // it's already const at the top of this dispatch block (line 706).
    const localTable = msg.table || table;
    await ensureSnowInjected(tab.id);
    const [ticket, userId] = await Promise.all([
      injectAndExec(tab.id, getTicketInPage, [localTable, msg.ticketNumber]),
      injectAndExec(tab.id, getUserIdInPage, []),
    ]);
    if (!ticket) throw new Error("Ticket " + msg.ticketNumber + " not found");
    const sysId = typeof ticket.sys_id === "object" ? ticket.sys_id.value : ticket.sys_id;
    if (!userId) throw new Error("Could not determine current user");
    // Per-table work-started state. Incident->2 (In Progress) preserves the
    // previous hardcoded behavior exactly. Problem->102 (Assess),
    // change_request->-1 (Implement), task/change_task->2 (Work in Progress).
    // TABLE_STATES is imported via importScripts at the top of this file.
    const cfg = TABLE_STATES[localTable];
    const workState = (cfg && cfg.workStartState) || "2";
    const result = await injectAndExec(tab.id, updateBySysIdInPage, [
      localTable, sysId, { assigned_to: userId, state: workState }
    ]);
    if (result && result._error) throw new Error(result._error);
    return { success: true, assignedTo: userId };
  }
```

- [ ] **Step 2: Verify `TABLE_STATES` is in scope in background.js**

Run: `grep -n "TABLE_STATES\|importScripts" chrome-extension/background.js | head`
Expected: `importScripts(...)` near line 1, and `TABLE_STATES` referenced somewhere. If `TABLE_STATES` is NOT imported into the service worker, check what `importScripts` loads — it may load `note-fields.js` (which does NOT contain `TABLE_STATES`). In that case, `TABLE_STATES` must be extracted to `note-fields.js` or a new shared module so both `panel.js` and `background.js` see it.

> **Decision point:** if `TABLE_STATES` is panel.js-only and background.js can't see it, the cleanest fix is to move the `TABLE_STATES` object + `getStateConfig` into `note-fields.js` (the existing shared module loaded by both contexts), then delete the duplicate from `panel.js` and have panel.js consume it via the same UMD global. This is a refactor but it's the right boundary — `note-fields.js` already holds `TABLE_MAP` and `detectTable`, so `TABLE_STATES` belongs there too. If this path is needed, do it as a sub-task before proceeding: move the object, run `node --test tests/` to confirm nothing broke, commit, then continue with Step 1.

- [ ] **Step 3: Manual verification**

Reload the extension. In the List tab, select **Infinity Alarms (Unassigned)**, Search, click Take on a card. Confirm: ticket is assigned to you, state → In Progress (2). This verifies the incident path still works (regression check — spec §4e).

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat(background): takeTicket uses per-table workStartState

Replaces hardcoded state:'2' with TABLE_STATES[localTable].workStartState.
Incident behavior unchanged (2). Problem now moves to 102 (Assess),
change_request to -1 (Implement). Also accepts msg.table from caller
(authoritative sys_class_name) instead of relying on detectTable."
```

---

## Task 5: Wire `data-table` on Take links + read it in the click handler

**Why:** the panel-side Take click handler must forward the table to `takeTicket`, and the post-Take badge update must use per-table labels. Spec §4d. Without this, Task 4's machinery is silently bypassed.

**Files:**
- Modify: `chrome-extension/panel.js:1255` (render Take link with `data-table`)
- Modify: `chrome-extension/panel.js:511-565` (click handler reads `dataset.table`, generalized badge update)

- [ ] **Step 1: Add `data-table` to the Take link in the render loop**

In `chrome-extension/panel.js`, find line 1255 (inside the `btn-list` render loop):

```js
      if (infinityMode) html += `<a class="take-link" data-ticket="${esc(displayVal(t.number))}">Take</a>`;
```

Change to:

```js
      if (infinityMode || germanMode) html += `<a class="take-link" data-ticket="${esc(displayVal(t.number))}" data-table="${esc(lTable)}">Take</a>`;
```

`lTable` is already computed at line 1217 (now `resolveTable(t)` from Task 3). `germanMode` will be added in Task 6 — for now, if `germanMode` is undefined this line throws. **Add the `germanMode` declaration now** to unblock: find line 1201 (`let infinityMode = ...`) and add immediately below it:

```js
  let germanMode = (document.getElementById("list-preset").value === "german-ns");
```

- [ ] **Step 2: Update the click handler to read `dataset.table` and forward it**

In `chrome-extension/panel.js`, find the take-link click handler (line 511). The current handler reads only `e.target.dataset.ticket`. Replace lines 511-565 (the entire `if (e.target.classList.contains("take-link")) { ... return; }` block).

Current block starts:
```js
  if (e.target.classList.contains("take-link")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    if (!ticket) return;
    const link = e.target;
```

Replace the whole block with:

```js
  if (e.target.classList.contains("take-link")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    const table = e.target.dataset.table;   // authoritative sys_class_name (resolveTable at render)
    if (!ticket) return;
    const link = e.target;
    const originalText = link.textContent;
    link.classList.add("disabled");
    link.textContent = "Taking...";
    send({ action: "takeTicket", ticketNumber: ticket, table: table })
      .then(() => {
        // Replace link with a static "✓ Taken" marker
        const taken = document.createElement("span");
        taken.className = "taken-marker";
        taken.textContent = "✓ Taken";
        link.replaceWith(taken);
        // Refresh this card's state badge to the table's work-started state.
        // resolveTable at render gave us `table` (sys_class_name); use it to
        // look up the correct label + badge class instead of the old hardcoded
        // "In Progress" / state-active (incident-only).
        const card = taken.closest(".ticket-card");
        if (card && table) {
          const cfg = getStateConfig(table);
          const ws = cfg.workStartState;
          const badge = card.querySelector(".state-badge");
          if (badge && ws) {
            badge.className = "state-badge " + (cfg.classes[ws] || "state-active");
            badge.textContent = cfg.labels[ws] || "In Progress";
          }
          // Assigned to: find the field line labeled "Assigned to" and append a "You" badge
          const fields = card.querySelectorAll(".ticket-field");
          for (const f of fields) {
            if (/^Assigned to:/i.test(f.textContent.trim())) {
              if (!f.querySelector(".take-you")) {
                const youBadge = document.createElement("span");
                youBadge.className = "take-you";
                youBadge.style.marginLeft = "6px";
                youBadge.textContent = "You";
                f.appendChild(youBadge);
              }
              break;
            }
          }
        }
      })
      .catch((err) => {
        link.classList.remove("disabled");
        link.textContent = originalText;
        link.insertAdjacentHTML("afterend", '<span class="inline-err error" style="margin-left:8px">' + userFacingError(err.message) + '</span>');
        // Clean up the error after a few seconds so retry is clean
        setTimeout(() => {
          const next = link.nextElementSibling;
          if (next && next.classList.contains("inline-err")) next.remove();
        }, 4000);
      });
    return;
  }
```

- [ ] **Step 3: Manual verification**

Reload extension. List tab → Infinity Alarms → Search → Take a card. Confirm: badge updates to "In Progress" / `state-active`, "You" badge appears. (Incident path — regression.) The German queue path can't be tested until Task 6, but the wiring is now in place.

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat(panel): forward data-table through Take click handler

Take links now carry data-table (sys_class_name from resolveTable). The
click handler reads it and passes it to takeTicket, so per-table
workStartState actually applies. Post-Take badge update generalized to use
TABLE_STATES labels/classes instead of hardcoded 'In Progress'/'state-active'."
```

---

## Task 6: Add the German Non-Standard Queue preset

**Why:** the new queue option — hardcoded UNION query, new dropdown option, `germanMode` flag, state-leak-safe wiring. Spec §2.

**Files:**
- Modify: `chrome-extension/panel.html:445` (add `<option>`)
- Modify: `chrome-extension/panel.js` (add `GERMAN_NS_QUEUE_QUERY`, update preset change handler, queue branch in `btn-list`)

- [ ] **Step 1: Add the dropdown option**

In `chrome-extension/panel.html`, find line 445 (the `infinity-alarms` option, last in the `#list-preset` `<select>`):

```html
        <option value="infinity-alarms">Infinity Alarms (Unassigned)</option>
```

Add immediately after it:

```html
        <option value="german-ns">German Non-Standard Queue</option>
```

- [ ] **Step 2: Add the `GERMAN_NS_QUEUE_QUERY` constant**

In `chrome-extension/panel.js`, immediately after the `PRESETS` object closes (line 1173, after the closing `};` of `PRESETS`), add:

```js
/**
 * German Non-Standard Support queue.
 * Source: task_list.do URL provided by user (2026-07-17).
 * UNION of 3 sub-queries on the `task` base table
 * (group sys_id 9ed0c8781b4b3954ee7b1131b24bcb9d):
 *   1. group tasks, excluding ebonding stage/messages tables
 *   2. change_task records in the group
 *   3. PRB- or TASK-numbered records in the group
 * All sub-queries require active=true and assigned_toISEMPTY (unassigned).
 *
 * NOTE: `task` here is the QUERY target (SNOW base table that accepts the
 * UNION). Each returned record carries its own sys_class_name (task,
 * change_task, problem) which drives per-card rendering (resolveTable) and
 * Take semantics — do not confuse the query table with the per-record class.
 *
 * Trailing ^EQ is intentionally NOT included (the source URL doesn't have
 * it). If the query unexpectedly returns 0 results, the ISEMPTY clauses may
 * need a bare ^EQ terminator on this instance — see the infinity-alarms
 * comment above (lines 1167-1171) for the same quirk. First debugging knob.
 */
const GERMAN_NS_QUEUE_QUERY =
  "assignment_group=9ed0c8781b4b3954ee7b1131b24bcb9d^active=true^assigned_toISEMPTY^parentISEMPTY^sys_class_name!=u_ebonding_stage^sys_class_name!=u_ebonding_messages" +
  "NQassignment_group=9ed0c8781b4b3954ee7b1131b24bcb9d^active=true^sys_class_name=change_task^assigned_toISEMPTY" +
  "NQassignment_group=9ed0c8781b4b3954ee7b1131b24bcb9d^active=true^numberSTARTSWITHPRB^ORnumberSTARTSWITHTASK^assigned_toISEMPTY";
```

- [ ] **Step 3: Replace the preset change handler with queue-aware version**

In `chrome-extension/panel.js`, find lines 1186-1191 (the `list-preset` change handler):

```js
document.getElementById("list-preset").addEventListener("change", (e) => {
  const preset = e.target.value;
  if (preset && PRESETS[preset]) {
    document.getElementById("list-query").value = PRESETS[preset];
  }
});
```

Replace with:

```js
document.getElementById("list-preset").addEventListener("change", (e) => {
  const preset = e.target.value;
  if (preset === "german-ns") {
    // Queue mode: query the task base table with the hardcoded UNION.
    // #list-table is used by the queue branch of btn-list (single call,
    // no fan-out). germanMode is read by btn-list to show the Take link.
    document.getElementById("list-query").value = GERMAN_NS_QUEUE_QUERY;
    document.getElementById("list-table").value = "task";
    return;
  }
  // Any other preset: My Tickets mode (fan-out over incident/change_request/
  // problem — added in Task 7). Reset #list-table to incident so queue-mode
  // state doesn't leak into the next My Tickets search. btn-list's fan-out
  // ignores this value, but keeping it consistent avoids confusion if the
  // fan-out is ever reverted.
  document.getElementById("list-table").value = "incident";
  if (preset && PRESETS[preset]) {
    document.getElementById("list-query").value = PRESETS[preset];
  }
});
```

- [ ] **Step 4: Add the queue branch to `btn-list`**

This is the structural change. In `chrome-extension/panel.js`, the `btn-list` click handler starts at line 1193 and currently does a single `send({action:"listTickets", ...})`. We add a queue branch that short-circuits the fan-out. Task 7 will add the fan-out for the My Tickets branch.

Find line 1204 (the single send call):

```js
    const tickets = await send({ action: "listTickets", table, query, limit, includeCi: true });
```

Wrap it in a conditional. Replace lines 1193-1214 (the handler from `addEventListener` through the `if (!tickets.length)` check). Current code:

```js
document.getElementById("btn-list").addEventListener("click", async () => {
  const table = document.getElementById("list-table").value;
  let query = document.getElementById("list-query").value.trim();
  const limit = parseInt(document.getElementById("list-limit").value) || 10;
  // Flag for the card-rendering loop: show the Take link only when the Infinity
  // preset is the active filter. Detected by the dropdown selection, not the query
  // string, because the Infinity query is now a plain static string (like every
  // other preset) — there's no marker to intercept.
  let infinityMode = (document.getElementById("list-preset").value === "infinity-alarms");
  let germanMode = (document.getElementById("list-preset").value === "german-ns");
  showLoading(listResult);
  try {
    const tickets = await send({ action: "listTickets", table, query, limit, includeCi: true });
    // Sort: user-selected key + direction (default Case ID desc). Comparator
    // routes all field access through displayVal/valueVal/parseUpdatedOn so the
    // {value, display_value} objects from sysparm_display_value=all don't NaN.
    const sortKey = document.getElementById("list-sort-key").value;
    const sortDir = document.getElementById("list-sort-dir").value;
    tickets.sort((a, b) => compareTickets(a, b, sortKey, sortDir));
    if (!tickets.length) {
      listResult.innerHTML = '<div class="ticket-field" style="padding:8px">No tickets found</div>';
      return;
    }
```

> **Note:** the `let germanMode = ...` line on line 1201 was added in Task 5 Step 1 as a forward declaration. If Task 5 was completed, that line already exists — do not duplicate it. If you're reading this task in isolation, the line is shown above for completeness.

Replace with (note: this introduces the queue branch and keeps the My Tickets branch as the existing single-call for now — Task 7 will replace the My Tickets branch with the fan-out):

```js
document.getElementById("btn-list").addEventListener("click", async () => {
  const table = document.getElementById("list-table").value;
  let query = document.getElementById("list-query").value.trim();
  const limit = parseInt(document.getElementById("list-limit").value) || 10;
  // Flags for the card-rendering loop: show the Take link when the active
  // preset is a queue-style filter (Infinity alarms or German Non-Standard).
  // Detected by dropdown selection, not query string — both queue queries are
  // plain static strings with no marker to intercept.
  let infinityMode = (document.getElementById("list-preset").value === "infinity-alarms");
  let germanMode = (document.getElementById("list-preset").value === "german-ns");
  showLoading(listResult);
  try {
    let tickets;
    if (germanMode) {
      // Queue mode: single call against the task base table. The UNION query
      // returns mixed sys_class_name records in one response — no fan-out.
      tickets = await send({ action: "listTickets", table: "task", query, limit, includeCi: true });
    } else {
      // My Tickets mode: single call for now (fan-out added in Task 7).
      // When Task 7 lands this branch becomes a Promise.allSettled over
      // [incident, change_request, problem].
      tickets = await send({ action: "listTickets", table, query, limit, includeCi: true });
    }
    // Sort: user-selected key + direction (default Case ID desc). Comparator
    // routes all field access through displayVal/valueVal/parseUpdatedOn so the
    // {value, display_value} objects from sysparm_display_value=all don't NaN.
    const sortKey = document.getElementById("list-sort-key").value;
    const sortDir = document.getElementById("list-sort-dir").value;
    tickets.sort((a, b) => compareTickets(a, b, sortKey, sortDir));
    if (!tickets.length) {
      listResult.innerHTML = '<div class="ticket-field" style="padding:8px">No tickets found</div>';
      return;
    }
```

- [ ] **Step 5: Manual verification of the queue**

Reload extension. List tab → select **German Non-Standard Queue** → Search. Expected: list of unassigned task/change_task/problem records from the German group, each with a Take link. State badges should render correctly per `sys_class_name` (a `change_task` should show task-style labels, not incident labels).

If the result is empty and you expected tickets, try appending `^EQ` to each `assigned_toISEMPTY` clause in `GERMAN_NS_QUEUE_QUERY` (spec §5d). First debugging knob.

Click Take on a `problem` record → confirm it's assigned to you and state moves to Assess (102). Click Take on a `change_task` → state moves to Work in Progress (2).

- [ ] **Step 6: Verify state-leak reset (spec testing plan #12)**

With the queue results still showing, switch the dropdown back to **My Open Tickets** and click Search. Confirm the search queries `incident` (results are your incidents, not task-table records). This verifies the Task 6 Step 3 reset.

- [ ] **Step 7: Commit**

```bash
git add chrome-extension/panel.html chrome-extension/panel.js
git commit -m "feat(panel): add German Non-Standard Queue preset

Hardcoded UNION query against the task base table (group 9ed0c8...). New
dropdown option. germanMode flag shows Take link on every queue card.
Preset change handler resets #list-table to incident when leaving queue
mode to prevent state leak (testing plan #12)."
```

---

## Task 7: Multi-table fan-out for My Tickets mode

**Why:** the core feature — show CHG and PRB alongside INC. Spec §1. Replaces the single-call My Tickets branch (left in place by Task 6) with a `Promise.allSettled` fan-out.

**Files:**
- Modify: `chrome-extension/panel.js` (the My Tickets branch of `btn-list`, added in Task 6 Step 4)

- [ ] **Step 1: Replace the My Tickets single-call with fan-out**

In `chrome-extension/panel.js`, find the `btn-list` handler's My Tickets branch (the `else` clause added in Task 6 Step 4):

```js
    } else {
      // My Tickets mode: single call for now (fan-out added in Task 7).
      // When Task 7 lands this branch becomes a Promise.allSettled over
      // [incident, change_request, problem].
      tickets = await send({ action: "listTickets", table, query, limit, includeCi: true });
    }
```

Replace with:

```js
    } else {
      // My Tickets mode: fan out to incident + change_request + problem in
      // parallel, then merge. Promise.allSettled (not Promise.all) so a 400
      // or ACL denial on one table doesn't lose the others — failed tables
      // are surfaced as an inline warning above the results (spec §5a).
      // includeCi:true on each call triggers 3 bulk-CI fetches (one per table)
      // because CI enrichment runs inside listTickets in the background. This
      // is acceptable — sys_ids are disjoint across tables, no duplicate work
      // (spec §1, corrected cost claim).
      const MY_TICKETS_TABLES = ["incident", "change_request", "problem"];
      const settled = await Promise.allSettled(
        MY_TICKETS_TABLES.map(t => send({ action: "listTickets", table: t, query, limit, includeCi: true }))
      );
      const failed = [];
      tickets = [];
      for (let i = 0; i < settled.length; i++) {
        if (settled[i].status === "fulfilled") {
          tickets = tickets.concat(settled[i].value);
        } else {
          failed.push(MY_TICKETS_TABLES[i]);
        }
      }
      if (failed.length) {
        // Prepend a warning to the result box after render. Stored on a
        // closure variable so the render section below can include it.
        pendingTableWarning = "Some tables failed to load: " + failed.join(", ");
      } else {
        pendingTableWarning = null;
      }
    }
```

Declare `pendingTableWarning` at the top of the handler (near the `tickets` declaration, before the `if (germanMode)` branch):

```js
    let tickets;
    let pendingTableWarning = null;
```

Then, after the existing `listResult.innerHTML = html;` line (end of the render loop, around line 1263), add the warning prepend:

```js
    listResult.innerHTML = html;
    if (pendingTableWarning) {
      const warn = document.createElement("div");
      warn.className = "ticket-field";
      warn.style.cssText = "padding:8px;color:var(--text-muted);border-bottom:1px solid var(--border)";
      warn.textContent = "⚠ " + pendingTableWarning;
      listResult.insertBefore(warn, listResult.firstChild);
    }
```

- [ ] **Step 2: Manual verification**

Reload extension. List tab → **My Open Tickets** → Search. Expected: a merged list of your INC + CHG + PRB tickets, sorted by the selected sort key. Confirm at least one CHG and one PRB appear (if you have any assigned).

Test **My Open Alarms** → observe whether CHG/PRB return empty cleanly or surface the `pendingTableWarning` (spec §5j — `contact_type=Alarm` may 400 on non-incident tables). If they 400 and the warning is noisy, decide whether to special-case (defer this decision to observed behavior; document it).

Test partial failure: if you can, temporarily make one table unreadable (not always possible without admin help) — otherwise trust the `allSettled` wiring and the inline warning code path.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat(panel): fan out My Tickets to incident + change_request + problem

Merged multi-table view via Promise.allSettled. Failed tables surface an
inline warning; successful tables still render. 3 bulk-CI fetches (one per
table) accepted as cheap — sys_ids disjoint, no duplicate work (spec §1)."
```

---

## Task 8: Bucket-sort by state on merged lists

**Why:** raw `parseInt(state.value)` is meaningless across tables (incident 1-8, change_request -5 to 4, problem 101-106). On a merged list, "state asc" groups by table, not by lifecycle. Spec §5i. Pure helper change, testable.

**Files:**
- Modify: `chrome-extension/panel.js:350-355` (the `key === "state"` branch of `compareTickets`)
- Modify: `tests/multi-table.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/multi-table.test.js`:

```js
test("stateBucketRank returns 0 for new, 1 for active, 2 for resolved, 3 for closed", () => {
  assert.equal(helpers.stateBucketRank("state-new"), 0);
  assert.equal(helpers.stateBucketRank("state-active"), 1);
  assert.equal(helpers.stateBucketRank("state-resolved"), 2);
  assert.equal(helpers.stateBucketRank("state-closed"), 3);
});

test("stateBucketRank returns 4 (sorts last) for unknown class", () => {
  assert.equal(helpers.stateBucketRank(""), 4);
  assert.equal(helpers.stateBucketRank("state-unknown"), 4);
});

test("compareTickets state-asc buckets cross-table: CHG active before PRB new", () => {
  // change_request state -1 (Implement) -> class state-active -> bucket 1
  const chg = { number: "CHG0010001", state: { value: "-1", display_value: "Implement" }, priority: "1" };
  // problem state 101 (New) -> class state-new -> bucket 0
  // Wait: ascending order means new (0) before active (1). So PRB-new sorts
  // before CHG-active on asc. Verify the bucket logic actually interleaves
  // rather than grouping all CHGs (negative ints) first.
  const prb = { number: "PRB0010001", state: { value: "101", display_value: "New" }, priority: "1" };
  // asc: PRB (new, bucket 0) should come before CHG (active, bucket 1)
  const result = helpers.compareTickets(prb, chg, "state", "asc");
  assert.ok(result < 0, "PRB-new should sort before CHG-active on state asc");
});

test("compareTickets state-asc does NOT group all CHGs first (the bug it fixes)", () => {
  // Before the fix: parseInt(-1) < parseInt(101), so CHG always sorts before
  // PRB regardless of lifecycle bucket. After the fix: a CHG in resolved (0)
  // sorts AFTER a PRB in new (101), because resolved-bucket(2) > new-bucket(0).
  const chgResolved = { number: "CHG0010002", state: { value: "0", display_value: "Review" }, priority: "1" };
  const prbNew = { number: "PRB0010002", state: { value: "101", display_value: "New" }, priority: "1" };
  // asc: PRB-new (bucket 0) before CHG-resolved (bucket 2)
  const result = helpers.compareTickets(prbNew, chgResolved, "state", "asc");
  assert.ok(result < 0, "PRB-new should sort before CHG-resolved (bucket order, not raw int)");
});
```

Also update the export hook to include `stateBucketRank` and `compareTickets`:

```js
if (typeof module !== "undefined" && module.exports) {
  module.exports = { TABLE_STATES, getStateConfig, resolveTable, stateBucketRank, compareTickets };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/multi-table.test.js`
Expected: FAIL — the last two tests fail because `compareTickets` still uses raw `parseInt` (CHG-resolved `-1` sorts before PRB-new `101` — wrong). `stateBucketRank` is also not exported/defined.

- [ ] **Step 3: Add `stateBucketRank` helper and update `compareTickets`**

In `chrome-extension/panel.js`, immediately before `compareTickets` (line 319), add:

```js
// stateBucketRank: maps a TABLE_STATES class string to a lifecycle bucket
// for cross-table state sorting. Raw parseInt(state.value) is meaningless on
// a merged list because the three tables' state ranges don't overlap
// (incident 1-8, change_request -5..4, problem 101-106) — "state asc" would
// group every CHG (negative) first, then INC, then PRB. Bucket-sorting by
// the badge class (new/active/resolved/closed) gives a meaningful lifecycle
// order across tables. Unknown classes sort last (bucket 4).
const STATE_BUCKET_RANK = { "state-new": 0, "state-active": 1, "state-resolved": 2, "state-closed": 3 };
function stateBucketRank(classStr) {
  return STATE_BUCKET_RANK[classStr] != null ? STATE_BUCKET_RANK[classStr] : 4;
}
```

Then replace the `key === "state"` branch in `compareTickets` (lines 350-355). Current:

```js
  if (key === "state") {
    const sa = parseInt(valueVal(a.state), 10) || 0;
    const sb = parseInt(valueVal(b.state), 10) || 0;
    if (sa !== sb) return (sa - sb) * mult;
    return parsePriority(a.priority) - parsePriority(a.priority); // tiebreak: priority asc
  }
```

Replace with:

```js
  if (key === "state") {
    // Bucket-sort by lifecycle (new < active < resolved < closed) using the
    // badge class from TABLE_STATES. Falls back to the raw value within a
    // bucket. This makes "state asc" meaningful on merged cross-table lists;
    // raw parseInt would group all CHGs (negative) before INCs before PRBs.
    const ra = stateBucketRankForTicket(a);
    const rb = stateBucketRankForTicket(b);
    if (ra !== rb) return (ra - rb) * mult;
    const sa = parseInt(valueVal(a.state), 10) || 0;
    const sb = parseInt(valueVal(b.state), 10) || 0;
    if (sa !== sb) return (sa - sb) * mult;
    return parsePriority(a.priority) - parsePriority(b.priority); // tiebreak: priority asc
  }
```

Add the `stateBucketRankForTicket` helper immediately after `stateBucketRank`:

```js
// Resolves a ticket to its state bucket by looking up its table's class for
// the current state value. Table comes from sys_class_name (authoritative) or
// detectTable fallback — same resolution as the render loop (resolveTable).
function stateBucketRankForTicket(t) {
  const tbl = resolveTable(t);
  const cfg = getStateConfig(tbl);
  const sv = valueVal(t.state);
  const cls = cfg.classes[sv];
  return stateBucketRank(cls);
}
```

Update the export hook (as shown in Step 1) to include `stateBucketRank` and `compareTickets`.

> **Note on the `sort-verify.js` reference copy:** the comment at `panel.js:318` says `compareTickets` is "byte-identical (minus this preamble) to the reference copy in `tests/sort-verify.js`." After this change, that's no longer true — `compareTickets` now calls `stateBucketRankForTicket` which doesn't exist in `sort-verify.js`. Update `tests/sort-verify.js`'s copy of `compareTickets` to match (add the same `stateBucketRank` + `stateBucketRankForTicket` helpers there), OR delete the stale "byte-identical" comment at `panel.js:318`. The latter is simpler and the characterization script doesn't exercise cross-table sorting — prefer deleting the comment and adding a note that `sort-verify.js` is the pre-merge characterization baseline.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/multi-table.test.js`
Expected: PASS — all tests green, including the two new cross-table bucket-sort tests.

- [ ] **Step 5: Update the stale "byte-identical" comment**

In `chrome-extension/panel.js`, find line 318 (the preamble above `compareTickets`):

```js
// Byte-identical (minus this preamble) to the reference copy in tests/sort-verify.js.
```

Change to:

```js
// Note: tests/sort-verify.js holds the pre-merge (single-table) characterization
// baseline. The state branch here adds cross-table bucket-sorting (stateBucketRank)
// that sort-verify.js does not exercise — it's a historical reference, not a mirror.
```

- [ ] **Step 6: Manual verification**

Reload extension. List tab → **My Open Tickets** → set Sort to **State**, Order **Ascending** → Search. Expected: tickets are interleaved by lifecycle (New → In Progress/Active → Resolved → Closed), NOT grouped by table. Without the fix, all CHGs (negative state ints) would appear first.

- [ ] **Step 7: Commit**

```bash
git add chrome-extension/panel.js tests/multi-table.test.js
git commit -m "fix(panel): bucket-sort by state across tables on merged lists

Raw parseInt(state.value) is meaningless cross-table (incident 1-8,
change_request -5..4, problem 101-106). Now sorts by lifecycle bucket
(new < active < resolved < closed) via TABLE_STATES badge class, then raw
value within bucket. Fixes 'state asc' grouping all CHGs before INCs
before PRBs. Spec §5i."
```

---

## Task 9: Run the full test suite + final regression check

**Why:** confirm no pre-existing tests broke and all new tests pass together.

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `node --test tests/`
Expected: all test files pass. If `tests/note-fields.test.js` has the pre-existing `fields.comments` assertion (line 14-18) and it fails, that's a pre-existing issue unrelated to this work — do not fix it here (out of scope, noted in File Structure section). Confirm it was failing before this work too (`git stash && node --test tests/note-fields.test.js && git stash pop` or just check git history).

- [ ] **Step 2: Full manual regression pass (spec testing plan items 1-12)**

Reload the extension and work through the spec's testing plan in `docs/superpowers/specs/2026-07-17-multi-table-and-german-queue-design.md`:

1. ✅ My Tickets — `my-open`: INC + CHG + PRB merged, sorted, correct state badges per table.
2. ✅ My Tickets — `my-open-alarms`: INC alarms present; CHG/PRB empty or 400 (document observed behavior per §5j).
3. ✅ My Tickets — partial failure: if you can simulate, confirm inline warning + other tables render.
4. ✅ Queue — `german-ns`: mixed task/change_task/problem records, correct badges, Take link on every card.
5. ✅ Queue — Take: problem → 102 (Assess), change_task → 2, task → 2.
6. ✅ Queue — 0 results: if empty unexpectedly, try `^EQ` (§5d).
7. ✅ Infinity queue regression: Take → incident In Progress (2).
8. ✅ State badge after Take: per-table labels match TABLE_STATES.
9. ✅ State sort on merged list: interleaved by bucket, not grouped by table.
10. ✅ `my-open-alarms` cross-table: observed behavior documented.
11. ✅ `change_task` state model: sys_choice probe confirmed values used in TABLE_STATES.
12. ✅ Queue-mode state leak: switching german-ns → my-open queries incident.

- [ ] **Step 3: No commit (verification only)**

If all pass, the feature is complete. If any fail, fix the specific task that the failing test points to and re-run.

---

## Self-Review

**Spec coverage check** (each spec section → task):

- §1 (Merged multi-table query) → **Task 7** (fan-out), **Task 2** (`sys_class_name` field)
- §2 (German queue) → **Task 6** (constant, dropdown, wiring, queue branch)
- §3a (sys_class_name-first rendering) → **Task 3** (`resolveTable`)
- §3b (change_task in TABLE_STATES) → **Task 1** (entry added, sys_choice probe in Step 3)
- §3c (card chrome) → covered by existing render loop + Task 3's `resolveTable` (no separate task needed — the loop already handles missing CI gracefully)
- §4a (workStartState per table) → **Task 1** (data)
- §4b (takeTicket needs table) → **Task 5** (`data-table` wiring) + **Task 4** (`msg.table` accepted)
- §4c (localTable shadow) → **Task 4** Step 1
- §4d (click handler reads dataset.table, generalized badge) → **Task 5** Step 2
- §4e (no Infinity regression) → **Task 9** Step 2 item 7
- §5a (allSettled + inline warning) → **Task 7**
- §5b (3× API calls, rate limits) → documented in Task 7 code comment, no action
- §5c (no dedup needed) → no action (structural guarantee)
- §5d (queue 0 results, ^EQ knob) → **Task 6** Step 5 + code comment
- §5e (Take fails inline) → existing behavior, no action
- §5f (no auto-refresh) → no action (matches existing)
- §5g (change_task state edge case) → mitigated by Task 1 Step 3 probe
- §5h (my-resolved empty for CHG/PRB) → no action (accepted)
- §5i (state bucket-sort) → **Task 8**
- §5j (contact_type=Alarm 400) → **Task 7** Step 2 (observe + document)
- §5k (id-desc tiebreak nit) → no action (documented in spec)

All spec sections covered. No gaps.

**Placeholder scan:** no TBD/TODO. Every code step shows complete code. The "Decision point" in Task 4 Step 2 is a genuine branch (depends on whether TABLE_STATES is already in background.js scope) — it's not a placeholder, it's a verified-then-acted fork with explicit instructions for both paths.

**Type/name consistency:** `resolveTable`, `stateBucketRank`, `stateBucketRankForTicket`, `workStartState`, `germanMode`, `GERMAN_NS_QUEUE_QUERY`, `pendingTableWarning`, `localTable` — all used consistently across tasks. `compareTickets` signature unchanged (`(a, b, key, dir)`). Export hook grows incrementally (Task 1 → Task 3 → Task 8) and the final hook includes all five exports.

**Task ordering:** Tasks 1-3 are pure helpers + tests (safe, isolated). Tasks 4-5 are the Take pipeline. Task 6 adds the queue. Task 7 adds the fan-out (the headline feature). Task 8 is the sort fix. Task 9 is verification. Each task produces a working, committed state — the extension loads and functions after every task.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-17-multi-table-and-german-queue.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
