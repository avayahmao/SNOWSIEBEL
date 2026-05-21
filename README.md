# SNOW Ticket Manager - Chrome Extension

Chrome sidebar extension for managing ServiceNow tickets. Uses your existing SSO browser session — no API tokens needed.

## Features

- **Query** — Search any ticket by number (INC/CHG/PRB/RITM/etc.), view details and recent activity log
- **Comment** — Add work notes or comments with Work Note Type, effort time, and internal/public visibility
- **Action** — Update ticket state with status reason, follow-up date, notes, and effort time logging
- **List** — Query tickets with quick filter presets or custom encoded queries

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `chrome-extension` folder
4. Make sure you're logged into ServiceNow (`avaya.service-now.com`) in another tab

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
- My Group's Open Tickets
- P1/P2 Open
- All Open
- Updated Today / Created Today
- Awaiting User Info

## Project Structure

```
chrome-extension/
├── manifest.json       # Manifest V3 config
├── background.js       # Service worker — message routing & API orchestration
├── content-snow.js     # Injected into SNOW page — provides snowFetch() helper
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
