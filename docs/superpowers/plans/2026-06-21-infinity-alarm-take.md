# Infinity Alarm Take Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Infinity Alarms (Unassigned)" List preset that fetches new unassigned Avaya Infinity Platform alarm incidents, with a per-ticket "Take" action that assigns each to the current user and moves it to In Progress.

**Architecture:** Three new pieces ride on the existing panel→background→page(snowFetch) flow: (1) a `getInfinityFilterParams` message that resolves the Service Model column name and the assignment-group sys_id in one page round-trip and caches both in the service worker; (2) a `takeTicket` message that PATCHes `assigned_to` + `state=2`; (3) panel-side preset + Take-link wiring. No new content scripts.

**Tech Stack:** Chrome Extension Manifest V3, ServiceNow REST Table API (`/api/now/table/`), `snowFetch()` injected into the SNOW page's MAIN world. Vanilla JS (no build step, no external deps).

**Testing note:** This project has no automated test harness (per `CLAUDE.md`: "No tests currently"). The feature depends on a live authenticated SNOW session and the page's `g_ck` token, which cannot be meaningfully unit-tested without a mock instance. Tasks therefore follow the spec's manual verification plan rather than a TDD loop. Each task still ends in a commit so changes are bisectable.

**Spec:** `docs/superpowers/specs/2026-06-21-infinity-alarm-take-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `chrome-extension/background.js` | Service worker orchestration | Add `getInfinityFilterParamsInPage()` page function + `getInfinityFilterParams` / `takeTicket` message handlers + two cache vars |
| `chrome-extension/panel.js` | Sidebar UI logic | Add preset marker, intercept in list handler, render `.take-link`, delegated Take click handler |
| `chrome-extension/panel.html` | Static UI | Add one `<option>` to `#list-preset` |
| `chrome-extension/manifest.json` | Extension metadata | Bump version 2.8 → 2.9 |
| `CHANGELOG.md` | Release notes | Add `## [2.9]` section |

All new behavior lives in existing files following established patterns (page function → `injectAndExec` → message routing; delegated click handler with class selectors). No new files.

---

## Task 1: Bump version and add CHANGELOG entry

**Files:**
- Modify: `chrome-extension/manifest.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump manifest version**

In `chrome-extension/manifest.json`, change the version line:

```json
"version": "2.9",
```

(was `"2.8"`)

- [ ] **Step 2: Add CHANGELOG entry**

In `CHANGELOG.md`, insert a new section directly under the `# Changelog` header line (above `## [2.8]`):

```markdown
## [2.9] - 2026-06-21

### Added
- **Infinity Alarms (Unassigned) preset** — New List tab filter that pulls all active, New, unassigned incidents in the "Avaya Infinity Platform" assignment group with Service Model = Event Management. Reproduces the standard Infinity alarm triage filter in one click.
- **Take action on Infinity alarm cards** — Each Infinity-preset ticket card has a "Take" link that assigns the incident to you and moves it to In Progress (state 2). Shows a "✓ Taken" state and a "You" assignee badge on success.
- `getInfinityFilterParams` message action in background.js — resolves the Service Model column name (via `sys_dictionary`) and the assignment-group sys_id (via `sys_user_group`) in a single page round-trip, cached for the session. Avoids hardcoding internal field names and the display-name dot-walk fragility.
- `takeTicket` message action in background.js — assigns an incident to the current user and sets state to In Progress.
```

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/manifest.json CHANGELOG.md
git commit -m "chore: bump to v2.9, add Infinity Alarm Take changelog"
```

---

## Task 2: Add the Infinity preset option to the UI

**Files:**
- Modify: `chrome-extension/panel.html:433-439` (the `#list-preset` `<select>`)

- [ ] **Step 1: Add the option**

In `chrome-extension/panel.html`, find the `#list-preset` select (the `<option value="awaiting">...` line is the last child). Add a new option **after** the awaiting option:

```html
        <option value="awaiting">Awaiting User Info</option>
        <option value="infinity-alarms">Infinity Alarms (Unassigned)</option>
```

- [ ] **Step 2: Verify it renders**

