# Changelog

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
