# Design: Infinity Alarm Take — One-Click Claim

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Target release:** v2.9

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
| Service Model field name | Runtime discovery via `sys_dictionary` | Internal column name unknown; self-correcting across instances |

## Architecture

The feature reuses the extension's established three-layer flow: `panel.js` (UI) → `background.js` (orchestration) → injected `snowFetch()` in the ServiceNow page's MAIN world.

Two new message actions are added to `background.js`; no changes to `content-snow.js` or `note-fields.js`.

```
panel.js                      background.js                  SNOW page (MAIN world)
─────────                     ─────────────                  ──────────────────────
select "Infinity Alarms"
preset
        │
        ├── getServiceModelField ──► getServiceModelFieldInPage ──► snowFetch(sys_dictionary)
        │   (cached after first call)       │
        ◄──────────────── { field } ────────┘
        │
        ├── listTickets (query with ──► listTicketsInPage ──► snowFetch(/api/now/table/incident)
        │   discovered field)               │
        ◄──────────────── tickets ──────────┘
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

Add a `PRESETS` entry in `panel.js`. Because the Service Model field name is only known at runtime, the preset value is a **template marker** (not a usable query string):

```js
"infinity-alarms": "__INFINITY_ALARMS__"
```

The `list-preset` change handler and `btn-list` click handler detect this marker. When the Infinity preset is selected and Search is clicked, the panel first calls `getServiceModelField`, builds the real query, stashes it, then runs the normal `listTickets` flow.

### 2. Query construction

The query template (substituting `{sm}` with the discovered Service Model column name):

```
active=true^state=1^{sm}=Event Management^assignment_group.name=Avaya Infinity Platform^assigned_toISEMPTY
```

Condition-by-condition mapping to the screenshot filter:

| Screenshot condition | Encoded query fragment |
|----------------------|------------------------|
| Active is true | `active=true` |
| State is New | `state=1` (incident New = code 1) |
| Service Model is Event Management | `{sm}=Event Management` |
| Assignment group is Avaya Infinity Platform | `assignment_group.name=Avaya Infinity Platform` |
| Assigned to is (empty) | `assigned_toISEMPTY` |

The assignment group uses a dot-walk on the display name (`.name=`) so no sys_id lookup is needed. `assigned_toISEMPTY` is the standard ServiceNow encoded-query operator for an empty reference field.

The list request asks for the same fields as the other presets (`number,short_description,state,priority,assigned_to,sys_updated_on,contact_type,cmdb_ci`) — Infinity alarms are ordinary incidents, so no new fields are needed for rendering. The table is `incident` (Infinity alarms are INCs).

### 3. Service Model field discovery — `background.js`

New message action `getServiceModelField`. Implemented as a page function `getServiceModelFieldInPage()` and routed through `injectAndExec`, mirroring the existing `getNoteTypes` / `getTicket` pattern.

Query (runs in the SNOW page via `snowFetch`):

```
GET /api/now/table/sys_dictionary
  ?sysparm_query=name=incident^column_label=Service Model
  &sysparm_fields=element
  &sysparm_limit=1
  &sysparm_display_value=false
```

- `name=incident` restricts to the incident table's dictionary entries.
- `column_label=Service Model` matches the user-facing label exactly.
- Returns `element` = the internal column name (e.g. `u_service_model`).

**Caching:** the background service worker caches the result in a module-level variable (`cachedServiceModelField`) for the session. The panel does not cache; it asks background each time (background is the single source of truth and survives panel reopens).

**Fallback:** if the sys_dictionary query returns no rows or errors, `getServiceModelField` throws. The panel catches this, shows a clear error in the list results area ("Could not locate the 'Service Model' field on this ServiceNow instance. The Infinity Alarms filter cannot run."), and does **not** run a broken query.

### 4. Per-ticket Take action — `panel.js` + `background.js`

#### UI

Each Infinity-preset ticket card renders a "Take" link in its action-links row, alongside the existing View Notes / Add Note / Update Status links:

```html
<a class="take-link" data-ticket="INC...">Take</a>
```

Only shown when the Infinity preset is active (gated by a flag set during list rendering, so other presets' cards don't show Take). Styled like the existing links — reuse the `.add-note-link` / `.update-link` look (primary red, semibold, underline on hover).

#### Handler (delegated click, class-based — same pattern as the other inline actions)

On click of `.take-link`:
1. Disable the link, set text to "Taking...".
2. `send({ action: "takeTicket", ticketNumber })`.
3. On success: replace the link with a green "✓ Taken" status, refresh the card's state badge (In Progress) and Assigned-to field (your name).
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

Reuses the existing `getTicketInPage`, `getUserIdInPage`, and `updateBySysIdInPage` page functions — no new page-side code. The returned `assignedTo` lets the panel show "you" without a second fetch.

## Data Flow

1. User opens extension (List tab default).
2. User picks "Infinity Alarms (Unassigned)" from the Filter dropdown and clicks Search.
3. `panel.js` sees the `__INFINITY_ALARMS__` marker → calls `getServiceModelField`.
4. `background.js` returns the cached or freshly-discovered Service Model column name.
5. `panel.js` builds the encoded query, calls `listTickets` (existing path).
6. Tickets render as normal cards, each with an extra "Take" link (Infinity flag = true).
7. User clicks Take on a card → `takeTicket` → incident assigned to them + In Progress.
8. Card UI updates to reflect the new state and assignee.

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

1. **Discovery:** Select Infinity preset → confirm Service Model column resolves (check via browser console logging during dev). Selecting again should use the cache (no second sys_dictionary call).
2. **Filter correctness:** Confirm the returned incidents match all 5 conditions (spot-check a couple in SNOW UI).
3. **Take success:** Click Take → incident's Assigned to becomes the logged-in user, State becomes In Progress. Verify in SNOW.
4. **Take failure / retry:** Simulate by going offline mid-take → inline error appears, link restores, retry works when back online.
5. **No results:** When no unassigned Infinity alarms exist → "No tickets found".
6. **Other presets unaffected:** "My Open Tickets" etc. still work; their cards show no Take link.

## Files Touched

| File | Change |
|------|--------|
| `chrome-extension/manifest.json` | Bump version 2.8 → 2.9 |
| `chrome-extension/panel.html` | Add `infinity-alarms` `<option>` to `#list-preset` |
| `chrome-extension/panel.js` | `__INFINITY_ALARMS__` preset; discovery call + query build in list handler; `.take-link` rendering (gated on Infinity preset); delegated `.take-link` click handler |
| `chrome-extension/background.js` | `getServiceModelFieldInPage()` page function; `getServiceModelField` message routing + cache; `takeTicket` message handler |

No changes to `content-snow.js`, `content-gct.js`, or `note-fields.js`.

## Open Questions

None remaining — all resolved during brainstorming.
