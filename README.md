# SNOW Ticket Manager - Chrome Extension

Chrome sidebar extension for managing ServiceNow tickets. Uses your existing SSO browser session — no API tokens needed.

## Features

- **List** — View your tickets with quick filter presets (My Open, My Recently Updated, My Resolved, Awaiting User Info). Inline actions on each ticket card let you add notes, update status, or close alarm INCs without switching tabs.
- **Work Note** — Add work notes with Work Note Type selector, effort time, and message. Visibility is internal only (ACL restriction on public comments).
- **Action** — Update ticket state with status reason, follow-up date, notes, and effort time. Alarm INCs show a dedicated quick-close section that chains state transitions in one click.
- **Query** — Search any ticket by number (INC/CHG/PRB/RITM/etc.), view details and recent activity log.

### Inline Actions on Ticket Cards

Every ticket card in List and Query results has expandable inline forms — no need to switch tabs:

- **+ Add Note** — Work Note Type, effort time, message
- **Update Status** — State, status reason, follow-up date, notes, effort time
- **Close Alarm** — Note template, close note, effort time (alarm INCs only)

Only one form can be open at a time per ticket. Click the same link again to collapse it.

### Alarm Quick Close

Alarm-generated INCs (detected by `contact_type = Alarm`) get a purple "Alarm" badge and a green "Close Alarm" action. This chains the state transitions automatically:

- New/In Progress/Pending/Assigned → Service Restored → Resolved → Closed
- Sets status reason to "Alarm(s) Cleared on Access" on Resolved and Closed steps
- Logs effort time if specified

## Install

1. Unzip the release package (or use the `chrome-extension` folder directly)
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** → select the `chrome-extension` folder
5. Make sure you're logged into ServiceNow (`avaya.service-now.com`) in another tab

## Usage

Click the extension icon to open the sidebar. The default tab is **List** (auto-loads "My Open Tickets").

### Ticket types supported

| Prefix | Table |
|--------|-------|
| INC | incident |
| CHG | change_request |
| PRB | problem |
| RIT | sc_req_item |
| REQ | sc_request |
| TAS | task |
| SCT | sc_task |
| STY | rm_story |
| KB0 | kb_knowledge |

### Quick filter presets (List tab)

- My Open Tickets
- My Recently Updated
- My Resolved (7 days)
- Awaiting User Info

## Project Structure

```
chrome-extension/
├── manifest.json       # Manifest V3 config
├── background.js       # Service worker — message routing & API orchestration
├── content-snow.js     # Injected into SNOW page — provides snowFetch() helper
├── note-fields.js      # Shared module — builds comment field maps
├── panel.html          # Sidebar UI layout & styles
├── panel.js            # Sidebar UI logic & event handlers
└── icons/
    └── icon48.png      # Extension icon
```

## How It Works

1. Clicking the icon opens the Chrome Side Panel
2. UI sends messages to `background.js` (service worker)
3. Background injects `content-snow.js` into the ServiceNow tab's MAIN world
4. `snowFetch()` uses the page's `g_ck` token and session cookies to call ServiceNow REST API
5. Results flow back: page → background → panel

## Tech Stack

- Chrome Extension Manifest V3
- Chrome Side Panel API
- ServiceNow REST API (`/api/now/table/`)
- No external dependencies

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.
