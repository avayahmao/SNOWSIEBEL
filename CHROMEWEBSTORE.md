# Chrome Web Store Listing — SNOW Ticket Manager

## Listing Details

- **Name:** SNOW Ticket Manager
- **Version:** 2.2
- **Category:** Developer Tools
- **Language:** English

## Summary (132 chars max)

Manage ServiceNow INC/CHG/PRB/RITM tickets in Chrome sidebar with your existing SSO session. No API tokens needed.

## Detailed Description

SNOW Ticket Manager is a Chrome sidebar extension for managing ServiceNow tickets directly in your browser. It uses your existing SSO session — no API tokens or separate login required.

**Supported ticket types:** INC, CHG, PRB, RITM, REQ, TAS, SCT, STY, KB0

### Features

- **List** — View your open tickets with quick filter presets. Inline actions let you add notes, update status, or close alarm INCs without switching tabs.
- **Work Note** — Add work notes with dynamically loaded Work Note Type options (fetched from SNOW sys_choice table), effort time tracking, and message. Default type is "Internal Only". All notes are internal (ACL restriction on public comments).
- **Action** — Update ticket state with per-table state dropdowns, status reason, follow-up date, and resolution notes. State options adapt to the detected ticket type (INC shows incident states, CHG shows change states, etc.). Alarm INCs get a dedicated quick-close section that chains state transitions automatically.
- **Query** — Search any ticket by number to view full details and activity log.

### Inline Actions

Every ticket card in List and Query results has expandable inline forms — no tab switching needed:

- **+ Add Note** — Work note type, effort time, message
- **Update Status** — Per-table state options, status reason, follow-up date, notes, effort time
- **Close Alarm** — Note template, close note, effort time (alarm INCs only)

Only one form can be open at a time per ticket. Forms stay usable after submission.

### Alarm Quick Close

Alarm-generated INCs (detected by contact_type = Alarm) get a purple "Alarm" badge and a green "Close Alarm" action that chains state transitions automatically:

- New/In Progress/Pending/Assigned -> Service Restored -> Resolved -> Closed
- Sets status reason to "Alarm(s) Cleared on Access" on Resolved and Closed steps
- Logs effort time if specified

### How It Works

1. Click the extension icon to open the Chrome Side Panel
2. UI sends messages to the background service worker
3. Background injects a helper script into the ServiceNow tab
4. The helper uses the page's CSRF token and session cookies to call the ServiceNow REST API
5. Results flow back: page -> background -> sidebar

### Privacy

This extension runs entirely in your browser. It does not collect, store, or transmit any data to external servers. All communication happens directly between your browser and your ServiceNow instance (avaya.service-now.com) using your existing authenticated session.

## Screenshots Needed

Prepare the following screenshots at 1280x800 or 640x400:

1. **List tab** — Shows "My Open Tickets" with several ticket cards, state badges, and inline action links
2. **Work Note tab** — Shows the note form with Work Note Type dropdown, effort time, and message input
3. **Action tab** — Shows state dropdown, status reason, follow-up date, and the alarm quick-close section for an alarm INC
4. **Query tab** — Shows a ticket detail view with activity log and inline action links

## Category

Developer Tools

## Language

English

## Search Keywords

ServiceNow, SNOW, ticket manager, incident management, ITSM, sidebar, Chrome extension, SSO
