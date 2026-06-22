# Design: Infinity Alarm Take — One-Click Claim

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Target release:** v2.10

> **Rebase note (2026-06-21):** This spec was originally written against v2.8. The repo has since shipped v2.9 (Remote Access + Details on List cards, CI sys_id validation, lazy credentials, View Notes always-refetch). v2.9 is published to the Chrome Web Store, so this feature targets **v2.10**. The v2.9 changes do not alter the design — they only shift line numbers and add a useful side effect: the list handler now sends `includeCi: true`, so Infinity cards automatically get Remote Access info too. Line references below point at the post-rebase codebase.

## Problem

Support engineers on the Avaya Infinity Platform team currently have to open ServiceNow, manually construct a 5-condition filter (Active = true, State = New, Service Model = Event Management, Assignment group = Avaya Infinity Platform, Assigned to = empty), run it, then assign each resulting alarm incident to themselves one at a time. The goal is to reproduce that filter and the "take" action with minimal clicks inside the existing extension sidebar.

## Goal

Add the ability to, from the extension's List tab:

1. Pull all new, unassigned Infinity alarm incidents that match the screenshot filter, in one preset selection.
2. Claim any of them with a single per-ticket "Take" action (assign to self + move to In Progress).

## Non-Goals (Out of Scope)

- Bulk "Take All" — explicitly deferred; per-ticket only.
- Editing or customizing the filter conditions in the UI.
- Auto-closing alarms (existing Close Alarm flow already handles that).
- A new tab or new UI surface — everything reuses the List tab.

## Design Decisions (from brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Take action semantics | Assign to me + State → In Progress (state 2) | Signals work has started; matches user's workflow |
| Workflow shape | Fetch list, then per-ticket Take | Review before mutating; most control |
| UI placement | List tab preset dropdown option | Reuses existing rendering + inline actions; fits mental model |
| Service Model field name + assignment group | ~~Runtime discovery via `sys_dictionary` + `sys_user_group`~~ → **Service Model dropped** (ACL-blocked); assignment group resolved via `sys_user_group` and cached | Target instance's ACLs deny reads on `sys_dictionary`/`sys_documentation`, making label-based field discovery impossible. Service Model condition removed entirely; assignment group still resolved by sys_id to avoid the dot-walk display-name fragility |
| Assignee display after Take | Literal "You" badge, no extra fetch | sys_id ≠ display name; next list refresh restores the real name |

## Architecture

The feature reuses the extension's established three-layer flow: `panel.js` (UI) → `background.js` (orchestration) → injected `snowFetch()` in the ServiceNow page's MAIN world.

Two new message actions are added to `background.js`; no changes to `content-snow.js` or `note-fields.js`.

```
panel.js                      background.js                  SNOW page (MAIN world)
─────────                     ─────────────                  ──────────────────────
select "Infinity Alarms"
preset, click Search
        │
        ├── getInfinityFilterParams ──► getInfinityFilterParamsInPage ──► snowFetch(sys_user_group)
        │   (cached after first call)
        ◄──────────── { agSysId } ────────────┘
        │
        ├── listTickets (query with ──► listTicketsInPage ──► snowFetch(/api/now/table/incident)
        │   resolved ag sys_id)                 │
        ◄──────────────── tickets ────────────────┘
        │
        │   render cards, each with "Take" link
        │
click "Take" on a card
        │
        ├── takeTicket ─────────────► getUserIdInPage ──► snowFetch(sys_user)
        │                              │
        │                              ▼
        │                          updateBySysIdInPage ──► snowFetch(PATCH incident)
        │                              { assigned_to, state: "2" }
        ◄──────────────── { result } ─┘
        │
        refresh card UI
```

## Components

### 1. New List preset — `panel.html` + `panel.js`

Add a `<option value="infinity-alarms">Infinity Alarms (Unassigned)</option>` to the `#list-preset` `<select>` in `panel.html`.

Add a `PRESETS` entry in `panel.js`. Because the assignment-group sys_id is only known at runtime, the preset value is a **template marker** (not a usable query string):

```js
"infinity-alarms": "__INFINITY_ALARMS__"
```

The `list-preset` change handler (panel.js:1012) sets `list-query` to this marker. The `btn-list` click handler (panel.js:1019) detects the marker; when present, it first calls `getInfinityFilterParams` to resolve the group sys_id, builds the real query, then runs the normal `listTickets` flow.

### 2. Query construction

The query template (substituting `{ag}` with the resolved assignment-group sys_id):

```
active=true^state=1^assignment_group={ag}^assigned_toISEMPTY
```

Condition-by-condition mapping to the screenshot filter:

| Screenshot condition | Encoded query fragment |
|----------------------|------------------------|
| Active is true | `active=true` |
| State is New | `state=1` (incident New = code 1) |
| ~~Service Model is Event Management~~ | **Dropped** — see "Service Model condition" note below |
| Assignment group is Avaya Infinity Platform | `assignment_group={ag}` (sys_id, resolved once — see §3) |
| Assigned to is (empty) | `assigned_toISEMPTY` |

