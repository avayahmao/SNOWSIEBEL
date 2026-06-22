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
| Service Model condition | **Dropped** | Instance ACLs deny reads on `sys_dictionary`/`sys_documentation`, making label-based field discovery impossible. The internal field name couldn't be confirmed either, so the condition was removed entirely. Result set is broader; Event Management incidents are identified by eye. |
| Assignment group match | **Dot-walk on `assignment_group.name`** (static query string, like every other preset) | The spec-review P2 "harden with sys_id" was inverted by empirical testing: querying `assignment_group=<sys_id>` hits an ACL on this instance that **excludes unassigned incidents** from the result set (verified — sys_id query returns 4 assigned incidents; dot-walk returns 5 including the unassigned one). The dot-walk bypasses that ACL. See §2. |
| Assignee display after Take | Literal "You" badge, no extra fetch | sys_id ≠ display name; next list refresh restores the real name |

## Architecture

The feature reuses the extension's established three-layer flow: `panel.js` (UI) → `background.js` (orchestration) → injected `snowFetch()` in the ServiceNow page's MAIN world.

One new message action is added to `background.js` (`takeTicket`); the Infinity preset itself is a plain static query string in `panel.js` (like every other preset), requiring no background-side discovery. No changes to `content-snow.js` or `note-fields.js`.

```
panel.js                      background.js                  SNOW page (MAIN world)
─────────                     ─────────────                  ──────────────────────
select "Infinity Alarms"
preset, click Search
        │
        ├── listTickets (static ──► listTicketsInPage ──► snowFetch(/api/now/table/incident)
        │   dot-walk query)                  │
        ◄──────────────── tickets ────────────┘
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

Add a `PRESETS` entry in `panel.js`. It's a plain static encoded query string, exactly like the other presets (`awaiting`, `all-open`, etc.) — no marker, no discovery, no special handling:

```js
"infinity-alarms": "active=true^state=1^assignment_group.name=Avaya Infinity Platform^assigned_toISEMPTY"
```

The `infinityMode` flag (gates the Take link on Infinity cards) is set from the dropdown value (`list-preset.value === "infinity-alarms"`), not from any query-string inspection.

### 2. Query construction

The static encoded query:

```
active=true^state=1^assignment_group.name=Avaya Infinity Platform^assigned_toISEMPTY
```

Condition-by-condition mapping to the screenshot filter:

| Screenshot condition | Encoded query fragment |
|----------------------|------------------------|
| Active is true | `active=true` |
| State is New | `state=1` (incident New = code 1) |
| ~~Service Model is Event Management~~ | **Dropped** — see note below |
| Assignment group is Avaya Infinity Platform | `assignment_group.name=Avaya Infinity Platform` (dot-walk — see note below) |
| Assigned to is (empty) | `assigned_toISEMPTY` |

**Service Model condition — dropped:** The original design resolved the internal column name at runtime via `sys_dictionary`/`sys_documentation`. Abandoned because the target instance's ACLs **deny `query_match` / `query_range` on those tables**, so any label-based lookup returns empty regardless of the query. Hardcoding was also rejected because the internal name couldn't be confirmed. The condition is removed entirely — broader result set, triaged by eye.

**Assignment group — dot-walk, NOT sys_id (design revision):** An earlier spec review "hardened" this to `assignment_group=<sys_id>` (resolved once via `sys_user_group`). Empirical testing proved that inverted: on this instance, querying by `assignment_group=<sys_id>` hits an ACL that **excludes unassigned incidents** from the result set, while the dot-walk `assignment_group.name=...` bypasses that ACL and returns the expected rows including the unassigned one. Verified with side-by-side queries against the same group:

| Query form | Returned count | Includes unassigned? |
|---|---|---|
| `assignment_group=884450191b8cf6901727ca2f034bcb0b` | 4 | No (all assigned) |
| `assignment_group.name=Avaya Infinity Platform` | 5 | Yes |

The dot-walk is therefore not a fragility to harden away — it's the **only** form that works correctly on this instance. The earlier resolve-sys_id-and-cache mechanism (`getInfinityFilterParams`, `getInfinityFilterParamsInPage`, `cachedAssignmentGroupSysId`) was removed entirely.

The list request asks for the same fields as the other presets (`number,short_description,state,priority,assigned_to,sys_updated_on,contact_type,cmdb_ci`) — Infinity alarms are ordinary incidents, so no new fields are needed for rendering. The table is `incident` (Infinity alarms are INCs). The v2.9 list handler also sends `includeCi: true`, so Infinity cards will automatically get Remote Access info (IP/SE ID/NAT IP/Connectivity + lazy device passwords) like every other preset — no extra work needed.

### 3. Per-ticket Take action — `panel.js` + `background.js`

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
3. `panel.js` sets `infinityMode = true` (from the dropdown value) and calls `listTickets` with the static dot-walk encoded query (existing path — no special handling needed).
4. Tickets render as normal cards, each with an extra "Take" link (because `infinityMode` is true).
5. User clicks Take on a card → `takeTicket` → incident assigned to them + In Progress.
6. Card UI updates: state badge → In Progress, a "You" badge shows next to Assigned to.

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

1. **Filter correctness:** Select Infinity preset → list should render unassigned New incidents in the Avaya Infinity Platform group. Confirm the dot-walk form (not sys_id) is in effect — the list MUST include unassigned incidents (the sys_id form empirically excludes them via ACL).
2. **Take success:** Click Take → incident's Assigned to becomes the logged-in user, State becomes In Progress. Verify in SNOW.
3. **Take "You" badge:** After Take, the card shows a "You" badge for Assigned to; a subsequent list refresh replaces it with the real name.
4. **Take failure / retry:** Simulate by going offline mid-take → inline error appears, link restores, retry works when back online.
5. **No results:** When no unassigned Infinity alarms exist → "No tickets found".
6. **Alarm badge passthrough:** An Infinity alarm with `contact_type=Alarm` still shows the purple Alarm badge and the green Close Alarm action (existing logic at panel.js:1045–1047 / 1082) — confirm it appears alongside the new Take link.
7. **Other presets unaffected:** "My Open Tickets" etc. still work; their cards show no Take link.

## Files Touched

| File | Change |
|------|--------|
| `chrome-extension/manifest.json` | Bump version 2.9 → 2.10 |
| `chrome-extension/panel.html` | Add `infinity-alarms` `<option>` to `#list-preset` |
| `chrome-extension/panel.js` | Static dot-walk `infinity-alarms` preset entry; `infinityMode` flag (dropdown-based); `.take-link` rendering; delegated `.take-link` click handler; "You" badge after Take |
| `chrome-extension/background.js` | `takeTicket` message handler only (no Infinity discovery — the preset is a static query) |
| `CHANGELOG.md` | Add `## [2.10]` section above the existing `## [2.9]` entry |

No changes to `content-snow.js`, `content-gct.js`, or `note-fields.js`.

## Open Questions

None remaining — all resolved during brainstorming.