Load the extension (`chrome://extensions` → reload unpacked), open the sidebar, confirm "Infinity Alarms (Unassigned)" appears as the last item in the List tab Filter dropdown. (Selecting it and clicking Search will do nothing useful yet — that's expected; the marker handler lands in Task 5.)

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/panel.html
git commit -m "feat: add Infinity Alarms (Unassigned) option to List preset dropdown"
```

---

## Task 3: Add `getInfinityFilterParams` page function + message handler in background.js

**Files:**
- Modify: `chrome-extension/background.js` (add page function near `getUserIdInPage` ~line 280; add message routing + cache near the other message handlers)

- [ ] **Step 1: Add the cache variables**

Near the top of `chrome-extension/background.js`, just **after** the `OCD_AUTH` const block (after line 19), add two module-level cache variables:

```js
// Infinity Alarms filter — resolved once per session, cached for subsequent runs.
// Set by getInfinityFilterParams; cleared only when the service worker is torn down.
var cachedServiceModelField = null;
var cachedAssignmentGroupSysId = null;
```

- [ ] **Step 2: Add the page function**

In `chrome-extension/background.js`, add this new page function **immediately after** the existing `getUserIdInPage` function (ends ~line 288). It runs both queries via `Promise.all` inside a single `injectAndExec` call so it costs one message, not two:

```js
function getInfinityFilterParamsInPage() {
  // Resolve the Service Model column name (by label) and the assignment-group
  // sys_id (by name) in parallel, inside one page round-trip.
  var smPromise = snowFetch("GET", "/api/now/table/sys_dictionary?sysparm_query=name=incident^column_label=Service Model&sysparm_fields=element&sysparm_limit=1&sysparm_display_value=false")
    .then(function(d) {
      var rows = d.result || [];
      if (!rows.length) throw new Error("Could not locate a 'Service Model' column on the incident table (sys_dictionary had no match). The Infinity Alarms filter cannot run.");
      var el = rows[0].element;
      return typeof el === "object" ? (el.value || el.display_value) : el;
    });
  var agPromise = snowFetch("GET", "/api/now/table/sys_user_group?sysparm_query=name=Avaya Infinity Platform&sysparm_fields=sys_id&sysparm_limit=1&sysparm_display_value=false")
    .then(function(d) {
      var rows = d.result || [];
      if (!rows.length) throw new Error("Could not locate the 'Avaya Infinity Platform' assignment group. The Infinity Alarms filter cannot run.");
      var id = rows[0].sys_id;
      return typeof id === "object" ? (id.value || id.display_value) : id;
    });
  return Promise.all([smPromise, agPromise]).then(function(results) {
    return { smField: results[0], agSysId: results[1] };
  });
}
```

- [ ] **Step 3: Add the message handler**

In `chrome-extension/background.js`, inside `handleMessage` (the `async function handleMessage(msg)` that starts ~line 462), add a new branch **before** the `// All other actions require a ServiceNow tab` line (currently ~line 593). Placing it there means the SNOW tab is found and `injectAndExec` is wired up, but we don't waste a `detectTable` call on a message with no ticket number:

```js
  if (msg.action === "getInfinityFilterParams") {
    // Serve from cache if already resolved this session
    if (cachedServiceModelField && cachedAssignmentGroupSysId) {
      return { smField: cachedServiceModelField, agSysId: cachedAssignmentGroupSysId };
    }
    const tab = await findSnowTab();
    const params = await injectAndExec(tab.id, getInfinityFilterParamsInPage, []);
    cachedServiceModelField = params.smField;
    cachedAssignmentGroupSysId = params.agSysId;
    return params;
  }
```

**Note on placement:** This branch must come **before** `const tab = await findSnowTab();` / `const table = detectTable(...)` block at line ~594, because `detectTable(msg.ticketNumber || "")` would run on an empty ticket number for this message. By returning early above that block, we do our own `findSnowTab` and skip `detectTable`.

- [ ] **Step 4: Verify the message is reachable**

Reload the extension. In the sidebar's DevTools console (right-click sidebar → Inspect), run:

```js
chrome.runtime.sendMessage({ action: "getInfinityFilterParams" }, (r) => console.log(r));
```

Expected (logged in to SNOW): `{ ok: true, data: { smField: "<some_column>", agSysId: "<32-char sys_id>" } }`.
Expected (not logged in): `{ ok: false, error: "Please open a ServiceNow tab and log in first" }`.

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat: resolve Infinity filter params (Service Model field + assignment group sys_id)"
```

---

## Task 4: Add the `takeTicket` message handler in background.js

**Files:**
- Modify: `chrome-extension/background.js` (add a new message branch inside `handleMessage`)

- [ ] **Step 1: Add the handler**

In `chrome-extension/background.js`, inside `handleMessage`, add a new branch **after** the `getInfinityFilterParams` branch from Task 3 and **before** the `// All other actions require a ServiceNow tab` line. Note this one *does* use the shared `tab`/`table` setup below it — so instead, place it **inside** the post-`findSnowTab` section, right after the `getTicket` handler block (after the `return ticket;` at ~line 613) and before `if (msg.action === "getNoteTypes")`:

```js
  if (msg.action === "takeTicket") {
    const ticket = await injectAndExec(tab.id, getTicketInPage, [table, msg.ticketNumber]);
    if (!ticket) throw new Error("Ticket " + msg.ticketNumber + " not found");
    const sysId = typeof ticket.sys_id === "object" ? ticket.sys_id.value : ticket.sys_id;
    const userId = await injectAndExec(tab.id, getUserIdInPage, []);
    if (!userId) throw new Error("Could not determine current user");
    const result = await injectAndExec(tab.id, updateBySysIdInPage, [
      table, sysId, { assigned_to: userId, state: "2" }
    ]);
    if (result && result._error) throw new Error(result._error);
    return { success: true, assignedTo: userId };
  }
```

**Why this placement:** `takeTicket` needs a ticket number, so `detectTable(msg.ticketNumber || "")` at line ~595 is valid for it. Putting it after the `getTicket` block keeps it grouped with the other ticket-mutating actions and reuses the already-found `tab` and `table`.

The `sys_id` extraction pattern (`typeof ticket.sys_id === "object" ? ticket.sys_id.value : ticket.sys_id`) is copied verbatim from the existing `getTicket` handler (background.js:600) and `alarmClose` handler (background.js:637).

- [ ] **Step 2: Verify the message is reachable**

Reload the extension. Find a **non-critical test incident** you own or that is unassigned, note its number (e.g. `INC0000001`). In the sidebar console:

```js
chrome.runtime.sendMessage({ action: "takeTicket", ticketNumber: "INC0000001" }, (r) => console.log(r));
```

Expected: `{ ok: true, data: { success: true, assignedTo: "<your sys_id>" } }`. Verify in SNOW that the incident's Assigned to = you and State = In Progress.

⚠️ Only test against an incident you're authorized to modify. This is a real mutation.

- [ ] **Step 3: Commit**

```bash
git add chrome-extension/background.js
git commit -m "feat: takeTicket message handler (assign to self + In Progress)"
```

---

## Task 5: Wire the preset marker into the list handler in panel.js

**Files:**
- Modify: `chrome-extension/panel.js:944-954` (the `PRESETS` object) and `panel.js:963-1012` (the `btn-list` click handler)

- [ ] **Step 1: Add the preset marker**

In `chrome-extension/panel.js`, in the `PRESETS` object (~line 944), add a new entry as the **last** property (after the `"awaiting"` line):

```js
  "awaiting": "state=4^assigned_to=javascript:gs.getUserID()",
  "infinity-alarms": "__INFINITY_ALARMS__",
```

The value is an intentional marker, not a usable query — the real query is built at click time once the runtime-only parameters are resolved.

- [ ] **Step 2: Intercept the marker in the btn-list handler**

In `chrome-extension/panel.js`, the `btn-list` click handler starts at ~line 963:

```js
document.getElementById("btn-list").addEventListener("click", async () => {
  const table = document.getElementById("list-table").value;
  const query = document.getElementById("list-query").value.trim();
  const limit = parseInt(document.getElementById("list-limit").value) || 10;
  showLoading(listResult);
```

Replace those lines with a version that detects the marker, resolves params, and builds the real query first:

```js
document.getElementById("btn-list").addEventListener("click", async () => {
  const table = document.getElementById("list-table").value;
  let query = document.getElementById("list-query").value.trim();
  const limit = parseInt(document.getElementById("list-limit").value) || 10;
  // Infinity preset: resolve runtime params, build the real encoded query
  let infinityMode = false;
  if (query === "__INFINITY_ALARMS__") {
    infinityMode = true;
    showLoading(listResult);
    try {
      const params = await send({ action: "getInfinityFilterParams" });
      query = "active=true^state=1^" + params.smField + "=Event Management^assignment_group=" + params.agSysId + "^assigned_toISEMPTY";
    } catch (e) {
      showError(listResult, e.message);
      return;
    }
  }
  showLoading(listResult);
```

Leave the rest of the handler body (the `try { const tickets = await send({ action: "listTickets", ...` block onward) untouched for now — Task 6 will add the `infinityMode`-gated Take link to the card rendering inside that body.

**Why `let query` and `let infinityMode`:** `query` is reassigned when the marker is expanded; `infinityMode` is captured in closure so the card-rendering loop (which runs later in the same handler) can gate the Take link on it.

- [ ] **Step 3: Verify the query builds and the list loads**

Reload the extension. Select "Infinity Alarms (Unassigned)" in the Filter dropdown, click Search. Expected: list of incidents renders (or "No tickets found" if none match). Confirm in SNOW that the returned incidents all satisfy the 5 filter conditions.

If you see "Could not locate a 'Service Model' column..." or "Could not locate the 'Avaya Infinity Platform' assignment group...", the discovery queries need adjusting for this instance — check the exact `column_label` in `sys_dictionary` and the exact group `name` in `sys_user_group`.

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: resolve Infinity preset marker into encoded query at list time"
```

---

## Task 6: Render the Take link on Infinity-preset cards

**Files:**
- Modify: `chrome-extension/panel.js` (the card-rendering loop inside the `btn-list` handler, ~line 984-1007)

- [ ] **Step 1: Add the Take link to card rendering**

In `chrome-extension/panel.js`, inside the `btn-list` handler's card loop, find the action-links block (~line 1000):

```js
      html += `<div class="action-links-row">`;
      html += `<a class="view-notes-link" data-ticket="${esc(displayVal(t.number))}">View Notes</a>`;
      html += `<a class="add-note-link" data-ticket="${esc(displayVal(t.number))}">+ Add Note</a>`;
      html += `<a class="update-link" data-ticket="${esc(displayVal(t.number))}">Update Status</a>`;
      if (displayVal(t.contact_type) === "Alarm" && lCfg.supportsAlarmClose) html += `<a class="alarm-close-link" data-ticket="${esc(displayVal(t.number))}">Close Alarm</a>`;
      html += `</div>`;
```

Replace it with a version that adds the Take link when `infinityMode` is true:

```js
      html += `<div class="action-links-row">`;
      if (infinityMode) html += `<a class="take-link" data-ticket="${esc(displayVal(t.number))}">Take</a>`;
      html += `<a class="view-notes-link" data-ticket="${esc(displayVal(t.number))}">View Notes</a>`;
      html += `<a class="add-note-link" data-ticket="${esc(displayVal(t.number))}">+ Add Note</a>`;
      html += `<a class="update-link" data-ticket="${esc(displayVal(t.number))}">Update Status</a>`;
      if (displayVal(t.contact_type) === "Alarm" && lCfg.supportsAlarmClose) html += `<a class="alarm-close-link" data-ticket="${esc(displayVal(t.number))}">Close Alarm</a>`;
      html += `</div>`;
```

- [ ] **Step 2: Add the Take-link CSS**

In `chrome-extension/panel.html`, in the inline-styles block, find the `.alarm-close-link` rule (~line 170) and add a `.take-link` rule **after** it. The Take link uses the success-green color to signal a claim action, distinguishing it from the red edit-style links:

```css
.alarm-close-link { color: var(--success); cursor: pointer; font-weight: 600; font-size: var(--text-sm); transition: color var(--transition); }
.alarm-close-link:hover { color: var(--success-hover); text-decoration: underline; }
.take-link { color: var(--success); cursor: pointer; font-weight: 600; margin-right: 12px; font-size: var(--text-sm); transition: color var(--transition); }
.take-link:hover { color: var(--success-hover); text-decoration: underline; }
.take-link.disabled { color: var(--text-muted); cursor: default; pointer-events: none; }
.take-you { color: var(--success); font-weight: 600; font-size: var(--text-sm); margin-right: 12px; }
```

- [ ] **Step 3: Verify the link renders**

Reload. Select the Infinity preset, Search. Each card should show a green "Take" link as the first item in the action row, before "View Notes". (Clicking it does nothing yet — handler is Task 7.)

- [ ] **Step 4: Commit**

```bash
git add chrome-extension/panel.js chrome-extension/panel.html
git commit -m "feat: render Take link on Infinity-preset ticket cards"
```

---

## Task 7: Implement the Take click handler

**Files:**
- Modify: `chrome-extension/panel.js` (add a branch to the delegated `click` listener; update card DOM on success)

- [ ] **Step 1: Add the click branch**

In `chrome-extension/panel.js`, the big delegated `document.addEventListener("click", (e) => { ... })` handler starts at ~line 410. Add a new branch near the **top** of the handler body (before the `toggle-cred` branch at ~line 412 is a good spot — Take is high-priority and early return keeps it clean):

```js
  // --- Take (Infinity preset): assign to self + In Progress ---
  if (e.target.classList.contains("take-link")) {
    e.preventDefault();
    const ticket = e.target.dataset.ticket;
    if (!ticket) return;
    const link = e.target;
    const originalText = link.textContent;
    link.classList.add("disabled");
    link.textContent = "Taking...";
    send({ action: "takeTicket", ticketNumber: ticket })
      .then(() => {
        // Replace link with a static "✓ Taken" marker
        const taken = document.createElement("span");
        taken.className = "take-you";
        taken.textContent = "✓ Taken";
        link.replaceWith(taken);
        // Refresh this card's state badge to In Progress and show "You" assignee
        const card = taken.closest(".ticket-card");
        if (card) {
          // State badge: find the .state-badge and update text/class to In Progress
          const badge = card.querySelector(".state-badge");
          if (badge) {
            badge.className = "state-badge state-active";
            badge.textContent = "In Progress";
          }
          // Assigned to: find the field line labeled "Assigned to" and append a "You" badge
          const fields = card.querySelectorAll(".ticket-field");
          for (const f of fields) {
            if (/^Assigned to:/i.test(f.textContent.trim())) {
              // Avoid double-appending if already taken
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

- [ ] **Step 2: Verify the full flow**

Reload. Select Infinity preset, Search. Click "Take" on a card:
- Link shows "Taking...", then is replaced by green "✓ Taken".
- That card's state badge changes to "In Progress" (amber).
- A "You" badge appears next to "Assigned to".
- Verify in SNOW: the incident is now assigned to you, state = In Progress.

Click "Take" on a second card to confirm it works independently.

- [ ] **Step 3: Verify error/retry**

To simulate failure: temporarily disconnect from the network, click Take on a remaining card. Expected: inline red error appears, the link restores to "Take" so you can retry. Reconnect, click again → succeeds.

- [ ] **Step 4: Verify other presets are unaffected**

Select "My Open Tickets", Search. Cards should render with **no** Take link (only View Notes / Add Note / Update Status / Close Alarm as before).

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/panel.js
git commit -m "feat: Take click handler — assign to self, refresh card UI, show You badge"
```

---

## Task 8: Full manual verification pass

**Files:** None (verification only)

Run through the complete manual test plan from the spec. Do this against the live SNOW instance with a real (authorized) login.

- [ ] **Step 1: Discovery & caching**

Select Infinity preset, Search. Confirm both params resolved (list loads). Select it again and Search — confirm it still loads (cache hit; no need to inspect network, just confirm correctness).

- [ ] **Step 2: Filter correctness**

Spot-check 2-3 returned incidents in SNOW: all must be Active, State=New, Service Model=Event Management, Assignment group=Avaya Infinity Platform, Assigned to=empty.

- [ ] **Step 3: Take success + You badge**

Take a card. Verify: card updates (✓ Taken, In Progress badge, You badge), and SNOW shows the incident assigned to you + In Progress.

- [ ] **Step 4: Take refresh restores real name**

After Taking, change the Filter to "My Open Tickets" and Search — the taken incident should appear with your real name as assignee (not "You"), confirming the "You" badge was a transient marker.

- [ ] **Step 5: No results**

(If achievable) find a moment when no unassigned Infinity alarms exist, or temporarily — confirm "No tickets found" renders cleanly.

- [ ] **Step 6: Alarm badge passthrough**

If any returned Infinity alarm has `contact_type=Alarm`, confirm the purple "Alarm" badge AND green "Close Alarm" action appear alongside the Take link on that card.

- [ ] **Step 7: Other presets unaffected**

Confirm "My Open Tickets", "My Recently Updated", "My Resolved", "Awaiting User Info" all work as before and show no Take link.

- [ ] **Step 8: Discovery-failure messaging**

(If you can temporarily break discovery — e.g. by changing the hardcoded group name in a dev copy) confirm a clear error renders in the list area and no broken query runs. Skip if not easily reproducible; the code path is covered by the handler's `catch`.

If all steps pass, the feature is complete. No commit needed (verification only).

---

## Self-Review Notes

Run after writing, results recorded here:

- **Spec coverage:** All spec components map to tasks — preset (T2, T5), query construction (T5), filter param discovery incl. caching + fallback (T3), take action UI + handler incl. You badge (T6, T7), takeTicket handler (T4), error handling (T3/T4/T7), testing (T8), files touched incl. CHANGELOG (T1). ✓
- **Placeholder scan:** No TBD/TODO; every code step shows full code. ✓
- **Type/name consistency:** `getInfinityFilterParams` / `getInfinityFilterParamsInPage` / `cachedServiceModelField` / `cachedAssignmentGroupSysId` / `takeTicket` / `infinityMode` / `.take-link` / `.take-you` used consistently across tasks. Message payload shapes (`{ smField, agSysId }`, `{ success, assignedTo }`) match between background and panel. ✓