**Service Model condition — dropped (design revision):** The original design resolved the internal column name for "Service Model" at runtime via `sys_dictionary`/`sys_documentation`. This was abandoned during implementation because the target ServiceNow instance's ACLs **deny `query_match` / `query_range` on `sys_dictionary`** (and the same on `sys_documentation`), so any label-based lookup returns empty regardless of the query. Hardcoding the field name was also rejected because the internal name couldn't be confirmed. The filter therefore drops the Service Model condition entirely (Approach C from the original brainstorm): the result set is broader (any Service Model in the Avaya Infinity Platform group, not just Event Management), and Event Management incidents are identified by eye. This is the only deviation from the original 5-condition screenshot filter.

The assignment group is matched by **sys_id**, not by a dot-walk on the display name. The display label shown in the filter UI (`sys_user_group`'s name column) can differ from the `.name` a dot-walk would match on some instances; resolving the sys_id once (by name) and using `assignment_group=<sys_id>` removes that assumption entirely, consistent with the resolve-once-and-cache pattern already in the codebase. `assigned_toISEMPTY` is the standard ServiceNow encoded-query operator for an empty reference field.

The list request asks for the same fields as the other presets (`number,short_description,state,priority,assigned_to,sys_updated_on,contact_type,cmdb_ci`) — Infinity alarms are ordinary incidents, so no new fields are needed for rendering. The table is `incident` (Infinity alarms are INCs). The v2.9 list handler also sends `includeCi: true`, so Infinity cards will automatically get Remote Access info (IP/SE ID/NAT IP/Connectivity + lazy device passwords) like every other preset — no extra work needed.

### 3. Filter parameter discovery — `background.js`

New message action `getInfinityFilterParams`. Resolves the assignment-group sys_id at runtime. Implemented as a page function `getInfinityFilterParamsInPage()` and routed through `injectAndExec`, mirroring the existing `getNoteTypes` / `getTicket` pattern.

The page function resolves the group and returns `{ agSysId }`:

**Assignment group sys_id** — resolve the group named "Avaya Infinity Platform":

```
GET /api/now/table/sys_user_group
  ?sysparm_query=name=Avaya Infinity Platform
  &sysparm_fields=sys_id
  &sysparm_limit=1
  &sysparm_display_value=false
```

- Returns the group's sys_id, used directly in `assignment_group={ag}`.
- The URL is built with `URLSearchParams` (not string concatenation) because the group name contains spaces — an unencoded space is parsed by SNOW as a parameter delimiter, returning empty results.

**Caching:** the background service worker caches the result in a module-level variable (`cachedAssignmentGroupSysId`) for the session. The panel does not cache; it asks background each time (background is the single source of truth and survives panel reopens).

**Error propagation:** `chrome.scripting.executeScript` cannot propagate a thrown error or Promise rejection from an injected page function back to the caller — it serializes both as `result: undefined`. The page function therefore catches internally and returns `{ _error: "..." }` on failure (same pattern as `updateBySysIdInPage`). The background handler checks `params._error` and throws the real message, so the panel's `catch` shows the actual cause instead of a null deref.

**Fallback:** if the query returns no rows or errors, `getInfinityFilterParams` throws with a message identifying the failure. The panel catches this, shows a clear error in the list results area ("Could not locate the 'Avaya Infinity Platform' assignment group..."), and does **not** run a broken query.

### 4. Per-ticket Take action — `panel.js` + `background.js`

#### UI

Each Infinity-preset ticket card renders a "Take" link in its action-links row, alongside the existing View Notes / Add Note / Update Status links:

```html
<a class="take-link" data-ticket="INC...">Take</a>
```

Only shown when the Infinity preset is active (gated by a flag set during list rendering, so other presets' cards don't show Take). Styled like the existing links — reuse the `.add-note-link` / `.update-link` look (primary red, semibold, underline on hover).

**Free win — alarm badge passthrough:** Infinity alarm INCs typically carry `contact_type=Alarm`. The existing rendering logic (panel.js:1045–1047, badge; panel.js:1082, Close Alarm link) already shows a purple "Alarm" badge and the green "Close Alarm" action for those, so a Take'd Infinity alarm will display all three: Alarm badge, Take link, and (post-take or independently) Close Alarm. This is desired — Take claims ownership, Close Alarm remains available for the existing auto-close flow.

#### Handler (delegated click, class-based — same pattern as the other inline actions)

On click of `.take-link`:
1. Disable the link, set text to "Taking...".
2. `send({ action: "takeTicket", ticketNumber })`.
3. On success: replace the link with a green "✓ Taken" status, refresh the card's state badge (In Progress), and show a "You" badge next to Assigned to. `getUserIdInPage` returns a sys_id, not a display name — rather than do a second `sys_user` fetch just to spell out a name that the next list refresh restores anyway, we show a literal "You" marker as the assignee immediately after Take.
4. On error: show a red inline error message, restore the link so the user can retry.

#### `takeTicket` message handler (background.js)

Resolves current user and PATCHes the incident:

```js
if (msg.action === "takeTicket") {
  const ticket = await injectAndExec(tab.id, getTicketInPage, [table, msg.ticketNumber]);
  if (!ticket) throw new Error("Ticket " + msg.ticketNumber + " not found");
  const sysId = typeof ticket.sys_id === "object" ? ticket.sys_id.value : ticket.sys_id;
  const userId = await injectAndExec(tab.id, getUserIdInPage, []);
  const result = await injectAndExec(tab.id, updateBySysIdInPage, [
    table, sysId, { assigned_to: userId, state: "2" }
  ]);
  if (result && result._error) throw new Error(result._error);
  return { success: true, assignedTo: userId };
}
```

`sys_id` extraction mirrors the existing pattern in `background.js` (e.g. the `getTicket` / `alarmClose` handlers).

Reuses the existing `getTicketInPage`, `getUserIdInPage`, and `updateBySysIdInPage` page functions — no new page-side code. The returned `assignedTo` is a sys_id; the panel uses it only to gate the "✓ Taken" success state, not to render a name (see UI behavior above — a literal "You" badge is shown).

## Data Flow

1. User opens extension (List tab default).
2. User picks "Infinity Alarms (Unassigned)" from the Filter dropdown and clicks Search.
3. `panel.js` sees the `__INFINITY_ALARMS__` marker → calls `getInfinityFilterParams`.
4. `background.js` returns the cached or freshly-resolved `{ agSysId }`.
5. `panel.js` builds the encoded query, calls `listTickets` (existing path).
6. Tickets render as normal cards, each with an extra "Take" link (Infinity flag = true).
7. User clicks Take on a card → `takeTicket` → incident assigned to them + In Progress.
8. Card UI updates: state badge → In Progress, a "You" badge shows next to Assigned to.

## Error Handling

| Failure | Behavior |
|---------|----------|
| Service Model field discovery fails / not found | Clear error in list area; no query run |
| List query returns no results | Standard "No tickets found" message (existing behavior) |
| `takeTicket`: ticket not found | Inline error on the card; link restored for retry |
| `takeTicket`: PATCH fails (e.g. ACL, network) | `updateBySysIdInPage` returns `_error`; inline error shown |
| Not logged into SNOW | Existing login-error path (`userFacingError` / `showError`) applies |

## Testing

Manual test plan (no automated test harness exists in this project):

1. **Discovery:** Select Infinity preset → confirm the assignment-group sys_id resolves. Selecting again should use the cache (no second `sys_user_group` call).
2. **Filter correctness:** Confirm the returned incidents match all 5 conditions (spot-check a couple in SNOW UI). Pay particular attention to the assignment group — the list must contain only incidents in "Avaya Infinity Platform", confirming the sys_id resolution matched the intended group.
3. **Take success:** Click Take → incident's Assigned to becomes the logged-in user, State becomes In Progress. Verify in SNOW.
4. **Take "You" badge:** After Take, the card shows a "You" badge for Assigned to; a subsequent list refresh replaces it with the real name.
5. **Take failure / retry:** Simulate by going offline mid-take → inline error appears, link restores, retry works when back online.
6. **No results:** When no unassigned Infinity alarms exist → "No tickets found".
7. **Alarm badge passthrough:** An Infinity alarm with `contact_type=Alarm` still shows the purple Alarm badge and the green Close Alarm action (existing logic at panel.js:1045–1047 / 1082) — confirm it appears alongside the new Take link.
8. **Other presets unaffected:** "My Open Tickets" etc. still work; their cards show no Take link.

## Files Touched

| File | Change |
|------|--------|
| `chrome-extension/manifest.json` | Bump version 2.9 → 2.10 |
| `chrome-extension/panel.html` | Add `infinity-alarms` `<option>` to `#list-preset` |
| `chrome-extension/panel.js` | `__INFINITY_ALARMS__` preset; `getInfinityFilterParams` call + query build in list handler; `.take-link` rendering (gated on Infinity preset); delegated `.take-link` click handler; "You" badge after Take |
| `chrome-extension/background.js` | `getInfinityFilterParamsInPage()` page function (resolves assignment group sys_id); `getInfinityFilterParams` message routing + cache; `takeTicket` message handler |
| `CHANGELOG.md` | Add `## [2.10]` section above the existing `## [2.9]` entry |

No changes to `content-snow.js`, `content-gct.js`, or `note-fields.js`.

## Open Questions

None remaining — all resolved during brainstorming.
