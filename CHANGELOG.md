# Changelog

## [2.3] - 2026-05-26

### Added
- **Stale ticket highlighting** — Tickets not updated in more than 7 days are visually marked in List and Query tabs with a red left border, subtle gradient background, and a "Stale (Nd)" badge showing the exact number of days since last update.
- **Oldest-first sorting** — List tab tickets are now sorted by `sys_updated_on` ascending (stalest first) via both SNOW query `ORDERBY` directives and a defensive client-side sort as a fallback.
- **Inline View Notes** — Every ticket card in List and Query tabs now has a "View Notes" link that expands an inline journal viewer showing work notes and comments with color-coded badges (gold for Work Notes, blue for Comments), sorted newest-first, paginated in batches of 5 with a "Load more" button.
- **Deduplicated journal entries** — Entries sharing the same timestamp and author (e.g., "Customer Comments" stub + actual email body from ServiceNow) are merged into a single entry in "stub - content" format.
- **Copy Ticket as MD** — A "Copy Ticket as MD" button appears at the bottom of notes when all entries are loaded. Generates markdown with full ticket context (description, state, priority, assignment, details) and all notes, copied to clipboard.
- Journal parsing logic reads `work_notes` and `comments` fields directly from the ticket record (bypasses `sys_journal_field` ACL restrictions). Parses concatenated display text by splitting on date-time header pattern (`YYYY-MM-DD HH:MM:SS - Author`).
- Toggle and mutual exclusion with other inline forms (Add Note, Update Status, Close Alarm)
- Journal entry CSS styles in `panel.html`
- "Journal Parsing" section added to README documenting the approach and rationale

## [2.2] - 2026-05-26

### Added
- **Dynamic Work Note Type dropdown** — Note type options are now fetched from SNOW's `sys_choice` table (`u_wn_type` field on incident/task) at startup instead of using a hardcoded list. Ensures all available options are shown, including any added by SNOW admins.
- **Device Password section** — CI Remote Access block now includes a collapsible "Device Password" section showing login credentials (Login Type, Username, masked Password with show/hide toggle) fetched from the `u_cmdb_passwords` table.
- **Follow-up datetime** — Follow-up input changed from date-only to `datetime-local` with UTC conversion for SNOW API compatibility.
- **Clickable ticket numbers** — Ticket numbers in List and Query tabs are clickable links that open the ticket in the existing SNOW tab.

### Changed
- Default Work Note Type changed from "Status Update" to "Internal Only"
- Hardcoded `<option>` elements removed from `panel.html` — dropdown is populated dynamically by `panel.js` with hardcoded fallback if API call fails
- `background.js` — Added `getNoteTypesInPage()` function and `getNoteTypes` message handler
- `panel.js` — Added `loadNoteTypes()`, `buildNoteTypeOptions()`, `NOTE_TYPE_VALUES` cache; `buildNoteTypeOptions` matches against both value and label for default selection

## [2.1] - 2026-05-25

### Added
- **Device Password collapsible section** under CI Remote Access. Fetches login credentials (Login Type, Username, Password) from the CMDB Passwords table (`u_cmdb_passwords`). Passwords are masked by default with a show/hide toggle.

## [2.0] - 2026-05-25

### Added
- **CI Remote Access details** — Query and Action tabs show CI name, SE ID, IP, NAT IP, and connectivity method fetched from `cmdb_ci`.
- **Clickable ticket numbers** — Ticket numbers link to the ticket in the existing SNOW tab.

## [1.8] - 2026-05-25

### Changed
- **Siebel Note workflow simplified to user-assisted flow** — The Siebel Note tab now opens a new Activity record on the chosen SR and an empty Time row, then hands off to the user. Type, Status, Comments, Send Update Email, working time, and Save are all filled in manually in Siebel.
- **Siebel Note UI stripped down** — Only the SR Number input and an "Add a Note in Siebel" button remain. Activity Type, Status, Time, and Comments fields removed from the panel.
- **Headless JS API refactoring of `content-gct.js`** — Restructured into helper-driven modules. Added `findApplet()`, `getBusComp()`, `safeSetField()`, `safeGetField()`, `setFieldByNameList()`, `setFieldViaPM()`, `checkErrors()`.
- **Robust async polling** — `querySR` now polls up to 10s for the query input to render (replacing fixed 500ms delay); `fillActivityForm` polls up to 3s for the dynamic AVAYA SR Activity applet to load.
- **Defensive applet handling** — The AVAYA SR Activity applet from the view map exposes PM but not BC, so the workflow now reads BC from the list applet (`Activity List Applet With Navigation`) and PM from the form applet, with all `applet.Name()` calls wrapped in try/catch.

### Added
- **`AVAYA SR Activity` applet detection** via `view.GetAppletMap()` with regex match `^AVAYA SR Activity` (handles dynamic names like `"... Status - Outbound"` and `"... Management Escalation"`).
- `setCommentViaEAI()` helper attempting EAI Siebel Adapter `Upsert` (investigated but disabled — user account lacks `SBL-UIF-00275` permission).
- Diagnostic console logging prefixed with `[GCT]` across query and form-fill steps for easier troubleshooting in the GCT DevTools console.

