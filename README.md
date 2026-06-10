# SNOW + Siebel Ticket Manager - Chrome Extension

Chrome sidebar extension for managing ServiceNow tickets and Siebel CRM activities. Uses your existing SSO browser sessions — no API tokens needed.

## Features

- **List** — View your tickets with quick filter presets (My Open, My Recently Updated, My Resolved, Awaiting User Info). Inline actions on each ticket card let you add notes, update status, or close alarm INCs without switching tabs.
- **Work Note** — Add work notes with dynamically loaded Work Note Type options (fetched from SNOW sys_choice table), effort time, and message. Default type is "Internal Only". Visibility is internal only (ACL restriction on public comments).
- **Action** — Update ticket state with status reason, follow-up date, notes, and effort time. Alarm INCs show a dedicated quick-close section that chains state transitions in one click.
- **Query** — Search any ticket by number (INC/CHG/PRB/RITM/etc.), view details, CI remote access info (with device credentials), and recent activity log.
- **View Notes** — Inline expandable journal viewer on every ticket card (List and Query tabs). Shows work notes and comments with color-coded badges, sorted newest-first. Displays 5 entries initially with a "Load more" button.
- **Siebel** — Open an SR or Activity in Siebel CRM to add notes. Also shows your Siebel backlog (SRs and SRAs from OCD API) with inline "Add Note" actions and stale highlighting.

### Inline Actions on Ticket Cards

Every ticket card in List and Query results has expandable inline forms — no need to switch tabs:

- **View Notes** — Inline journal viewer with work notes (gold badge) and comments (blue badge), paginated in batches of 5
- **+ Add Note** — Work Note Type, effort time, message
- **Update Status** — State, status reason, follow-up date, notes, effort time
- **Close Alarm** — Note template, close note, effort time (alarm INCs only)

Only one form can be open at a time per ticket. Click the same link again to collapse it. Forms stay usable after submission — inputs are cleared and you can submit again without refreshing.

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
├── background.js       # Service worker — message routing, API orchestration, OCD API calls
├── content-snow.js     # Injected into SNOW page — provides snowFetch() helper
├── content-gct.js      # Injected into Siebel/GCT page — headless BC API automation
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

## Journal Parsing

The View Notes feature reads `work_notes` and `comments` fields directly from the ticket record via `/api/now/table/{table}/{sys_id}?sysparm_fields=work_notes,comments&sysparm_display_value=all`, rather than querying the `sys_journal_field` table. This is because `sys_journal_field` has ACL restrictions on this ServiceNow instance that return empty results via REST API.

ServiceNow returns journal fields as concatenated text where each entry has a header line in the format `YYYY-MM-DD HH:MM:SS - Author Name (Additional Info)`. The parser splits on this pattern (`\n(?=\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} - )`), extracts datetime, author, and body from each block, then merges work notes and comments into a single list sorted by date descending.

## Tech Stack

- Chrome Extension Manifest V3
- Chrome Side Panel API
- ServiceNow REST API (`/api/now/table/`)
- Siebel CRM JavaScript API (`theApplication()`, `SiebelApp.S_App`)
- OCD API (`ocd.avaya.com/api.php`) for Siebel backlog
- No external dependencies — all code bundled locally

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release history.
