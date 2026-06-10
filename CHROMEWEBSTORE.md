# Chrome Web Store Listing — SNOW + Siebel Ticket Manager

## Listing Details

- **Name:** SNOW + Siebel Ticket Manager
- **Version:** 2.9
- **Category:** Workflow & Planning
- **Language:** English

## Summary (132 chars max)

Manage ServiceNow tickets and Siebel activities from Chrome's sidebar using your existing SSO sessions. No API tokens needed.

## Detailed Description

SNOW + Siebel Ticket Manager is a Chrome sidebar extension for managing ServiceNow tickets and Siebel CRM activities directly in your browser. It uses your existing SSO sessions — no API tokens or separate login required.

**Supported ticket types:** INC, CHG, PRB, RITM, REQ, TAS, SCT, STY, KB0

### ServiceNow Features

- **List** — View your open tickets with quick filter presets (My Open, Recently Updated, Resolved, Awaiting User Info). Inline actions let you add notes, update status, or close alarm INCs without switching tabs. Stale tickets are highlighted: yellow for ≥7 days, red with pulsing badge for ≥14 days since last update. Remote Access info (IP, SE ID, NAT IP, Connectivity) is shown inline on every card; device credentials lazy-load on click.
- **Work Note** — Add work notes with dynamically loaded Work Note Type options (fetched from SNOW sys_choice table), effort time tracking, and message. Default type is "Internal Only". All notes are internal (ACL restriction on public comments).
- **Action** — Update ticket state with per-table state dropdowns, status reason, follow-up datetime, and resolution notes. State options adapt to the detected ticket type. Alarm INCs get a dedicated quick-close section. CI Remote Access shows device info and credentials.
- **Query** — Search any ticket by number to view full details, CI Remote Access info, device passwords, and activity log.
- **View Notes** — Expand inline journal viewer on any ticket card showing work notes and comments with color-coded badges. Duplicate entries (stubs + email bodies) are merged automatically.
- **Copy as Markdown** — Export full ticket context (metadata, details, all notes) as formatted markdown to clipboard.
- **Clickable ticket numbers** — Ticket numbers link directly to the ticket in your existing ServiceNow tab.

### Siebel CRM Features

- **Siebel Note** — Open a new Activity record on any SR directly in Siebel CRM (GCT). Automates navigation, query, drill-in, and activity creation — just fill in the details and save.
- **Siebel Backlog** — View your open SRs and SRAs from the OCD API. Each card shows activity number, type, status, severity, customer, skill, hours, age, and last note. Stale items are highlighted. Click "Add Note" to open the activity directly in Siebel.

### Inline Actions

Every ticket card in List and Query results has expandable inline forms — no tab switching needed:

- **+ Add Note** — Work note type, effort time, message
- **Update Status** — Per-table state options, status reason, follow-up date, notes, effort time
- **Close Alarm** — Note template, close note, effort time (alarm INCs only)
- **View Notes** — Inline journal viewer with color-coded work notes and comments

Only one form can be open at a time per ticket. Forms stay usable after submission.

### Alarm Quick Close

Alarm-generated INCs (detected by contact_type = Alarm) get a purple "Alarm" badge and a green "Close Alarm" action that chains state transitions automatically:

- New/In Progress/Pending/Assigned → Service Restored → Resolved → Closed
- Sets status reason to "Alarm(s) Cleared on Access" on Resolved and Closed steps
- Logs effort time if specified

### How It Works

1. Click the extension icon to open the Chrome Side Panel
2. UI sends messages to the background service worker
3. Background injects helper scripts into the ServiceNow / Siebel CRM tab
4. The helpers use the page's CSRF token and session cookies to call REST APIs or Siebel JS API
5. Results flow back: page → background → sidebar

### Privacy

This extension runs entirely in your browser. It does not collect, store, or transmit any personal data to external servers. All communication happens directly between your browser and your organization's ServiceNow (avaya.service-now.com), Siebel CRM (gct.avaya.com), and OCD (ocd.avaya.com) instances using your existing authenticated sessions.

## Permission Justifications

### activeTab
The extension uses activeTab to access the user's currently open ServiceNow or Siebel CRM tab when they perform an action from the sidebar. Without activeTab, the extension cannot identify or access the correct tab to inject API helper scripts.

### scripting
The extension uses chrome.scripting.executeScript() to inject content scripts into ServiceNow and Siebel CRM pages in the MAIN world. This is necessary because the ServiceNow REST API requires a CSRF token (g_ck) only accessible from the page's JavaScript context, and Siebel automation requires access to the Siebel JavaScript API.

### sidePanel
The extension uses chrome.sidePanel.open() to display its ticket management UI as a Chrome sidebar. The sidebar is the primary and only user interface.

### Host: avaya.service-now.com
Required to inject scripts and make REST API calls to the ServiceNow instance for ticket management operations.

### Host: gct.avaya.com
Required to inject scripts and automate Siebel CRM activity creation via the Siebel JavaScript API.

### Host: ocd.avaya.com
Required to fetch the user's Siebel backlog (open SRs and SRAs) from the OCD API for display in the sidebar.

## Screenshots Needed

Prepare the following screenshots at 1280x800 or 640x400:

1. **List tab** — Shows "My Open Tickets" with ticket cards, state badges, stale highlighting, and inline action links
2. **Work Note tab** — Shows the note form with Work Note Type dropdown, effort time, and message input
3. **Action tab** — Shows state dropdown, status reason, and the alarm quick-close section for an alarm INC
4. **Query tab** — Shows a ticket detail view with CI Remote Access, activity log, and inline actions
5. **Siebel tab** — Shows the Siebel Backlog with SR/SRA cards and the manual note creation form

## Category

Workflow & Planning

## Language

English

## Search Keywords

ServiceNow, SNOW, Siebel, ticket manager, incident management, ITSM, sidebar, Chrome extension, SSO, CRM
