# CLAUDE.md — SNOW Ticket Manager

## Project Overview
Chrome extension (Manifest V3) for managing ServiceNow tickets via sidebar. Target instance: `avaya.service-now.com`. Authentication relies on the browser's existing SSO session — no API tokens.

## Architecture
- **panel.html / panel.js** — Sidebar UI with 4 tabs: List (default), Work Note, Action, Query
- **background.js** — Service worker handling message routing; injects scripts into SNOW tab
- **note-fields.js** — Shared module (works in both service worker and browser); builds comment field maps via `buildCommentFields()`
- **content-snow.js** — Injected into SNOW page's MAIN world; provides `snowFetch()` which uses `g_ck` + cookies
- Two-step injection: inject `content-snow.js` first, then `executeScript` with a function that calls `snowFetch`

## Key Patterns
- All API calls go through `snowFetch()` in the page's MAIN world (required for auth)
- ServiceNow returns `{value, display_value}` objects — use `displayVal()` to extract readable strings
- No inline onclick handlers (CSP blocks them) — use delegated event listeners with class-based selectors (`.toggle-link`, `.add-note-link`, `.update-link`, `.alarm-close-link`)
- Table detection from ticket prefix (first 3 chars) via `TABLE_MAP`
- Journal entries queried from `sys_journal_field` table
- `switchTab(name)` handles tab switching; List tab auto-loads "My Open Tickets" on first visit and on startup
- Ticket cards in List/Query results have inline expandable forms for Add Note, Update Status, and Close Alarm — no tab switching needed
- Inline forms use mutual exclusion (only one visible per ticket card) and toggle on re-click; forms are inserted after the links container div to keep all links on one line
- Visibility is hardcoded to `internal` (public dropdown removed — ACL blocks `comments` field)
- Action panel has a single Update button (Resolve removed); Notes field auto-includes `work_notes` + `u_private_note` on state change
- Alarm INCs detected via `contact_type === "Alarm"` — shows purple badge and green "Close Alarm" action
- `alarmClose` action chains state transitions sequentially (e.g. New → In Progress → Service Restored → Resolved → Closed) with `u_status_reason` set on Resolved/Closed steps
- List tab is Incident-only with "My" preset filters; raw query and table selector are hidden

## Custom Fields
- `u_wn_type` — Work Note Type dropdown (e.g. "Status Update", "Customer Feedback")
- `u_wn_public` — Boolean: true=public, false=internal. **Controlled by a business rule** that resets it based on whether `comments` field changed
- `u_public_note` / `u_private_note` — Stores the note text for public/internal notes respectively
- `u_wn_effort` — Effort duration in "1970-01-01 HH:MM:SS" format
- `u_resolution_notes` — Resolution notes field
- `u_status_reason` — Status reason dropdown

## Known Limitation: Public Notes (ACL Restriction)
The Avaya instance blocks programmatic write access to the `comments` field via ALL channels:
- REST API (`PATCH /api/now/table/`) — ACL silently ignores `comments`
- `sys_journal_field` direct POST — returns 403 ACL Exception
- `xmlhttp.do` with `AJAXGlideRecord` — empty response, no effect
- Form POST to `/{table}.do` — returns 200 but no effect

A **business rule** on the incident table sets `u_wn_public = true` only when `comments.changes()`.
Since `comments` can never be set programmatically, `u_wn_public` is always reset to `false`.

**Workaround:** All notes go through `work_notes` (which IS writable). Content and type are preserved.
The visibility flag `u_wn_public` will always be `false` (internal).

**To fix properly, the SNOW admin needs to either:**
1. Open the `comments` field ACL for REST API writes, OR
2. Modify the business rule to also check `u_public_note` (not just `comments.changes()`), OR
3. Create a Scripted REST API with elevated privileges to create comments

## State Codes
```
1=New, 2=In Progress, -5=Pending, 4=Service Restored,
3=Awaiting Problem, 5=Assigned, 6=Resolved, 7=Closed, 8=Cancelled
```

## Commands
- No build step needed — load `chrome-extension/` folder as unpacked extension
- No tests currently
