# Changelog

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