### Investigated (kept manual due to Avaya server-side scripts)
- The Activity **Comment** field cannot be persisted via JS API on this Avaya GCT install — PM `LeaveField`, BC `SetFieldValue`, DOM `execCommand`, and EAI `Upsert` all set the value locally but Avaya server scripts clear it during `WriteRecord`. Users fill it manually after the extension opens the new activity.
- The `*Send Update Email` checkbox (BC field `AVAYA_Send Status Update Email Flag`) has the same revert-on-write behavior. Users uncheck it manually.

### Technical
- Active Siebel workflow: Navigate → Query SR (DOM `execCommand` for input + applet `ExecuteQuery`) → Drill into Detail View via `SiebelApp.S_App.GotoView()` → Activities tab → `applet.InvokeMethod("NewRecord")` (Activity) → `applet.InvokeMethod("NewRecord")` (empty time row).
- Dialog suppression for `window.alert`/`window.confirm` preserved — catches "Account Critical Notes" popups that previously broke async init.
- Background.js step-function proxies retained for `fillActivityForm`, `uncheckSendEmail`, `save`, `setCommentViaEAI`, `logTime` even though they are not in the active workflow — available for future use.

## [1.7] - 2026-05-22

### Changed
- **Per-table state models** — State codes, labels, transitions, and status reasons are now defined per ServiceNow table type instead of hardcoding incident-only values. Supported tables: `incident`, `change_request`, `problem`, `sc_req_item`, `sc_request`, `task`, `sc_task`
- Action tab state dropdown is dynamically populated based on the detected ticket type (e.g. CHG shows New/Assess/Authorize/Scheduled/Implement/Review/Closed/Canceled instead of incident states)
- Inline Update Status forms also use per-table state options and transitions
- `stateBadge()` renders correct state labels for all ticket types
- Alarm Close is gated by `supportsAlarmClose` flag — only `incident` table supports alarm close chains
- Follow-up date field only shown for tables with `hasFollowUp: true` (only `incident`)
- Resolution notes only copied when transitioning to the table's `resolveState`
- `resolveTicket` action in background.js uses per-table resolve state codes

### Technical
- Replaced 4 flat constants (`STATE_LABELS`, `STATE_CLASS`, `STATUS_REASONS`, `ALLOWED_TRANSITIONS`) with `TABLE_STATES` object keyed by table name
- Added `detectTable()`, `getStateConfig()`, `buildActionStateOptions()` helper functions in panel.js
- Added `TABLE_MAP` in panel.js (previously only in background.js)
- background.js alarm close uses per-table `ALARM_CHAINS` and `STATE_LABELS`
- background.js resolveTicket uses per-table `RESOLVE_STATES`

## [1.6] - 2026-05-21

### Fixed
- Inline forms now stay usable after submission — inputs are cleared but the form stays open, allowing consecutive note/status updates without refreshing
- Previous status/error messages are cleaned up on re-submit
- Validation border highlights are reset when re-showing a form

## [1.5] - 2026-05-21

### Fixed
- Effort time logging now works for Update Status and Close Alarm without requiring notes to be filled in (previously effort was silently skipped if notes were empty)

## [1.4] - 2026-05-21

### Fixed
- Inline form mutual exclusion — only one expandable form (Add Note, Update Status, Close Alarm) visible per ticket card
- Inline form toggle — clicking the same action link again collapses the form
- Inline form layout — action links stay on one line; form expands below the links row instead of pushing links apart

## [1.3] - 2026-05-21

### Added
- **Alarm Quick Close** — One-click chain close for alarm-generated INCs (New/In Progress/Pending → Service Restored → Resolved → Closed) with note template, close note, and effort time logging
- **Inline expandable forms** — Add Note, Update Status, and Close Alarm forms expand directly on ticket cards in List and Query results — no tab switching needed
- **Alarm badge** — Purple "Alarm" badge on alarm-generated INCs in ticket cards
- **Effort time on alarm close** — Logs effort time to `task_time_worked` and updates parent aggregate during alarm close chain

### Changed
- List tab simplified to incident-only with "My" preset filters (removed table selector and raw query display)
- Action links on ticket cards changed from jump-to-tab to inline expandable forms

## [1.2] - 2026-05-21

### Added
- **Effort time logging in Action tab** — When updating a ticket's state with a note, you can now log effort time (minutes or hours) alongside the state change. Effort is recorded as a `task_time_worked` entry and the parent ticket's aggregate time is updated. Effort is only recorded when a note is provided.

### Fixed
- Default tab in README corrected from "Comment" to "List"

## [1.1] - 2026-05-20

### Added
- **Work Note tab** — Add work notes with Work Note Type selector, effort time input, and internal visibility
- **Action tab** — Update ticket state with status reason, follow-up date (for Pending), and resolution notes
- **List tab** — Query tickets with quick filter presets (My Open Tickets, My Recently Updated, etc.) or custom encoded queries
- **Query tab** — Search any ticket by number, view details and activity log
- **State transition validation** — Only allowed state transitions are selectable in the Action tab dropdown
- **Jump links** — "+ Add Note" and "Update Status" links on ticket cards switch to the appropriate tab with the ticket number pre-filled

## [1.0] - 2026-05-19

### Added
- Initial release
- Chrome sidebar extension for managing ServiceNow tickets
- SSO session-based authentication (no API tokens)
- Support for INC, CHG, PRB, RITM, REQ, TAS, SCT, STY, KB0 ticket types
