# Changelog

## [2.12] - 2026-07-17

### Added
- **Multi-table List view** — My Tickets presets now fan out to `incident` + `change_request` + `problem` in parallel (`Promise.allSettled`), merge, sort, and cap to the user's Limit. CHG and PRB tickets now appear alongside INC in every My Tickets preset. Failed tables surface an inline warning ("Some tables failed to load: …") while successful tables still render. CI enrichment runs once per table (3 bulk fetches total) — acceptable because `cmdb_ci` sys_ids are disjoint across tables, so no duplicate work.
- **German Non-Standard Queue preset** — New "German Non-Standard Queue" option in the List Filter dropdown. Hardcoded 3-part UNION query against the `task` base table for assignment group `9ed0c8781b4b3954ee7b1131b24bcb9d` (unassigned, active records). Each card has a Take link. Built for the team's pull-from-queue workflow.
- **Per-table Take action** — Take now sets the work-started state appropriate to the record's `sys_class_name` instead of a hardcoded incident value: incident→2 (In Progress), problem→102 (Assess), change_request→-1 (Implement), task/change_task→2 (Work in Progress). `sc_request` (no in-progress state) assigns without a state change. Infinity Alarms queue behavior is unchanged (incident→2 matches the old hardcoded value).
- `change_task` entry added to `TABLE_STATES` (mirrors `task`'s state model, pending sys_choice probe verification).
- New message contract: `takeTicket` now accepts an optional `table` parameter (authoritative `sys_class_name` from the panel); falls back to `detectTable` for back-compat.

### Changed
- **`TABLE_STATES` + `getStateConfig` moved from `panel.js` to `note-fields.js`** (the shared UMD module) so the background service worker can read per-table state config via `importScripts`. No call-site changes in `panel.js` — all 13 usages resolve through the global (`note-fields.js` loads first in `panel.html`).
- New pure helpers in `note-fields.js`: `resolveTable` (sys_class_name-first with detectTable fallback — `detectTable`'s number-prefix guess is unreliable for queue records where TASK prefix can be `task` or `change_task`), `stateBucketRank` / `stateBucketRankForTicket` (cross-table lifecycle bucket-sort). All exported via both UMD paths (browser global + Node `require`).
- `listTicketsInPage` now requests `sys_class_name` in `sysparm_fields` (authoritative record class for rendering and Take semantics).
- **Cross-table state sort** — "state asc/desc" now bucket-sorts by lifecycle (new < active < resolved < closed) via `TABLE_STATES` badge classes, then by raw value within a bucket. Raw `parseInt(state.value)` was meaningless across tables (incident 1-8, change_request -5..4, problem 101-106) and grouped all CHGs before INCs before PRBs regardless of lifecycle.
- Take links now carry a `data-table` attribute (set at render from `resolveTable`); the click handler forwards it to `takeTicket` so per-table `workStartState` actually applies to non-INC queue records. Post-Take badge update generalized to use `getStateConfig` labels/classes instead of the old hardcoded "In Progress" / `state-active` (incident-only).
- `workStartState` field added to every `TABLE_STATES` entry (the per-table "work started" state Take moves a record to).

### Fixed
- **German queue UNION separator** — the encoded query requires `^NQ` (caret-N-Q) between sub-queries, NOT bare `NQ`. Bare `NQ` glues onto the preceding value (e.g. `…u_ebonding_messagesNQsys_class_name…`) and ServiceNow parses the whole string as one malformed condition → 0 results, silently. Root cause of the initial "queue returns nothing in the extension" bug; verified by byte-comparing the decoded source URL against the encoded constant. The spec's `^EQ` prediction (based on the infinity-alarms precedent) was a misdiagnosis and did not apply here.

### Notes
- The `change_task` `TABLE_STATES` entry is a verbatim copy of `task`'s state model as a safe default. A live `sys_choice` probe (`name=change_task^element=state`) should confirm whether `change_task` uses the same state values on this instance; if not, the entry needs updating. If a Take on a `change_task` ever sets an invalid state, the inline-error fallback surfaces it and the user can use "Update Status" manually.
- The `my-open-alarms` preset uses `contact_type=Alarm`, which doesn't exist on `change_request`/`problem`. The fan-out may produce a 400 on those two tables; the inline warning (§Added above) surfaces it accurately. Special-casing was deliberately deferred to observed behavior.

## [2.11] - 2026-06-27

### Added
- **List sort control** — New "Sort" + "Order" dropdowns in the List tab toolbar. Sort by Case ID, Priority, Stale days, Last updated, Created, or State; Ascending or Descending. Selection persists across sessions (`snow_list_sort_key` / `snow_list_sort_dir` in localStorage). `compareTickets()` replaces the old hardcoded priority→stale order.
- **Closure Code on alarm close** — The `u_status_reason` field is now a user-selectable dropdown on both alarm-close surfaces (Action tab and inline List form), offering the same option list as "Update Status → Closed" (sourced from the per-table state config: Repaired, Replaced, Patch / Upgrade, Customer or Third Party Action, Alarm(s) Cleared on Access, Change Request). Default remains "Alarm(s) Cleared on Access" for unchanged behavior.

### Changed
- **Default List sort is now Case ID descending (new on top).** Previously the List auto-loaded with priority-first/stalest-first ordering. Existing users who relied on the P1-first startup view should switch the Sort dropdown to "Priority" — the choice then persists. (Design P1.)
- `listTicketsInPage` default fields now include `sys_created_on` (enables the Created sort; one extra field on an already-returned record, no extra request).

### Fixed
- **State sort bug** (found during implementation): the original design routed the state comparator through `displayVal()`, which returns the localized label (e.g. "New") rather than the numeric code, so `parseInt("New")` → `NaN` → every state compared equal and "sort by state" silently no-op'd. Fixed by adding a `valueVal()` helper that prefers `.value`; the state branch now uses it. The other five keys were unaffected (their display values embed the sort value).

### Performance
- **Per-tab SNOW helper injection cache** — `injectAndExec` previously re-injected `content-snow.js` on every call (two `chrome.scripting.executeScript` round-trips per operation); the GCT path already cached this. Now `ensureSnowInjected()` injects once per tab. Safe because `snowFetch()` reads the `g_ck` token live on every call, so caching can never serve a rotated token. Every operation now does one round-trip instead of two — roughly halving browser IPC on the hot path (search, list, take, alarm-close). A global `tabs.onUpdated` listener clears the cache on a top-level reload (`F5`) for both SNOW and GCT, fixing a latent stale-cache bug where a hard reload would tear down the page's MAIN world but leave the helper marked injected.
- **Parallel journal + CI fetch in `getTicket`** — Query-tab search previously fetched the journal then CI sequentially; they're independent and now run in parallel (`Promise.all`).
- **Parallel ticket + user fetch in `takeTicket`** — the "Take" action previously fetched the ticket then the current user sequentially; the user lookup is independent and now runs in parallel.

### Notes
- The Closure Code dropdown originally targeted a dynamic `sys_choice` fetch (`element=u_status_reason^nameINincident,task`, mirroring the Work Note Types pattern). The smoke test confirmed design risk **R2**: that query returns nothing on this instance, so the dropdown silently fell back to a single value. The dynamic fetch was removed; options now come from the same hardcoded per-table state config (`TABLE_STATES.incident.reasons["7"]`) that the existing "Update Status → Closed" dropdown already uses — which is why that flow works where the fetch didn't. The `-- None --` entry is omitted from the closure dropdown (the alarm-close chain writes a real `u_status_reason`).

## [2.10] - 2026-06-22

### Added
- **Infinity Alarms (Unassigned) preset** — New List tab filter that pulls all active, New, unassigned incidents in the "Avaya Infinity Platform" assignment group. One-click triage queue for Infinity alarm intake; each card shows the v2.9 Remote Access / Details info like every other preset.
- **My Open Alarms preset** — New List tab filter (under "My Open Tickets") showing all active incidents assigned to you with `contact_type = Alarm`. Quick view of the alarms you're currently responsible for.
- **Take action on Infinity alarm cards** — Each Infinity-preset ticket card has a "Take" link that assigns the incident to you and moves it to In Progress (state 2). Shows a "✓ Taken" state and a "You" assignee badge on success; next list refresh restores the real name.
- `takeTicket` message action in background.js — assigns an incident to the current user and sets state to In Progress.

### Notes
- The Infinity preset's filter differs from the original 5-condition screenshot in two ways, both forced by this ServiceNow instance's configuration: (1) the "Service Model = Event Management" condition is dropped — the instance's ACLs deny reads on `sys_dictionary`/`sys_documentation`, making label-based field discovery impossible; (2) the assignment group is matched by dot-walk (`assignment_group.name=...`) rather than sys_id, because the sys_id form hits an ACL that silently excludes unassigned incidents. The `assigned_toISEMPTY` condition requires a trailing `^EQ` terminator on this instance, matching SNOW's own built-in "Open - Unassigned" module.

## [2.9] - 2026-06-10

### Added
- **Remote Access info on SNOW List cards** — IP, SE ID, NAT IP, and Connectivity are now rendered inline on every list card. CI records are bulk-fetched via a single `cmdb_ci?sysparm_query=sys_idIN...` request per Search, so a 50-ticket list adds one extra round-trip regardless of list size (no N+1).
- **Lazy-loaded Device Password section** — Device credentials are fetched on demand when the "▶ Device Password" link is clicked, then cached on the DOM node. Avoids preloading sensitive data for tickets the user only listed.
- **Details field on List cards** — Long descriptions (`description` field) now render under each card with the same 300-char truncate + `show all`/`collapse` toggle used by the Query tab. Added to the bulk `sysparm_fields` so no extra request.
- `getCiDetailsBulkInPage`, `getCredentialsInPage` helpers in background.js; new `getCredentials` message action.

### Changed
- `listTickets` background handler accepts `includeCi: true` and merges `_ci` onto each ticket via the bulk fetch. On bulk-fetch failure the list renders without `_ci` (graceful degradation; old `CI: <name>` fallback line preserved).
- `renderCiBlock()` split into `renderCiFields()` + `renderCredentialsBlock()`; Query and Action tab behavior unchanged.
- **Inline form textareas enlarged 3×** — Add Note, Update Status, and Close Alarm inline textareas bumped from `rows="2"` to `rows="6"` for easier multi-line input during rapid triage.
- **Auto-collapse inline forms on success** — Add Note, Update Status, and Close Alarm forms auto-hide 800 ms after a successful submission so the user can immediately move to the next ticket. Errors keep the form open so the user can correct and retry. Collapse timer is cleared on re-open to avoid stomping the form during the 800 ms window.
- **Single-flight guard on lazy credential fetch** — Rapid double-clicks on `▶ Device Password` no longer trigger duplicate `getCredentials` requests.
- **View Notes always refetches** — Each click on "View Notes" now refetches the journal from SNOW so the latest comments and work notes are always surfaced. Previously the first fetch was cached for the lifetime of the rendered list. Load More and Copy as MD continue to operate on the just-fetched data.

### Security
- **Defensive CI sys_id handling** — All three CI helpers (`getCiDetailsBulkInPage`, `getCredentialsInPage`, `getCiDetailsInPage`) now validate sys_ids against `^[a-f0-9]{32}$` before URL interpolation. The bulk helper silently filters invalid IDs; the single-ID helpers fail closed with a clear error. `encodeURIComponent` is applied defensively to all sys_id values inserted into request URLs. Closes a latent query-string injection risk where malformed values from a SNOW response could splice unintended `sysparm_*` params.
- **Removed double-escaping on list-card credential identifiers** — `credKey` is stored raw and HTML-escaped at each attribute write site. Functionally equivalent for the always-hex sys_id input but eliminates a fragile pattern.

## [2.8] - 2026-05-28

### Added
- **Clickable SR/Activity IDs in Siebel Backlog** — Activity numbers and parent SR numbers are now hyperlinks. Clicking opens the SR or Activity directly in the existing Siebel/GCT tab (view-only, no record creation).
- `openSiebel` message action in background.js — lightweight navigation to SR (via Base36 RowId) or Activity (direct RowId) without creating new records.

## [2.7] - 2026-05-28

### Changed
- **Priority-first sorting (SNOW List)** — Tickets now sort by Priority ascending (P1 first), then by stale days descending (most stale first within same priority). Previously sorted only by stale days.
- **Severity-first sorting (Siebel Backlog)** — Backlog items now sort by Severity (OTG → SBI → BI → NBI), then by stale days descending. Previously sorted only by last updated time.

### Added
- `parsePriority()` helper — extracts numeric priority from SNOW display values (e.g. "1 - Critical" → 1).
- `sblSeverityRank()` helper — maps Siebel severity names to sort rank (OTG=0, SBI=1, BI=2, NBI=3).
- `tests/sort-verify.js` — 18-case test suite for sorting helpers and integration sort order.

## [2.6] - 2026-05-27

### Added
- **Siebel Backlog List** — Siebel tab now shows a "My Siebel Backlog" section below the manual form. Click "Load Backlog" to fetch your open SRs and SRAs from the OCD API. Each card shows activity number, type (SR/SRA), status, severity, customer, skill, hours, age, last note, and an "Add Note" action.
- **OCD API integration** — Background service worker makes form-encoded POST requests to `https://ocd.avaya.com/api.php` with two parallel calls (`backlog_sr` and `backlog_sra`), merges results, and returns to the panel.
- **Stale highlighting on Siebel cards** — Same two-tier stale strategy as SNOW list: yellow border/bg for ≥7 days, red pulsing for ≥14 days. Closed/resolved items are excluded.
- **Username input** — User enters their Siebel username to fetch backlog (auto-detection was unreliable due to SNOW global variable inconsistencies).
- **"Add Note" on backlog cards** — Triggers the existing GCT automation flow (`siebelCreateActivity`) to open the activity directly in Siebel.
- **Expandable last note preview** — Truncated by default, click to expand.
- **Parent SR link** on SRA cards.

### Changed
- Added `*://ocd.avaya.com/*` to host permissions for OCD API access.
- Removed `cookies` permission — chrome.cookies API was never used (Purple Potassium compliance).
- Removed `storage` permission — chrome.storage API was never used.
- OCD API service credentials XOR-encoded to avoid plaintext exposure in source.

## [2.5] - 2026-05-27

### Added
- **Two-tier stale highlighting** — Tickets not updated for ≥7 days get yellow border/background; ≥14 days get red border/background with pulsing badge. Closed/resolved/cancelled tickets are excluded from stale detection.

## [2.4] - 2026-05-27

### Fixed
- **No stale warning on closed tickets** — Stale badge and highlighting no longer appear on tickets in terminal states (Closed, Resolved, Cancelled, etc.) across all table types.
- **Friendly login prompt** — When the user is not logged in to ServiceNow, a clear "Not logged in" message with a clickable link is shown instead of raw HTTP errors or exception stack traces. Applies to all error surfaces: List tab, Query tab, inline actions, and notes viewer.
- **Null guard on alarm close steps** — Prevents crash when `data.steps` is undefined in the inline alarm close handler.
- **Follow-up date validation** — Validates follow-up date before sending to API, preventing NaN values.
- **Alarm close UI flash fix** — Awaits `refreshActionState` after alarm close to avoid brief UI flicker.
- **Per-tab GCT injection tracking** — Replaced global `gctInjected` boolean with a per-tab `Set` keyed by tab ID, properly cleaned up when tabs are closed, for tab lifecycle resilience.
- **Removed external Google Fonts CDN** — Switched to system font fallback to eliminate external dependency and improve load reliability.
- **Shared utility extraction** — Extracted `TABLE_MAP`, `detectTable`, and `displayVal` into `note-fields.js` module shared between service worker and sidebar panel.

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
